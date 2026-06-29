package com.studyshot.relay.update

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
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
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
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

    /**
     * Starts an app-private APK download using the same OkHttp client that
     * backs [StudyShotApiClient]. The download lands in `cacheDir/updates/`
     * so other apps cannot read it; the previous DownloadManager path put
     * the file in the public Downloads folder and handed the device bearer
     * token to the system DownloadManager.
     */
    fun enqueueDownload(release: AndroidUpdateInfo) {
        val settings = secureSettings.settings.value
        val token = secureSettings.getDeviceToken() ?: error("设备尚未绑定")
        check(settings.isServerTransportAllowed()) { "服务器连接被安全策略阻止" }

        // Drop any previous in-flight job. Cancelled via the per-job guard
        // inside [downloadToCache]; we don't need a finer-grained handle
        // because the manager only supports one concurrent update.
        preferences.edit().putLong(KEY_DOWNLOAD_STARTED_AT, System.currentTimeMillis()).apply()
        _availableUpdate.value = null
        scope.launch { runDownload(release, token) }
    }

    fun canInstallPackages(): Boolean = Build.VERSION.SDK_INT < 26 ||
        context.packageManager.canRequestPackageInstalls()

    fun installPermissionIntent(): Intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}"),
    )

    private suspend fun runDownload(release: AndroidUpdateInfo, token: String) {
        val url = StudyShotApiClient.resolveUrl(secureSettings.settings.value.serverBaseUrl, release.downloadPath)
        val targetDir = File(context.cacheDir, "updates").apply { mkdirs() }
        val target = File(targetDir, release.fileName)
        // A leftover file with the same name (previous failed download) would
        // otherwise be appended to or partially overwritten in a confusing way.
        target.delete()
        val notificationId = UPDATE_NOTIFICATION_ID

        try {
            showProgressNotification(notificationId, release, percent = 0, indeterminate = true)
            val actual = withContext(Dispatchers.IO) {
                downloadAndHash(url, token, target) { percent ->
                    showProgressNotification(
                        notificationId, release,
                        percent = percent, indeterminate = false,
                    )
                }
            }
            if (!scope.isActive) {
                // Job cancelled while in flight. Don't surface an installer;
                // leave the partial file for the next cleanup pass to remove.
                return
            }
            if (!release.sha256.equals(actual, ignoreCase = true)) {
                target.delete()
                showInstallNotification(SHA_MISMATCH_TEXT, null)
                return
            }
            preferences.edit().putLong(KEY_DOWNLOAD_FINISHED_AT, System.currentTimeMillis()).apply()
            showInstallNotification(DOWNLOADED_TEXT, fileProviderUri(target))
            openInstaller(fileProviderUri(target))
        } catch (err: Throwable) {
            target.delete()
            showInstallNotification("更新下载失败：${err.message ?: err::class.simpleName}", null)
        } finally {
            context.getSystemService(NotificationManager::class.java)
                .cancel(notificationId)
        }
    }

    /**
     * Streams the response body to [target] while computing SHA-256 in the
     * same pass, so the APK never has to be fully buffered in memory. The
     * caller's [onProgress] receives 0..100 for the foreground notification.
     */
    private fun downloadAndHash(
        url: String,
        token: String,
        target: File,
        onProgress: (Int) -> Unit,
    ): String = apiClient.rawClient().newCall(
        Request.Builder().url(url).header("Authorization", "Bearer $token").get().build(),
    ).execute().use { response ->
        if (!response.isSuccessful) {
            throw IOException("HTTP ${response.code}")
        }
        val body = response.body ?: throw IOException("Empty response body")
        val total = body.contentLength()
        val digest = MessageDigest.getInstance("SHA-256")
        target.outputStream().use { output ->
            body.byteStream().use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var read: Int
                var copied = 0L
                var lastPercent = -1
                while (true) {
                    read = input.read(buffer)
                    if (read <= 0) break
                    output.write(buffer, 0, read)
                    digest.update(buffer, 0, read)
                    copied += read
                    if (total > 0) {
                        val percent = ((copied * 100) / total).toInt().coerceIn(0, 100)
                        if (percent != lastPercent) {
                            lastPercent = percent
                            onProgress(percent)
                        }
                    }
                }
            }
        }
        digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun fileProviderUri(file: File): Uri =
        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

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

    private fun showProgressNotification(
        notificationId: Int,
        release: AndroidUpdateInfo,
        percent: Int,
        indeterminate: Boolean,
    ) {
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("正在下载 StudyShot Relay ${release.versionName}")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
        if (indeterminate) {
            builder.setProgress(0, 0, true)
        } else {
            builder.setProgress(100, percent, false)
        }
        context.getSystemService(NotificationManager::class.java)
            .notify(notificationId, builder.build())
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
        private const val KEY_DOWNLOAD_STARTED_AT = "download_started_at"
        private const val KEY_DOWNLOAD_FINISHED_AT = "download_finished_at"
        private const val KEY_IGNORED_VERSION = "ignored_version"
        private const val CHANNEL_ID = "studyshot_updates"
        private const val UPDATE_NOTIFICATION_ID = 2101
        private const val INSTALL_NOTIFICATION_ID = 2102
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val SHA_MISMATCH_TEXT = "更新包 SHA-256 校验失败，请重试"
        private const val DOWNLOADED_TEXT = "更新已下载，点按继续安装"
    }
}
