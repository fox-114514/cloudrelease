package com.studyshot.relay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.studyshot.relay.upload.MediaStoreScanner
import java.util.concurrent.atomic.AtomicReference

class ScreenshotObserverService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var observer: ContentObserver? = null
    private var lastScanAtSeconds: Long = 0
    private val scanJob = AtomicReference<Job?>(null)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(
            NOTIFICATION_ID,
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("StudyShot Relay")
                .setContentText("正在监听学习截图")
                .setOngoing(true)
                .build()
        )
        registerObserver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        scanRecent()
        return START_STICKY
    }

    override fun onDestroy() {
        observer?.let { contentResolver.unregisterContentObserver(it) }
        observer = null
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun registerObserver() {
        val handler = Handler(Looper.getMainLooper())
        observer = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean) {
                if (selfChange) return
                scanRecent()
            }

            override fun onChange(selfChange: Boolean, uri: Uri?) {
                if (selfChange) return
                scanRecent()
            }
        }
        contentResolver.registerContentObserver(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            true,
            observer as ContentObserver,
        )
    }

    private fun scanRecent() {
        val app = application as StudyShotApp
        val settings = app.secureSettings.settings.value
        if (!settings.autoUploadEnabled || !settings.realtimeModeEnabled) return
        if (settings.autoUploadScope != "screenshot_only") return

        // Cancel any in-flight follow-up scans from a previous trigger to avoid storms.
        scanJob.getAndSet(null)?.cancel()

        val job = scope.launch {
            val batchStartAt = System.currentTimeMillis()
            val nowSeconds = batchStartAt / 1000
            val since = if (lastScanAtSeconds == 0L) nowSeconds - 120 else lastScanAtSeconds - 5
            lastScanAtSeconds = nowSeconds

            // OEM screenshot apps may keep the image IS_PENDING=1 for a while.
            // Scan quickly first, then retry a few times to catch late-completing writes.
            val scanDelays = listOf(100L, 400L, 900L, 1800L)
            var enqueued = 0

            for (delayMs in scanDelays) {
                delay(delayMs)
                if (!isActive) return@launch

                val scanner = MediaStoreScanner(contentResolver)
                val candidates = scanner.queryRecentImages(since)
                Log.d(TAG, "scanRecent: +${delayMs}ms found ${candidates.size} screenshot candidate(s)")

                for (candidate in candidates) {
                    app.uploadRepository.enqueueAutoUpload(
                        uri = candidate.uri,
                        sourceDisplayName = candidate.relativePath.ifBlank { candidate.displayName },
                        sourceMediaIdHash = candidate.mediaIdHash,
                        wifiOnly = settings.wifiOnly,
                    )
                    enqueued++
                    Log.d(TAG, "scanRecent: enqueued ${candidate.displayName} at +${delayMs}ms")
                }
            }

            Log.d(TAG, "scanRecent: batch finished in ${System.currentTimeMillis() - batchStartAt}ms, enqueued=$enqueued")
        }
        scanJob.set(job)
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "StudyShot realtime upload",
            NotificationManager.IMPORTANCE_LOW,
        )
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "studyshot_realtime_upload"
        private const val NOTIFICATION_ID = 1001
        private const val TAG = "ScreenshotObserverSvc"
    }
}

