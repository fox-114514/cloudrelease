package com.studyshot.relay.data

import android.content.Context
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class AppSettings(
    val serverBaseUrl: String = "",
    val deviceId: String = "",
    val deviceTokenAvailable: Boolean = false,
    val deviceName: String = "",
    val autoUploadEnabled: Boolean = false,
    val realtimeModeEnabled: Boolean = false,
    val wifiOnly: Boolean = false,
    val autoUploadScope: String = "screenshot_only",
    val selectedAlbumPaths: List<String> = emptyList(),
    val autoReceiveEnabled: Boolean = false,
    val downloadNotificationEnabled: Boolean = true,
    val saveDownloadsToGallery: Boolean = false,
)

class SecureSettings(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = createSecurePreferences(appContext)
    private val useEncryptedStorage = prefs is EncryptedSharedPreferences

    private val settingsFlow = MutableStateFlow(readSettings())

    val isEncryptionAvailable: Boolean
        get() = useEncryptedStorage

    val settings: StateFlow<AppSettings> = settingsFlow

    fun getDeviceToken(): String? = prefs.getString(KEY_DEVICE_TOKEN, null)

    fun saveBinding(
        serverBaseUrl: String,
        deviceId: String,
        deviceToken: String,
        deviceName: String,
    ) {
        prefs.edit {
            putString(KEY_SERVER_BASE_URL, normalizeBaseUrl(serverBaseUrl))
            putString(KEY_DEVICE_ID, deviceId)
            putString(KEY_DEVICE_TOKEN, deviceToken)
            putString(KEY_DEVICE_NAME, deviceName)
        }
        settingsFlow.value = readSettings()
    }

    fun saveServerAndDeviceName(serverBaseUrl: String, deviceName: String) {
        prefs.edit {
            putString(KEY_SERVER_BASE_URL, normalizeBaseUrl(serverBaseUrl))
            putString(KEY_DEVICE_NAME, deviceName)
        }
        settingsFlow.value = readSettings()
    }

    fun saveUploadSettings(
        autoUploadEnabled: Boolean,
        realtimeModeEnabled: Boolean,
        wifiOnly: Boolean,
        autoUploadScope: String,
        selectedAlbumPaths: List<String>,
    ) {
        prefs.edit {
            putBoolean(KEY_AUTO_UPLOAD_ENABLED, autoUploadEnabled)
            putBoolean(KEY_REALTIME_MODE_ENABLED, realtimeModeEnabled)
            putBoolean(KEY_WIFI_ONLY, wifiOnly)
            putString(KEY_AUTO_UPLOAD_SCOPE, autoUploadScope)
            putStringSet(KEY_SELECTED_ALBUM_PATHS, selectedAlbumPaths.toSet())
        }
        settingsFlow.value = readSettings()
    }

    fun saveReceiveSettings(
        autoReceiveEnabled: Boolean,
        downloadNotificationEnabled: Boolean,
        saveDownloadsToGallery: Boolean,
    ) {
        prefs.edit {
            putBoolean(KEY_AUTO_RECEIVE_ENABLED, autoReceiveEnabled)
            putBoolean(KEY_DOWNLOAD_NOTIFICATION_ENABLED, downloadNotificationEnabled)
            putBoolean(KEY_SAVE_DOWNLOADS_TO_GALLERY, saveDownloadsToGallery)
        }
        settingsFlow.value = readSettings()
    }

    fun clearBinding() {
        prefs.edit {
            remove(KEY_DEVICE_ID)
            remove(KEY_DEVICE_TOKEN)
        }
        settingsFlow.value = readSettings()
    }

    private fun readSettings(): AppSettings {
        return AppSettings(
            serverBaseUrl = prefs.getString(KEY_SERVER_BASE_URL, "") ?: "",
            deviceId = prefs.getString(KEY_DEVICE_ID, "") ?: "",
            deviceTokenAvailable = !prefs.getString(KEY_DEVICE_TOKEN, null).isNullOrBlank(),
            deviceName = prefs.getString(KEY_DEVICE_NAME, android.os.Build.MODEL) ?: android.os.Build.MODEL,
            autoUploadEnabled = prefs.getBoolean(KEY_AUTO_UPLOAD_ENABLED, false),
            realtimeModeEnabled = prefs.getBoolean(KEY_REALTIME_MODE_ENABLED, false),
            wifiOnly = prefs.getBoolean(KEY_WIFI_ONLY, false),
            autoUploadScope = prefs.getString(KEY_AUTO_UPLOAD_SCOPE, "screenshot_only") ?: "screenshot_only",
            selectedAlbumPaths = prefs.getStringSet(KEY_SELECTED_ALBUM_PATHS, emptySet())
                ?.filter { it.isNotBlank() }
                ?.sorted()
                ?: emptyList(),
            autoReceiveEnabled = prefs.getBoolean(KEY_AUTO_RECEIVE_ENABLED, false),
            downloadNotificationEnabled = prefs.getBoolean(KEY_DOWNLOAD_NOTIFICATION_ENABLED, true),
            saveDownloadsToGallery = prefs.getBoolean(KEY_SAVE_DOWNLOADS_TO_GALLERY, false),
        )
    }

    companion object {
        private const val PREFS_NAME = "studyshot_secure_settings"
        private const val PREFS_FALLBACK_NAME = "studyshot_secure_settings_fallback"
        private const val KEY_SERVER_BASE_URL = "server_base_url"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_DEVICE_NAME = "device_name"
        private const val KEY_AUTO_UPLOAD_ENABLED = "auto_upload_enabled"
        private const val KEY_REALTIME_MODE_ENABLED = "realtime_mode_enabled"
        private const val KEY_WIFI_ONLY = "wifi_only"
        private const val KEY_AUTO_UPLOAD_SCOPE = "auto_upload_scope"
        private const val KEY_SELECTED_ALBUM_PATHS = "selected_album_paths"
        private const val KEY_AUTO_RECEIVE_ENABLED = "auto_receive_enabled"
        private const val KEY_DOWNLOAD_NOTIFICATION_ENABLED = "download_notification_enabled"
        private const val KEY_SAVE_DOWNLOADS_TO_GALLERY = "save_downloads_to_gallery"

        private fun createSecurePreferences(context: Context): android.content.SharedPreferences {
            return try {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    context,
                    PREFS_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            } catch (err: Exception) {
                // Some devices (especially OnePlus/ColorOS, Android 10 biometric KeyStore issues,
                // or after system updates) fail to initialize EncryptedSharedPreferences.
                // Fall back to plain SharedPreferences so the app remains usable.
                android.util.Log.w("SecureSettings", "EncryptedSharedPreferences failed, falling back to plain storage", err)
                context.getSharedPreferences(PREFS_FALLBACK_NAME, Context.MODE_PRIVATE)
            }
        }

        fun normalizeBaseUrl(raw: String): String {
            val trimmed = raw.trim().trimEnd('/')
            if (trimmed.isBlank()) return ""
            return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "https://$trimmed"
            }
        }
    }
}
