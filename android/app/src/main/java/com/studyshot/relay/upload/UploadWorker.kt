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
        val taskId = inputData.getString(KEY_TASK_ID) ?: return@withContext Result.failure()

        if (runAttemptCount > MAX_RETRY_ATTEMPTS) {
            markFailed(taskId, null, null, "重试次数超过上限 ($MAX_RETRY_ATTEMPTS)")
            return@withContext Result.failure()
        }

        val database = StudyShotDatabase.get(applicationContext)
        val secureSettings = SecureSettings(applicationContext)
        val apiClient = StudyShotApiClient()
        val task = database.dao().getUploadTask(taskId) ?: return@withContext Result.failure()
        val settings = secureSettings.settings.value
        val token = secureSettings.getDeviceToken()

        if (settings.serverBaseUrl.isBlank() || token.isNullOrBlank()) {
            markFailed(taskId, task.sha256, task.fileSize, "Device is not bound")
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

            if (database.dao().hasUploadedHash(digest.sha256)) {
                database.dao().updateUploadTask(
                    id = taskId,
                    status = "deduplicated",
                    sha256 = digest.sha256,
                    fileSize = digest.fileSize,
                    serverImageId = null,
                    lastError = "Image was already uploaded",
                    attemptDelta = 0,
                    updatedAt = System.currentTimeMillis(),
                )
                return@withContext Result.success()
            }

            val mimeType = resolveMimeType(uri)
            if (mimeType == null) {
                markFailed(taskId, digest.sha256, digest.fileSize, "Unsupported image type")
                return@withContext Result.failure()
            }

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
            val terminal = err.statusCode == 400 || err.statusCode == 401 || err.statusCode == 403 || err.statusCode == 404 || err.statusCode == 422
            val retryable = !terminal && runAttemptCount < MAX_RETRY_ATTEMPTS
            markTaskStatus(taskId, retryable, task.sha256, task.fileSize, "${err.apiCode}: ${err.message}")
            if (retryable) Result.retry() else Result.failure()
        } catch (err: Exception) {
            val retryable = runAttemptCount < MAX_RETRY_ATTEMPTS
            markTaskStatus(taskId, retryable, task.sha256, task.fileSize, err.message ?: err.javaClass.simpleName)
            if (retryable) Result.retry() else Result.failure()
        }
    }

    private suspend fun markFailed(
        taskId: String,
        sha256: String?,
        fileSize: Long?,
        reason: String,
    ) {
        val database = StudyShotDatabase.get(applicationContext)
        database.dao().updateUploadTask(
            id = taskId,
            status = "failed",
            sha256 = sha256,
            fileSize = fileSize,
            serverImageId = null,
            lastError = reason,
            attemptDelta = 1,
            updatedAt = System.currentTimeMillis(),
        )
    }

    private suspend fun markTaskStatus(
        taskId: String,
        retryable: Boolean,
        sha256: String?,
        fileSize: Long?,
        reason: String,
    ) {
        val database = StudyShotDatabase.get(applicationContext)
        database.dao().updateUploadTask(
            id = taskId,
            status = if (retryable) "queued" else "failed",
            sha256 = sha256,
            fileSize = fileSize,
            serverImageId = null,
            lastError = reason,
            attemptDelta = 1,
            updatedAt = System.currentTimeMillis(),
        )
    }

    private fun resolveMimeType(uri: Uri): String? {
        val detected = applicationContext.contentResolver.detectImageMimeType(uri)
        if (detected != null) return detected
        val contentType = applicationContext.contentResolver.getType(uri)
        if (contentType != null && contentType.startsWith("image/")) return contentType
        return null
    }

    companion object {
        const val KEY_TASK_ID = "task_id"
        private const val MAX_RETRY_ATTEMPTS = 5
    }
}
