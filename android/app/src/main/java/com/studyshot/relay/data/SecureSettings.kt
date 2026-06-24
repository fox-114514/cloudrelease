package com.studyshot.relay.data

import android.content.Context
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.net.URI

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
    val allowInsecureHttp: Boolean = false,
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

    val httpConfirmationPending: Boolean
        get() = deviceTokenAvailable &&
            SecureSettings.isInsecureHttpUrl(serverBaseUrl) &&
            !allowInsecureHttp

    fun isServerTransportAllowed(): Boolean =
        !SecureSettings.isInsecureHttpUrl(serverBaseUrl) || allowInsecureHttp
}

class SecureSettings internal constructor(
    context: Context,
    encryptedPreferencesFactory: (Context) -> android.content.SharedPreferences?,
) {
    constructor(context: Context) : this(context, { createEncryptedPreferences(it) })

    private val appContext = context.applicationContext

    // Encrypted store. Null when EncryptedSharedPreferences failed to initialise.
    // When null, [prefs] falls back to a plain SharedPreferences for NON-SENSITIVE
    // UI prefs (wifiOnly, album selection...) so the user's settings survive, but
    // [saveBinding] / [getDeviceToken] refuse to touch the token.
    private val encrypted: android.content.SharedPreferences? = encryptedPreferencesFactory(appContext)
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
        // R0-4: full-fidelity migration from a 0.5.0 plaintext fallback.
        //
        // Old 0.5.0 code only copied the credential fields (token / device
        // id / bound user) and then deleted the fallback, silently dropping
        // every UI setting the user had configured. We now iterate every
        // known key with its declared type, write the destination with
        // commit() so we can verify the target accepted the write, and only
        // then delete the plaintext file. If commit() reports failure we
        // leave the fallback intact so the user doesn't end up with a
        // half-migrated state.
        val legacy = appContext.getSharedPreferences(PREFS_FALLBACK_NAME, Context.MODE_PRIVATE)
        val hasLegacyData = legacy.all.isNotEmpty()
        val hadLegacyCredentials =
            !legacy.getString(KEY_DEVICE_TOKEN, null).isNullOrBlank() ||
                !legacy.getString(KEY_DEVICE_ID, null).isNullOrBlank()
        when {
            encrypted != null && hasLegacyData -> {
                val ok = migrateAllSettings(legacy, encrypted)
                if (ok) {
                    legacy.edit().clear().commit()
                    appContext.deleteSharedPreferences(PREFS_FALLBACK_NAME)
                    android.util.Log.i(
                        "SecureSettings",
                        "migrated plaintext credentials + all settings to encrypted store",
                    )
                    migratedThisLaunch = true
                } else {
                    android.util.Log.e(
                        "SecureSettings",
                        "encrypted store commit() failed; leaving plaintext fallback in place",
                    )
                }
            }
            // R0-4 §3: encryption is still broken. We must NOT keep a
            // plaintext token on disk, but every UI setting the user chose
            // (auto-upload, Wi-Fi, album selection, etc.) is non-sensitive
            // and should survive. Strip just the token and binding id; the
            // rest of the fallback file is preserved for next launch.
            encrypted == null && hadLegacyCredentials -> {
                legacy.edit()
                    .remove(KEY_DEVICE_TOKEN)
                    .remove(KEY_DEVICE_ID)
                    .remove(KEY_BOUND_USER_ID)
                    .remove(KEY_BOUND_OWNER_USER_ID)
                    .remove(KEY_BOUND_USER_DISPLAY_NAME)
                    .remove(KEY_BOUND_USER_ROLE)
                    .remove(KEY_LAST_KNOWN_PROFILE)
                    .remove(KEY_LAST_KNOWN_PERMISSIONS)
                    .remove(KEY_PERMISSIONS_FETCHED_AT)
                    .commit()
                android.util.Log.w(
                    "SecureSettings",
                    "cleared plaintext token because encryption still unavailable; " +
                        "rebinding required, non-sensitive settings preserved",
                )
            }
            // No legacy: keep going. Also proactively delete a leftover empty
            // fallback file so we don't keep touching plain storage.
            encrypted != null -> {
                appContext.deleteSharedPreferences(PREFS_FALLBACK_NAME)
            }
        }
    }

    /**
     * Copies every known setting from [from] into [to] using the
     * destination's declared type. Returns true only when commit() reports
     * that the destination accepted the write. A false return means the
     * caller must NOT delete [from] — the migration is incomplete.
     */
    internal fun migrateAllSettings(
        from: android.content.SharedPreferences,
        to: android.content.SharedPreferences,
    ): Boolean {
        val editor = to.edit()
        // ---- String fields (server, device identity, bound user, profile) ----
        listOf(
            KEY_SERVER_BASE_URL,
            KEY_DEVICE_ID,
            KEY_DEVICE_TOKEN,
            KEY_DEVICE_NAME,
            KEY_AUTO_UPLOAD_SCOPE,
            KEY_BOUND_USER_ID,
            KEY_BOUND_OWNER_USER_ID,
            KEY_BOUND_USER_DISPLAY_NAME,
            KEY_BOUND_USER_ROLE,
            KEY_LAST_KNOWN_PROFILE,
            KEY_LAST_KNOWN_PERMISSIONS,
        ).forEach { key ->
            val v = from.getString(key, null)
            if (!v.isNullOrBlank()) editor.putString(key, v)
        }
        // ---- Boolean fields (toggles) ----
        listOf(
            KEY_AUTO_UPLOAD_ENABLED,
            KEY_REALTIME_MODE_ENABLED,
            KEY_WIFI_ONLY,
            KEY_AUTO_RECEIVE_ENABLED,
            KEY_DOWNLOAD_NOTIFICATION_ENABLED,
            KEY_SAVE_DOWNLOADS_TO_GALLERY,
            KEY_ALLOW_INSECURE_HTTP,
        ).forEach { key ->
            // getBoolean returns the supplied default when the key is missing
            // in [from]; we only copy when [from] actually holds the key.
            if (from.contains(key)) editor.putBoolean(key, from.getBoolean(key, false))
        }
        // ---- Int fields ----
        listOf(KEY_PENDING_OFFLINE_COUNT).forEach { key ->
            if (from.contains(key)) editor.putInt(key, from.getInt(key, 0))
        }
        // ---- Long fields ----
        listOf(KEY_PERMISSIONS_FETCHED_AT).forEach { key ->
            if (from.contains(key)) editor.putLong(key, from.getLong(key, 0L))
        }
        // ---- StringSet fields (album selections) ----
        listOf(KEY_SELECTED_ALBUM_PATHS, KEY_EXCLUDED_ALBUM_PATHS).forEach { key ->
            val v = from.getStringSet(key, null)
            if (v != null) editor.putStringSet(key, HashSet(v))
        }
        // commit() returns false if the write failed (e.g. disk full, KeyStore
        // corruption). The caller uses that signal to decide whether it is
        // safe to delete the plaintext fallback.
        return editor.commit()
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
        allowInsecureHttp: Boolean? = null,
    ) {
        if (encrypted == null) {
            android.util.Log.e(
                "SecureSettings",
                "saveBinding blocked: encrypted storage unavailable, refusing to write plaintext token",
            )
            settingsFlow.value = readSettings() // refresh storageStatus on UI
            return
        }
        val nextAllowInsecureHttp = allowInsecureHttp ?: settingsFlow.value.allowInsecureHttp
        val normalizedServer = requireAllowedServer(serverBaseUrl, nextAllowInsecureHttp)
        encrypted.edit {
            putString(KEY_SERVER_BASE_URL, normalizedServer)
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
            putBoolean(KEY_ALLOW_INSECURE_HTTP, nextAllowInsecureHttp)
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

    fun saveServerAndDeviceName(
        serverBaseUrl: String,
        deviceName: String,
        allowInsecureHttp: Boolean? = null,
    ) {
        val nextAllowInsecureHttp = allowInsecureHttp ?: settingsFlow.value.allowInsecureHttp
        val normalizedServer = requireAllowedServer(serverBaseUrl, nextAllowInsecureHttp)
        prefs.edit {
            putString(KEY_SERVER_BASE_URL, normalizedServer)
            putString(KEY_DEVICE_NAME, deviceName)
            putBoolean(KEY_ALLOW_INSECURE_HTTP, nextAllowInsecureHttp)
        }
        settingsFlow.value = readSettings()
    }

    fun setAllowInsecureHttp(enabled: Boolean) {
        prefs.edit(commit = true) { putBoolean(KEY_ALLOW_INSECURE_HTTP, enabled) }
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
            allowInsecureHttp = prefs.getBoolean(KEY_ALLOW_INSECURE_HTTP, false),
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
        private const val KEY_ALLOW_INSECURE_HTTP = "allow_insecure_http"

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
            return if (Regex("^[A-Za-z][A-Za-z0-9+.-]*://").containsMatchIn(trimmed)) {
                trimmed
            } else {
                "https://$trimmed"
            }
        }

        fun isInsecureHttpUrl(raw: String): Boolean {
            val normalized = normalizeBaseUrl(raw)
            if (normalized.isBlank()) return false
            val uri = runCatching { URI(normalized) }.getOrNull() ?: return false
            return uri.scheme.equals("http", ignoreCase = true) && !isLoopbackHost(uri.host)
        }

        fun requireAllowedServer(raw: String, allowInsecureHttp: Boolean): String {
            val normalized = normalizeBaseUrl(raw)
            require(normalized.isNotBlank()) { "请填写服务器地址" }
            val uri = runCatching { URI(normalized) }.getOrNull()
                ?: throw IllegalArgumentException("服务器地址格式无效")
            require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) {
                "服务器地址只支持 HTTP 或 HTTPS"
            }
            require(!uri.host.isNullOrBlank()) { "服务器地址格式无效" }
            if (isInsecureHttpUrl(normalized) && !allowInsecureHttp) {
                throw IllegalArgumentException(
                    "非本机 HTTP 会明文传输密码、令牌和图片，请启用 HTTPS 或明确允许不安全 HTTP",
                )
            }
            return normalized
        }

        private fun isLoopbackHost(host: String?): Boolean {
            val normalized = host?.lowercase()?.trim('[', ']') ?: return false
            if (normalized == "localhost" || normalized == "::1") return true
            val octets = normalized.split('.')
            return octets.size == 4 &&
                octets.all { part -> part.toIntOrNull()?.let { it in 0..255 } == true } &&
                octets.first() == "127"
        }
    }
}
