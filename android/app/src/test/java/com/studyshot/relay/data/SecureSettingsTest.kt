package com.studyshot.relay.data

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class SecureSettingsTest {
    private lateinit var context: Context
    private lateinit var encrypted: SharedPreferences
    private lateinit var legacy: SharedPreferences

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        encrypted = context.getSharedPreferences("secure_settings_test_encrypted", Context.MODE_PRIVATE)
        legacy = context.getSharedPreferences("studyshot_secure_settings_fallback", Context.MODE_PRIVATE)
        encrypted.edit().clear().commit()
        legacy.edit().clear().commit()
    }

    @After
    fun tearDown() {
        encrypted.edit().clear().commit()
        legacy.edit().clear().commit()
    }

    private fun newEncryptedStore(): SecureSettings = SecureSettings(context) { encrypted }

    private class FailingCommitPreferences(
        private val delegate: SharedPreferences,
    ) : SharedPreferences by delegate {
        override fun edit(): SharedPreferences.Editor {
            val editor = delegate.edit()
            return object : SharedPreferences.Editor by editor {
                override fun commit(): Boolean {
                    editor.commit()
                    return false
                }
            }
        }
    }

    @Test
    fun urlPolicy_defaultsToHttps_andBlocksRemoteHttpWithoutConsent() {
        assertEquals("https://relay.example.com", SecureSettings.normalizeBaseUrl("relay.example.com"))
        assertEquals("http://127.0.0.1:3000", SecureSettings.requireAllowedServer("http://127.0.0.1:3000", false))
        assertEquals("http://[::1]:3000", SecureSettings.requireAllowedServer("http://[::1]:3000", false))
        assertEquals("http://192.168.1.5", SecureSettings.requireAllowedServer("http://192.168.1.5", true))
        assertTrue(SecureSettings.isInsecureHttpUrl("http://192.168.1.5"))
        assertFalse(SecureSettings.isInsecureHttpUrl("https://relay.example.com"))
        assertTrue(SecureSettings.isInsecureHttpUrl("http://127.evil"))

        val blocked = runCatching {
            SecureSettings.requireAllowedServer("http://192.168.1.5", false)
        }.exceptionOrNull()
        assertTrue(blocked is IllegalArgumentException)
        assertTrue(runCatching {
            SecureSettings.requireAllowedServer("ftp://relay.example.com", true)
        }.exceptionOrNull() is IllegalArgumentException)
    }

    @Test
    fun unavailableEncryption_clearsAllBindingIdentity_butPreservesPreferences() {
        legacy.edit()
            .putString("server_base_url", "http://192.168.1.5")
            .putString("device_id", "device-1")
            .putString("device_token", "plaintext-token")
            .putString("bound_user_id", "user-1")
            .putString("bound_owner_user_id", "owner-1")
            .putString("last_known_permissions_json", "{}")
            .putBoolean("wifi_only", true)
            .putStringSet("selected_album_paths", setOf("/Pictures/Screenshots"))
            .commit()

        val store = SecureSettings(context) { null }

        assertFalse(store.isEncryptionAvailable)
        assertTrue(store.settings.value.storageStatus is StorageStatus.Unavailable)
        assertNull(store.getDeviceToken())
        assertFalse(legacy.contains("device_token"))
        assertFalse(legacy.contains("device_id"))
        assertFalse(legacy.contains("bound_user_id"))
        assertFalse(legacy.contains("bound_owner_user_id"))
        assertFalse(legacy.contains("last_known_permissions_json"))
        assertTrue(store.settings.value.wifiOnly)
        assertEquals(listOf("/Pictures/Screenshots"), store.settings.value.selectedAlbumPaths)
    }

    @Test
    fun recoveredEncryption_migratesFallbackEvenAfterTokenWasAlreadyRemoved() {
        legacy.edit()
            .putString("server_base_url", "https://relay.example.com")
            .putString("device_name", "Old Phone")
            .putBoolean("auto_upload_enabled", true)
            .putBoolean("allow_insecure_http", true)
            .putInt("pending_offline_count", 7)
            .putLong("permissions_fetched_at", 1_700_000_000_000L)
            .putStringSet("selected_album_paths", setOf("/DCIM", "/Pictures/Screenshots"))
            .commit()

        val store = newEncryptedStore()

        assertTrue(store.settings.value.migratedFromPlaintext)
        assertEquals("Old Phone", encrypted.getString("device_name", null))
        assertTrue(encrypted.getBoolean("auto_upload_enabled", false))
        assertTrue(encrypted.getBoolean("allow_insecure_http", false))
        assertEquals(7, encrypted.getInt("pending_offline_count", 0))
        assertEquals(1_700_000_000_000L, encrypted.getLong("permissions_fetched_at", 0))
        assertEquals(setOf("/DCIM", "/Pictures/Screenshots"), encrypted.getStringSet("selected_album_paths", null))
        assertTrue(legacy.all.isEmpty())
    }

    @Test
    fun failedMigrationCommit_keepsPlaintextSourceForRecovery() {
        legacy.edit()
            .putString("device_id", "device-1")
            .putString("device_token", "token-1")
            .putBoolean("wifi_only", true)
            .commit()

        val store = SecureSettings(context) { FailingCommitPreferences(encrypted) }

        assertFalse(store.settings.value.migratedFromPlaintext)
        assertEquals("token-1", legacy.getString("device_token", null))
        assertTrue(legacy.getBoolean("wifi_only", false))
    }

    @Test
    fun saveBinding_refusesRemoteHttpUnlessConsentIsPersisted() {
        val store = newEncryptedStore()
        val blocked = runCatching {
            store.saveBinding("http://10.0.0.5", "device", "token", "Phone")
        }.exceptionOrNull()
        assertTrue(blocked is IllegalArgumentException)
        assertNull(store.getDeviceToken())

        store.saveBinding(
            serverBaseUrl = "http://10.0.0.5",
            deviceId = "device",
            deviceToken = "token",
            deviceName = "Phone",
            allowInsecureHttp = true,
        )
        assertEquals("token", store.getDeviceToken())
        assertTrue(store.settings.value.allowInsecureHttp)
        assertTrue(store.settings.value.isServerTransportAllowed())
    }

    @Test
    fun settingsRoundTrip_andClearBindingKeepNonSensitivePreferences() {
        val store = newEncryptedStore()
        store.saveBinding("https://relay.example.com", "device", "token", "Phone", boundUserId = "user")
        store.saveUploadSettings(true, false, true, "selected_album", listOf("/Pictures"), listOf("/Pictures/private"))
        store.saveReceiveSettings(true, false, true)
        store.clearBinding()

        val settings = store.settings.value
        assertEquals("", settings.deviceId)
        assertEquals("", settings.boundUserId)
        assertNull(store.getDeviceToken())
        assertTrue(settings.autoUploadEnabled)
        assertTrue(settings.wifiOnly)
        assertTrue(settings.autoReceiveEnabled)
        assertFalse(settings.downloadNotificationEnabled)
        assertTrue(settings.saveDownloadsToGallery)
    }
}
