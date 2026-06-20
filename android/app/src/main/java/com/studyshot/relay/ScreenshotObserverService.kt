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
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.studyshot.relay.upload.MediaStoreScanner

class ScreenshotObserverService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var observer: ContentObserver? = null
    private var lastScanAtSeconds: Long = 0
    private val scanRequests = Channel<Unit>(Channel.CONFLATED)

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
        scope.launch {
            for (ignored in scanRequests) {
                // Coalesce the burst of MediaStore callbacks emitted while one image
                // is being written. This avoids repeatedly querying and enqueueing the
                // same row while the UI is in the foreground.
                delay(SCAN_DEBOUNCE_MS)
                while (scanRequests.tryReceive().isSuccess) Unit
                scanRecentBatch()
            }
        }
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
        scanRequests.trySend(Unit)
    }

    private suspend fun scanRecentBatch() {
        val app = application as StudyShotApp
        val settings = app.secureSettings.settings.value
        if (!settings.autoUploadEnabled || !settings.realtimeModeEnabled) return
        if (settings.autoUploadScope !in setOf("screenshot_only", "selected_album")) return

        val batchStartAt = System.currentTimeMillis()
        val nowSeconds = batchStartAt / 1000
        val since = if (lastScanAtSeconds == 0L) nowSeconds - 120 else lastScanAtSeconds - 5
        lastScanAtSeconds = nowSeconds

        // A quick scan plus one delayed follow-up covers OEM screenshot writers that
        // briefly keep IS_PENDING=1, without doing four full MediaStore queries.
        val scanDelays = listOf(0L, FOLLOW_UP_SCAN_DELAY_MS)
        val seenUris = mutableSetOf<String>()
        var enqueued = 0

        for (delayMs in scanDelays) {
            if (delayMs > 0) delay(delayMs)
            if (!scope.isActive) return

            val scanner = MediaStoreScanner(contentResolver)
            val candidates = scanner.queryRecentImages(
                sinceSeconds = since,
                autoUploadScope = settings.autoUploadScope,
                selectedAlbumPaths = settings.selectedAlbumPaths,
                excludedAlbumPaths = settings.excludedAlbumPaths,
            )
            Log.d(TAG, "scanRecent: +${delayMs}ms found ${candidates.size} candidate(s)")

            for (candidate in candidates) {
                if (!seenUris.add(candidate.uri.toString())) continue
                app.uploadRepository.enqueueAutoUpload(
                    uri = candidate.uri,
                    sourceKind = candidate.sourceKind,
                    sourceDisplayName = candidate.relativePath.ifBlank { candidate.displayName },
                    sourceMediaIdHash = candidate.mediaIdHash,
                    wifiOnly = settings.wifiOnly,
                )
                enqueued++
            }
        }

        Log.d(TAG, "scanRecent: batch finished in ${System.currentTimeMillis() - batchStartAt}ms, enqueued=$enqueued")
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
        private const val SCAN_DEBOUNCE_MS = 300L
        private const val FOLLOW_UP_SCAN_DELAY_MS = 900L
    }
}
