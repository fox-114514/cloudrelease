package com.studyshot.relay.update

import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.studyshot.relay.BuildConfig
import com.studyshot.relay.MainActivity
import com.studyshot.relay.data.SecureSettings
import com.studyshot.relay.network.AndroidUpdateInfo
import com.studyshot.relay.network.StudyShotApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.security.MessageDigest

class AndroidUpdateManager(
    private val context: Context,
    private val apiClient: StudyShotApiClient,
    private val secureSettings: SecureSettings,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val _availableUpdate = MutableStateFlow<AndroidUpdateInfo?>(null)
    val availableUpdate: StateFlow<AndroidUpdateInfo?> = _availableUpdate.asStateFlow()

    suspend fun checkNow(includeDismissed: Boolean = false): AndroidUpdateInfo? {
        val settings = secureSettings.settings.value
        val token = secureSettings.getDeviceToken() ?: return null
        if (!settings.isServerTransportAllowed() || settings.serverBaseUrl.isBlank()) return null
        val release = apiClient.getAndroidUpdate(settings.serverBaseUrl, token)
        if (includeDismissed && release != null) {
            preferences.edit().remove(KEY_IGNORED_VERSION).apply()
        }
        acceptRelease(release, notify = false)
        return release?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }
    }

    fun acceptSocketRelease(json: JSONObject) {
        runCatching { apiClient.parseAndroidUpdate(json) }
            .onSuccess { acceptRelease(it, notify = true) }
    }

    fun dismissCurrent() {
        _availableUpdate.value?.let {
            preferences.edit().putInt(KEY_IGNORED_VERSION, it.versionCode).apply()
        }
        _availableUpdate.value = null
    }

    fun enqueueDownload(release: AndroidUpdateInfo): Long {
        val settings = secureSettings.settings.value
        val token = secureSettings.getDeviceToken() ?: error("设备尚未绑定")
        check(settings.isServerTransportAllowed()) { "服务器连接被安全策略阻止" }
        check(Build.VERSION.SDK_INT >= 29 || ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.WRITE_EXTERNAL_STORAGE,
        ) == PackageManager.PERMISSION_GRANTED) { "请先授予存储权限，才能写入 Downloads" }

        val url = StudyShotApiClient.resolveUrl(settings.serverBaseUrl, release.downloadPath)
        val downloadManager = context.getSystemService(DownloadManager::class.java)
        preferences.getLong(KEY_DOWNLOAD_ID, -1L).takeIf { it >= 0 }?.let { downloadManager.remove(it) }
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle("StudyShot Relay ${release.versionName}")
            .setDescription("正在下载应用更新")
            .setMimeType(APK_MIME)
            .addRequestHeader("Authorization", "Bearer $token")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(
                Environment.DIRECTORY_DOWNLOADS,
                "StudyShot Relay/${release.fileName}",
            )

        val id = downloadManager.enqueue(request)
        preferences.edit()
            .putLong(KEY_DOWNLOAD_ID, id)
            .putString(KEY_SHA256, release.sha256)
            .putString(KEY_FILE_NAME, release.fileName)
            .apply()
        _availableUpdate.value = null
        return id
    }

    fun onDownloadComplete(downloadId: Long) {
        if (downloadId != preferences.getLong(KEY_DOWNLOAD_ID, -1L)) return
        scope.launch {
            val manager = context.getSystemService(DownloadManager::class.java)
            val cursor = manager.query(DownloadManager.Query().setFilterById(downloadId)) ?: return@launch
            val status = cursor.use {
                if (!it.moveToFirst()) return@launch
                it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            }
            if (status != DownloadManager.STATUS_SUCCESSFUL) return@launch
            val uri = manager.getUriForDownloadedFile(downloadId) ?: return@launch
            val expected = preferences.getString(KEY_SHA256, null) ?: return@launch
            val actual = context.contentResolver.openInputStream(uri)?.use { input ->
                val digest = MessageDigest.getInstance("SHA-256")
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
                digest.digest().joinToString("") { "%02x".format(it) }
            }
            if (!expected.equals(actual, ignoreCase = true)) {
                manager.remove(downloadId)
                showInstallNotification("更新包校验失败，请重新下载", null)
                return@launch
            }
            openInstaller(uri)
        }
    }

    fun canInstallPackages(): Boolean = Build.VERSION.SDK_INT < 26 ||
        context.packageManager.canRequestPackageInstalls()

    fun installPermissionIntent(): Intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}"),
    )

    private fun acceptRelease(release: AndroidUpdateInfo?, notify: Boolean) {
        if (release == null || release.versionCode <= BuildConfig.VERSION_CODE) return
        if (preferences.getInt(KEY_IGNORED_VERSION, -1) == release.versionCode) return
        val changed = _availableUpdate.value?.versionCode != release.versionCode
        _availableUpdate.value = release
        if (notify && changed) showUpdateNotification(release)
    }

    private fun showUpdateNotification(release: AndroidUpdateInfo) {
        createChannel()
        val openApp = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("发现新版本 ${release.versionName}")
            .setContentText(release.releaseNotes.ifBlank { "点按查看并下载更新" })
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(UPDATE_NOTIFICATION_ID, notification)
    }

    private fun openInstaller(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { context.startActivity(intent) }
            .onFailure { showInstallNotification("更新已下载，点按继续安装", uri) }
    }

    private fun showInstallNotification(text: String, uri: Uri?) {
        createChannel()
        val pendingIntent = uri?.let {
            PendingIntent.getActivity(
                context,
                1,
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(it, APK_MIME)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("StudyShot Relay 更新")
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setAutoCancel(pendingIntent != null)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(INSTALL_NOTIFICATION_ID, notification)
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "应用更新", NotificationManager.IMPORTANCE_HIGH),
            )
        }
    }

    companion object {
        private const val PREFERENCES = "android_update"
        private const val KEY_DOWNLOAD_ID = "download_id"
        private const val KEY_SHA256 = "sha256"
        private const val KEY_FILE_NAME = "file_name"
        private const val KEY_IGNORED_VERSION = "ignored_version"
        private const val CHANNEL_ID = "studyshot_updates"
        private const val UPDATE_NOTIFICATION_ID = 2101
        private const val INSTALL_NOTIFICATION_ID = 2102
        private const val APK_MIME = "application/vnd.android.package-archive"
    }
}

class UpdateDownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
        (context.applicationContext as com.studyshot.relay.StudyShotApp)
            .updateManager.onDownloadComplete(id)
    }
}
