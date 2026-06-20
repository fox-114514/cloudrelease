package com.studyshot.relay.upload

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.studyshot.relay.data.SecureSettings
import com.studyshot.relay.data.StudyShotDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PowerSaveScanWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val settings = SecureSettings(applicationContext).settings.value
        if (!settings.autoUploadEnabled || settings.realtimeModeEnabled) {
            return@withContext Result.success()
        }
        if (settings.autoUploadScope !in setOf("screenshot_only", "selected_album")) {
            return@withContext Result.success()
        }

        val database = StudyShotDatabase.get(applicationContext)
        val repository = UploadRepository(applicationContext, database)
        val scanner = MediaStoreScanner(applicationContext.contentResolver)
        val since = System.currentTimeMillis() / 1000 - 30 * 60

        scanner.queryRecentImages(
            sinceSeconds = since,
            autoUploadScope = settings.autoUploadScope,
            selectedAlbumPaths = settings.selectedAlbumPaths,
            excludedAlbumPaths = settings.excludedAlbumPaths,
        ).forEach { candidate ->
            repository.enqueueAutoUpload(
                uri = candidate.uri,
                sourceKind = candidate.sourceKind,
                sourceDisplayName = candidate.relativePath.ifBlank { candidate.displayName },
                sourceMediaIdHash = candidate.mediaIdHash,
                wifiOnly = settings.wifiOnly,
            )
        }

        Result.success()
    }
}
