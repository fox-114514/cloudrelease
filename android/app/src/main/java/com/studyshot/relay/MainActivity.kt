package com.studyshot.relay

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.studyshot.relay.ui.navigation.AppRoot
import com.studyshot.relay.ui.navigation.rememberAppState
import com.studyshot.relay.ui.theme.StudyShotTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val app: StudyShotApp
        get() = application as StudyShotApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleSharedImage(intent)

        setContent {
            StudyShotTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    val state = rememberAppState(app)
                    AppRoot(
                        state = state,
                        hasImagePermission = ::hasImagePermission,
                        hasPartialImagePermission = ::hasPartialImagePermission,
                        startRealtimeService = ::startRealtimeService,
                        stopRealtimeService = ::stopRealtimeService,
                        startReceiveService = ::startReceiveService,
                        stopReceiveService = ::stopReceiveService,
                        acceptPendingDeliveries = ::acceptPendingDeliveries,
                        skipPendingDeliveries = ::skipPendingDeliveries,
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleSharedImage(intent)
    }

    private fun handleSharedImage(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val uri = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        } ?: return
        val settings = app.secureSettings.settings.value
        if (!app.secureSettings.isEncryptionAvailable ||
            !settings.deviceTokenAvailable ||
            !settings.isServerTransportAllowed() ||
            !settings.serverAllowsManualUpload()
        ) return
        lifecycleScope.launch(Dispatchers.IO) {
            app.uploadRepository.enqueueManualUpload(
                uri,
                settings.wifiOnly,
            )
        }
    }

    private fun hasImagePermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 33) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun hasPartialImagePermission(): Boolean {
        return Build.VERSION.SDK_INT >= 34 &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
            ) == PackageManager.PERMISSION_GRANTED &&
            !hasImagePermission()
    }

    private fun startRealtimeService() {
        val intent = Intent(this, ScreenshotObserverService::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopRealtimeService() {
        stopService(Intent(this, ScreenshotObserverService::class.java))
    }

    private fun startReceiveService() {
        val intent = Intent(this, RelayReceiveService::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopReceiveService() {
        stopService(Intent(this, RelayReceiveService::class.java))
    }

    private fun acceptPendingDeliveries() {
        app.secureSettings.setPendingOfflineCount(0)
        startReceiveServiceWithAction(RelayReceiveService.ACTION_ACCEPT_PENDING)
    }

    private fun skipPendingDeliveries() {
        app.secureSettings.setPendingOfflineCount(0)
        startReceiveServiceWithAction(RelayReceiveService.ACTION_SKIP_PENDING)
    }

    private fun startReceiveServiceWithAction(action: String) {
        val intent = Intent(this, RelayReceiveService::class.java).setAction(action)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
    }
}
