package com.studyshot.relay.upload

import android.content.Context
import android.net.Uri
import android.os.Build
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.studyshot.relay.data.StudyShotDatabase
import com.studyshot.relay.data.UploadTaskEntity
import java.util.UUID
import java.util.concurrent.TimeUnit

class UploadRepository(
    private val context: Context,
    private val database: StudyShotDatabase,
) {
    suspend fun enqueueManualUpload(uri: Uri, wifiOnly: Boolean): String {
        val taskId = UUID.randomUUID().toString()
        val cachedUri = copyToUploadCache(uri, taskId)
        val now = System.currentTimeMillis()
        database.dao().upsertUploadTask(
            UploadTaskEntity(
                id = taskId,
                uri = cachedUri.toString(),
                sourceKind = "manual_share",
                sourceDisplayName = "manual_share",
                sourceMediaIdHash = null,
                sha256 = null,
                fileSize = null,
                status = "queued",
                attemptCount = 0,
                serverImageId = null,
                lastError = null,
                createdAt = now,
                updatedAt = now,
            )
        )
        enqueueWorker(taskId, wifiOnly)
        return taskId
    }

    suspend fun enqueueAutoUpload(
        uri: Uri,
        sourceKind: String,
        sourceDisplayName: String?,
        sourceMediaIdHash: String?,
        wifiOnly: Boolean,
    ): String {
        val taskId = UUID.nameUUIDFromBytes(uri.toString().toByteArray()).toString()
        val now = System.currentTimeMillis()
        database.dao().upsertUploadTask(
            UploadTaskEntity(
                id = taskId,
                uri = uri.toString(),
                sourceKind = sourceKind,
                sourceDisplayName = sourceDisplayName,
                sourceMediaIdHash = sourceMediaIdHash,
                sha256 = null,
                fileSize = null,
                status = "queued",
                attemptCount = 0,
                serverImageId = null,
                lastError = null,
                createdAt = now,
                updatedAt = now,
            )
        )
        enqueueWorker(taskId, wifiOnly, expedited = true)
        return taskId
    }

    private fun enqueueWorker(taskId: String, wifiOnly: Boolean, expedited: Boolean = false) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
            .build()
        val requestBuilder = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(Data.Builder().putString(UploadWorker.KEY_TASK_ID, taskId).build())
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)

        if (expedited && Build.VERSION.SDK_INT >= 31) {
            requestBuilder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        }

        val request = requestBuilder.build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "upload:$taskId",
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun schedulePowerSaveScan(wifiOnly: Boolean) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<PowerSaveScanWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            POWER_SAVE_SCAN_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    fun cancelPowerSaveScan() {
        WorkManager.getInstance(context).cancelUniqueWork(POWER_SAVE_SCAN_WORK_NAME)
    }

    private fun copyToUploadCache(uri: Uri, taskId: String): Uri {
        val dir = java.io.File(context.cacheDir, "manual-uploads")
        dir.mkdirs()
        val target = java.io.File(dir, "$taskId.upload")
        context.contentResolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { output ->
                input.copyTo(output)
            }
        } ?: error("Unable to open selected image")
        return Uri.fromFile(target)
    }

    companion object {
        private const val POWER_SAVE_SCAN_WORK_NAME = "studyshot-power-save-scan"
    }
}
