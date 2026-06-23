package com.studyshot.relay.data

import android.content.Context
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

/**
 * Status of the credential store. Surfaced through [AppSettings] so the UI can
 * render a persistent banner when encryption is unavailable instead of a
 * transient Snackbar that disappears.
 *
 * - [Ok]: EncryptedSharedPreferences initialised successfully. Credentials are
 *   stored at-rest encrypted.
 * - [Unavailable]: EncryptedSharedPreferences failed to initialise. The app
 *   refuses to write the device token in this state, which forces every
 *   binding/upload/receive path to fail with a clear message until the user
 *   resolves the KeyStore issue and re-binds.
 */
sealed class StorageStatus {
    object Ok : StorageStatus()
    data class Unavailable(val message: String) : StorageStatus()
}

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
    val excludedAlbumPaths: List<String> = emptyList(),
    val autoReceiveEnabled: Boolean = false,
    val downloadNotificationEnabled: Boolean = true,
    val saveDownloadsToGallery: Boolean = false,
    val pendingOfflineCount: Int = 0,
    val boundUserId: String = "",
    val boundOwnerUserId: String = "",
    val boundUserDisplayName: String = "",
    val boundUserRole: String = "",
    val lastKnownDeviceProfile: String = "",
    val lastKnownPermissionsJson: String = "",
    val permissionsFetchedAt: Long = 0,
    val storageStatus: StorageStatus = StorageStatus.Ok,
    /**
     * True once during the launch that copied a legacy plaintext fallback file
     * into the encrypted store. Used by UI to surface a one-time "credentials
     * migrated" notice. Reset to false on subsequent launches.
     */
    val migratedFromPlaintext: Boolean = false,
) {
    private fun serverPermission(name: String): Boolean {
        if (lastKnownPermissionsJson.isBlank()) return true
        return runCatching { JSONObject(lastKnownPermissionsJson).optBoolean(name, false) }
            .getOrDefault(false)
    }

    fun serverAllowsAutoUpload(): Boolean = serverPermission("canAutoUpload")
    fun serverAllowsManualUpload(): Boolean = serverPermission("canManualUpload")
    fun serverAllowsAutoReceive(): Boolean = serverPermission("canAutoReceive")
    fun serverAllowsManualDownload(): Boolean = serverPermission("canManualDownload")
}

class SecureSettings(context: Context) {
    private val appContext = context.applicationContext

    // Encrypted store. Null when EncryptedSharedPreferences failed to initialise.
    // When null, [prefs] falls back to a plain SharedPreferences for NON-SENSITIVE
    // UI prefs (wifiOnly, album selection...) so the user's settings survive, but
    // [saveBinding] / [getDeviceToken] refuse to touch the token.
    private val encrypted: android.content.SharedPreferences? = createEncryptedPreferences(appContext)
    private val prefs: android.content.SharedPreferences = encrypted
        ?: appContext.getSharedPreferences(PREFS_FALLBACK_NAME, Context.MODE_PRIVATE)

    private val storageStatus: StorageStatus = if (encrypted != null) {
        StorageStatus.Ok
    } else {
        StorageStatus.Unavailable(
            "无法初始化加密存储 (EncryptedSharedPreferences)。绑定、上传和接收已禁用，" +
                "请检查设备 KeyStore（可能需要清除应用数据或重新启动设备），然后重新绑定。",
        )
    }

    // True only on the launch that successfully migrated a plaintext fallback
    // file into the encrypted store. Declared before [init] so the init block
    // can assign it.
    private var migratedThisLaunch: Boolean = false

    init {
        // Migration: pre-0.5.1 versions silently fell back to a plain
        // SharedPreferences when EncryptedSharedPreferences failed. Upgrade
        // those users either to the encrypted store (preferred path) or, when
        // encryption is still broken today, force a rebind by clearing the
        // plaintext token.
        val legacy = appContext.getSharedPreferences(PREFS_FALLBACK_NAME, Context.MODE_PRIVATE)
        val legacyToken = legacy.getString(KEY_DEVICE_TOKEN, null)
        val hadLegacy = !legacyToken.isNullOrBlank()
        when {
            encrypted != null && hadLegacy -> {
                // Move the token + binding fields from the plaintext fallback
                // into the encrypted store, then delete the fallback file.
                encrypted.edit {
                    putString(KEY_SERVER_BASE_URL, legacy.getString(KEY_SERVER_BASE_URL, null))
                    putString(KEY_DEVICE_ID, legacy.getString(KEY_DEVICE_ID, null))
                    putString(KEY_DEVICE_TOKEN, legacyToken)
                    putString(KEY_DEVICE_NAME, legacy.getString(KEY_DEVICE_NAME, null))
                    copyIfPresent(legacy, KEY_BOUND_USER_ID)
                    copyIfPresent(legacy, KEY_BOUND_OWNER_USER_ID)
                    copyIfPresent(legacy, KEY_BOUND_USER_DISPLAY_NAME)
                    copyIfPresent(legacy, KEY_BOUND_USER_ROLE)
                    copyIfPresent(legacy, KEY_LAST_KNOWN_PROFILE)
                    copyIfPresent(legacy, KEY_LAST_KNOWN_PERMISSIONS)
                    val fetchedAt = legacy.getLong(KEY_PERMISSIONS_FETCHED_AT, 0L)
                    if (fetchedAt != 0L) putLong(KEY_PERMISSIONS_FETCHED_AT, fetchedAt)
                }
                appContext.deleteSharedPreferences(PREFS_FALLBACK_NAME)
                android.util.Log.i("SecureSettings", "migrated plaintext credentials to encrypted store")
                migratedThisLaunch = true
            }
            // If the user was bound in the unsafe fallback AND encryption is
            // still broken today, we cannot safely migrate; clear the token so
            // the user is forced to rebind once encryption recovers. Keep the
            // device name / settings so they don't have to re-type the rest.
            encrypted == null && hadLegacy -> {
                legacy.edit { remove(KEY_DEVICE_TOKEN).remove(KEY_DEVICE_ID) }
                android.util.Log.w("SecureSettings", "cleared plaintext token because encryption still unavailable; rebind required")
            }
            // No legacy: keep going. Also proactively delete a leftover empty
            // fallback file so we don't keep touching plain storage.
            encrypted != null -> {
                appContext.deleteSharedPreferences(PREFS_FALLBACK_NAME)
            }
        }
    }

    private fun android.content.SharedPreferences.Editor.copyIfPresent(
        from: android.content.SharedPreferences,
        key: String,
    ): android.content.SharedPreferences.Editor {
        val v = from.getString(key, null)
        if (!v.isNullOrBlank()) putString(key, v)
        return this
    }

    private val settingsFlow = MutableStateFlow(readSettings())

    val isEncryptionAvailable: Boolean
        get() = encrypted != null

    val settings: StateFlow<AppSettings> = settingsFlow

    /**
     * Returns the device token from the encrypted store, or null if encryption
     * is unavailable. Never reads the token from the plaintext fallback.
     */
    fun getDeviceToken(): String? {
        if (encrypted == null) return null
        return encrypted.getString(KEY_DEVICE_TOKEN, null)
    }

    /**
     * Persists binding credentials. Refuses to write when encryption is
     * unavailable so no plaintext token ever lands on disk again.
     */
    fun saveBinding(
        serverBaseUrl: String,
        deviceId: String,
        deviceToken: String,
        deviceName: String,
        boundUserId: String? = null,
        boundOwnerUserId: String? = null,
        boundUserDisplayName: String? = null,
        boundUserRole: String? = null,
        lastKnownDeviceProfile: String? = null,
        lastKnownPermissionsJson: String? = null,
    ) {
        if (encrypted == null) {
            android.util.Log.e(
                "SecureSettings",
                "saveBinding blocked: encrypted storage unavailable, refusing to write plaintext token",
            )
            settingsFlow.value = readSettings() // refresh storageStatus on UI
            return
        }
        encrypted.edit {
            putString(KEY_SERVER_BASE_URL, normalizeBaseUrl(serverBaseUrl))
            putString(KEY_DEVICE_ID, deviceId)
            putString(KEY_DEVICE_TOKEN, deviceToken)
            putString(KEY_DEVICE_NAME, deviceName)
            boundUserId?.let { putString(KEY_BOUND_USER_ID, it) }
            boundOwnerUserId?.let { putString(KEY_BOUND_OWNER_USER_ID, it) }
            boundUserDisplayName?.let { putString(KEY_BOUND_USER_DISPLAY_NAME, it) }
            boundUserRole?.let { putString(KEY_BOUND_USER_ROLE, it) }
            lastKnownDeviceProfile?.let { putString(KEY_LAST_KNOWN_PROFILE, it) }
            lastKnownPermissionsJson?.let { putString(KEY_LAST_KNOWN_PERMISSIONS, it) }
            if (lastKnownPermissionsJson != null) {
                putLong(KEY_PERMISSIONS_FETCHED_AT, System.currentTimeMillis())
            }
        }
        settingsFlow.value = readSettings()
    }

    fun saveBoundUser(
        boundUserId: String,
        boundOwnerUserId: String,
        boundUserDisplayName: String,
        boundUserRole: String,
    ) {
        // Bound user identity is not a secret, but it's still only meaningful
        // when bound, so route it to whichever store we can write to.
        prefs.edit {
            putString(KEY_BOUND_USER_ID, boundUserId)
            putString(KEY_BOUND_OWNER_USER_ID, boundOwnerUserId)
            putString(KEY_BOUND_USER_DISPLAY_NAME, boundUserDisplayName)
            putString(KEY_BOUND_USER_ROLE, boundUserRole)
        }
        settingsFlow.value = readSettings()
    }

    fun saveLastKnownPermissions(profile: String, permissionsJson: String) {
        prefs.edit {
            putString(KEY_LAST_KNOWN_PROFILE, profile)
            putString(KEY_LAST_KNOWN_PERMISSIONS, permissionsJson)
            putLong(KEY_PERMISSIONS_FETCHED_AT, System.currentTimeMillis())
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
        excludedAlbumPaths: List<String>,
    ) {
        prefs.edit {
            putBoolean(KEY_AUTO_UPLOAD_ENABLED, autoUploadEnabled)
            putBoolean(KEY_REALTIME_MODE_ENABLED, realtimeModeEnabled)
            putBoolean(KEY_WIFI_ONLY, wifiOnly)
            putString(KEY_AUTO_UPLOAD_SCOPE, autoUploadScope)
            putStringSet(KEY_SELECTED_ALBUM_PATHS, selectedAlbumPaths.toSet())
            putStringSet(KEY_EXCLUDED_ALBUM_PATHS, excludedAlbumPaths.toSet())
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
            if (!autoReceiveEnabled) putInt(KEY_PENDING_OFFLINE_COUNT, 0)
            putBoolean(KEY_DOWNLOAD_NOTIFICATION_ENABLED, downloadNotificationEnabled)
            putBoolean(KEY_SAVE_DOWNLOADS_TO_GALLERY, saveDownloadsToGallery)
        }
        settingsFlow.value = readSettings()
    }

    fun clearBinding() {
        // Clear token from the encrypted store specifically, plus the rest
        // from wherever it lived. The plaintext fallback must never again
        // carry a token, so we remove the token from it too (defensive).
        encrypted?.edit {
            remove(KEY_DEVICE_ID)
            remove(KEY_DEVICE_TOKEN)
        }
        prefs.edit {
            remove(KEY_DEVICE_ID)
            remove(KEY_DEVICE_TOKEN)
            remove(KEY_BOUND_USER_ID)
            remove(KEY_BOUND_OWNER_USER_ID)
            remove(KEY_BOUND_USER_DISPLAY_NAME)
            remove(KEY_BOUND_USER_ROLE)
            remove(KEY_LAST_KNOWN_PROFILE)
            remove(KEY_LAST_KNOWN_PERMISSIONS)
            remove(KEY_PERMISSIONS_FETCHED_AT)
            remove(KEY_PENDING_OFFLINE_COUNT)
        }
        settingsFlow.value = readSettings()
    }

    fun setPendingOfflineCount(count: Int) {
        prefs.edit { putInt(KEY_PENDING_OFFLINE_COUNT, count.coerceAtLeast(0)) }
        settingsFlow.value = readSettings()
    }

    private fun readSettings(): AppSettings {
        // Token only comes from encrypted store. If encryption is unavailable,
        // report deviceTokenAvailable=false regardless of any stale plaintext
        // value (not that there should be one — the init block clears it).
        val tokenAvailable = encrypted
            ?.getString(KEY_DEVICE_TOKEN, null)
            ?.isNotBlank()
            ?: false
        return AppSettings(
            serverBaseUrl = prefs.getString(KEY_SERVER_BASE_URL, "") ?: "",
            deviceId = prefs.getString(KEY_DEVICE_ID, "") ?: "",
            deviceTokenAvailable = tokenAvailable,
            deviceName = prefs.getString(KEY_DEVICE_NAME, android.os.Build.MODEL) ?: android.os.Build.MODEL,
            autoUploadEnabled = prefs.getBoolean(KEY_AUTO_UPLOAD_ENABLED, false),
            realtimeModeEnabled = prefs.getBoolean(KEY_REALTIME_MODE_ENABLED, false),
            wifiOnly = prefs.getBoolean(KEY_WIFI_ONLY, false),
            autoUploadScope = prefs.getString(KEY_AUTO_UPLOAD_SCOPE, "screenshot_only") ?: "screenshot_only",
            selectedAlbumPaths = prefs.getStringSet(KEY_SELECTED_ALBUM_PATHS, emptySet())
                ?.filter { it.isNotBlank() }
                ?.sorted()
                ?: emptyList(),
            excludedAlbumPaths = prefs.getStringSet(KEY_EXCLUDED_ALBUM_PATHS, emptySet())
                ?.filter { it.isNotBlank() }
                ?.sorted()
                ?: emptyList(),
            autoReceiveEnabled = prefs.getBoolean(KEY_AUTO_RECEIVE_ENABLED, false),
            downloadNotificationEnabled = prefs.getBoolean(KEY_DOWNLOAD_NOTIFICATION_ENABLED, true),
            saveDownloadsToGallery = prefs.getBoolean(KEY_SAVE_DOWNLOADS_TO_GALLERY, false),
            pendingOfflineCount = prefs.getInt(KEY_PENDING_OFFLINE_COUNT, 0),
            boundUserId = prefs.getString(KEY_BOUND_USER_ID, "") ?: "",
            boundOwnerUserId = prefs.getString(KEY_BOUND_OWNER_USER_ID, "") ?: "",
            boundUserDisplayName = prefs.getString(KEY_BOUND_USER_DISPLAY_NAME, "") ?: "",
            boundUserRole = prefs.getString(KEY_BOUND_USER_ROLE, "") ?: "",
            lastKnownDeviceProfile = prefs.getString(KEY_LAST_KNOWN_PROFILE, "") ?: "",
            lastKnownPermissionsJson = prefs.getString(KEY_LAST_KNOWN_PERMISSIONS, "") ?: "",
            permissionsFetchedAt = prefs.getLong(KEY_PERMISSIONS_FETCHED_AT, 0L),
            storageStatus = storageStatus,
            migratedFromPlaintext = migratedThisLaunch,
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
        private const val KEY_EXCLUDED_ALBUM_PATHS = "excluded_album_paths"
        private const val KEY_AUTO_RECEIVE_ENABLED = "auto_receive_enabled"
        private const val KEY_DOWNLOAD_NOTIFICATION_ENABLED = "download_notification_enabled"
        private const val KEY_SAVE_DOWNLOADS_TO_GALLERY = "save_downloads_to_gallery"
        private const val KEY_PENDING_OFFLINE_COUNT = "pending_offline_count"
        private const val KEY_BOUND_USER_ID = "bound_user_id"
        private const val KEY_BOUND_OWNER_USER_ID = "bound_owner_user_id"
        private const val KEY_BOUND_USER_DISPLAY_NAME = "bound_user_display_name"
        private const val KEY_BOUND_USER_ROLE = "bound_user_role"
        private const val KEY_LAST_KNOWN_PROFILE = "last_known_device_profile"
        private const val KEY_LAST_KNOWN_PERMISSIONS = "last_known_permissions_json"
        private const val KEY_PERMISSIONS_FETCHED_AT = "permissions_fetched_at"

        private fun createEncryptedPreferences(context: Context): android.content.SharedPreferences? {
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
                // Some devices (OnePlus/ColorOS, Android 10 biometric KeyStore
                // issues, post-update corruption) fail to initialise the
                // encrypted store. 0.5.1 explicitly does NOT silently fall
                // back to plaintext anymore: the caller gets null and the UI
                // shows a persistent error forcing re-bind.
                android.util.Log.e("SecureSettings", "EncryptedSharedPreferences unavailable; token storage disabled", err)
                null
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
