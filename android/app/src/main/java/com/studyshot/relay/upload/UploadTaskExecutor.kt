package com.studyshot.relay.upload

import android.content.Context
import android.net.Uri
import com.studyshot.relay.data.SecureSettings
import com.studyshot.relay.data.StudyShotDatabase
import com.studyshot.relay.data.UploadedHashEntity
import com.studyshot.relay.network.ApiException
import com.studyshot.relay.network.StudyShotApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal enum class UploadExecutionResult {
    Success,
    Retry,
    Failure,
}

/**
 * Runs one upload independently from WorkManager so a foreground service can
 * provide low-latency delivery while WorkManager remains the reliability fallback.
 */
internal class UploadTaskExecutor(context: Context) {
    private val appContext = context.applicationContext
    private val database = StudyShotDatabase.get(appContext)
    private val secureSettings = SecureSettings(appContext)
    private val apiClient = sharedApiClient

    suspend fun execute(taskId: String, runAttemptCount: Int): UploadExecutionResult {
        return executionMutex.withLock {
            withContext(Dispatchers.IO) {
                executeLocked(taskId, runAttemptCount)
            }
        }
    }

    private suspend fun executeLocked(taskId: String, runAttemptCount: Int): UploadExecutionResult {
        if (runAttemptCount > MAX_RETRY_ATTEMPTS) {
            markFailed(taskId, null, null, "重试次数超过上限 ($MAX_RETRY_ATTEMPTS)")
            return UploadExecutionResult.Failure
        }

        val task = database.dao().getUploadTask(taskId) ?: return UploadExecutionResult.Failure
        when (task.status) {
            "uploaded", "deduplicated", "skipped" -> return UploadExecutionResult.Success
            "failed" -> return UploadExecutionResult.Failure
        }

        var settings = secureSettings.settings.value
        val token = secureSettings.getDeviceToken()
        if (settings.serverBaseUrl.isBlank() || token.isNullOrBlank()) {
            markFailed(taskId, task.sha256, task.fileSize, "Device is not bound")
            return UploadExecutionResult.Failure
        }
        try {
            val info = apiClient.getDeviceMe(settings.serverBaseUrl, token)
            val permissionsJson = JSONObject()
                .put("canAutoUpload", info.permissions.canAutoUpload)
                .put("canManualUpload", info.permissions.canManualUpload)
                .put("canAutoReceive", info.permissions.canAutoReceive)
                .put("canManualDownload", info.permissions.canManualDownload)
                .put("canManageSpace", info.permissions.canManageSpace)
                .put("canCreateInvite", info.permissions.canCreateInvite)
                .put("autoUploadScope", info.permissions.autoUploadScope)
                .put("autoReceiveScope", info.permissions.autoReceiveScope)
                .toString()
            secureSettings.saveBinding(
                serverBaseUrl = settings.serverBaseUrl,
                deviceId = info.device.id,
                deviceToken = token,
                deviceName = info.device.name,
                boundUserId = info.user.id,
                boundOwnerUserId = info.user.ownerUserId,
                boundUserDisplayName = info.user.displayName ?: "",
                boundUserRole = info.user.role,
                lastKnownDeviceProfile = info.profile,
                lastKnownPermissionsJson = permissionsJson,
            )
            settings = secureSettings.settings.value
        } catch (err: ApiException) {
            if (err.statusCode == 401 || err.statusCode == 403) {
                secureSettings.clearBinding()
                markFailed(taskId, task.sha256, task.fileSize, "Device authorization was revoked")
                return UploadExecutionResult.Failure
            }
            // Temporary server failures fall back to the last known permission snapshot.
        } catch (_: Exception) {
            // Network unavailable: keep the queued task governed by cached permissions.
        }
        val serverAllowsUpload = if (task.sourceKind == "manual_share") {
            settings.serverAllowsManualUpload()
        } else {
            settings.serverAllowsAutoUpload()
        }
        if (!serverAllowsUpload) {
            markFailed(taskId, task.sha256, task.fileSize, "Server permission does not allow this upload")
            return UploadExecutionResult.Failure
        }

        database.dao().updateUploadTask(
            id = taskId,
            status = "uploading",
            sha256 = task.sha256,
            fileSize = task.fileSize,
            serverImageId = null,
            lastError = null,
            attemptDelta = 0,
            updatedAt = System.currentTimeMillis(),
        )

        return try {
            val uri = Uri.parse(task.uri)
            val digest = appContext.contentResolver.computeSha256(uri)

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
                return UploadExecutionResult.Success
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
                return UploadExecutionResult.Success
            }

            val mimeType = resolveMimeType(uri)
            if (mimeType == null) {
                markFailed(taskId, digest.sha256, digest.fileSize, "Unsupported image type")
                return UploadExecutionResult.Failure
            }

            val response = apiClient.uploadImage(
                serverBaseUrl = settings.serverBaseUrl,
                deviceToken = token,
                resolver = appContext.contentResolver,
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
            UploadExecutionResult.Success
        } catch (err: ApiException) {
            val terminal = err.statusCode in setOf(400, 401, 403, 404, 422)
            val retryable = !terminal && runAttemptCount < MAX_RETRY_ATTEMPTS
            markTaskStatus(taskId, retryable, task.sha256, task.fileSize, "${err.apiCode}: ${err.message}")
            if (retryable) UploadExecutionResult.Retry else UploadExecutionResult.Failure
        } catch (err: CancellationException) {
            throw err
        } catch (err: Exception) {
            val retryable = runAttemptCount < MAX_RETRY_ATTEMPTS
            markTaskStatus(
                taskId,
                retryable,
                task.sha256,
                task.fileSize,
                err.message ?: err.javaClass.simpleName,
            )
            if (retryable) UploadExecutionResult.Retry else UploadExecutionResult.Failure
        }
    }

    private suspend fun markFailed(taskId: String, sha256: String?, fileSize: Long?, reason: String) {
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
        val detected = appContext.contentResolver.detectImageMimeType(uri)
        if (detected != null) return detected
        return appContext.contentResolver.getType(uri)?.takeIf { it.startsWith("image/") }
    }

    companion object {
        private const val MAX_RETRY_ATTEMPTS = 5
        private val executionMutex = Mutex()
        private val sharedApiClient = StudyShotApiClient()
    }
}
