package com.studyshot.relay.upload

import android.content.Context
import android.net.Uri
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.studyshot.relay.data.SecureSettings
import com.studyshot.relay.data.StudyShotDatabase
import com.studyshot.relay.data.UploadedHashEntity
import com.studyshot.relay.network.ApiException
import com.studyshot.relay.network.StudyShotApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class UploadWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val database = StudyShotDatabase.get(applicationContext)
        val secureSettings = SecureSettings(applicationContext)
        val apiClient = StudyShotApiClient()
        val taskId = inputData.getString(KEY_TASK_ID) ?: return@withContext Result.failure()
        val task = database.dao().getUploadTask(taskId) ?: return@withContext Result.failure()
        val settings = secureSettings.settings.value
        val token = secureSettings.getDeviceToken()

        if (settings.serverBaseUrl.isBlank() || token.isNullOrBlank()) {
            database.dao().updateUploadTask(
                id = taskId,
                status = "failed",
                sha256 = null,
                fileSize = null,
                serverImageId = null,
                lastError = "Device is not bound",
                attemptDelta = 1,
                updatedAt = System.currentTimeMillis(),
            )
            return@withContext Result.failure()
        }

        try {
            val uri = Uri.parse(task.uri)
            val digest = applicationContext.contentResolver.computeSha256(uri)

            if (database.dao().hasReceivedHash(digest.sha256)) {
                database.dao().updateUploadTask(
                    id = taskId,
                    status = "skipped",
                    sha256 = digest.sha256,
                    fileSize = digest.fileSize,
                    serverImageId = null,
                    lastError = "Image was received from server",
                    attemptDelta = 0,
                    updatedAt = System.currentTimeMillis(),
                )
                return@withContext Result.success()
            }

            val mimeType = applicationContext.contentResolver.detectImageMimeType(uri)
                ?: applicationContext.contentResolver.getType(uri)
                ?: throw IllegalArgumentException("Unsupported image type")
            val response = apiClient.uploadImage(
                serverBaseUrl = settings.serverBaseUrl,
                deviceToken = token,
                resolver = applicationContext.contentResolver,
                uri = uri,
                sha256 = digest.sha256,
                mimeType = mimeType,
                sourceKind = task.sourceKind,
                sourceDisplayName = task.sourceDisplayName,
                sourceMediaIdHash = task.sourceMediaIdHash,
            )

            database.dao().updateUploadTask(
                id = taskId,
                status = if (response.deduplicated) "deduplicated" else "uploaded",
                sha256 = digest.sha256,
                fileSize = digest.fileSize,
                serverImageId = response.imageId,
                lastError = null,
                attemptDelta = 0,
                updatedAt = System.currentTimeMillis(),
            )
            database.dao().upsertUploadedHash(
                UploadedHashEntity(
                    sha256 = digest.sha256,
                    imageId = response.imageId,
                    createdAt = System.currentTimeMillis(),
                )
            )
            Result.success()
        } catch (err: ApiException) {
            val terminal = err.statusCode == 400 || err.statusCode == 401 || err.statusCode == 403
            database.dao().updateUploadTask(
                id = taskId,
                status = if (terminal) "failed" else "queued",
                sha256 = null,
                fileSize = null,
                serverImageId = null,
                lastError = "${err.apiCode}: ${err.message}",
                attemptDelta = 1,
                updatedAt = System.currentTimeMillis(),
            )
            if (terminal) Result.failure() else Result.retry()
        } catch (err: Exception) {
            database.dao().updateUploadTask(
                id = taskId,
                status = "queued",
                sha256 = null,
                fileSize = null,
                serverImageId = null,
                lastError = err.message ?: err.javaClass.simpleName,
                attemptDelta = 1,
                updatedAt = System.currentTimeMillis(),
            )
            Result.retry()
        }
    }

    companion object {
        const val KEY_TASK_ID = "task_id"
    }
}
