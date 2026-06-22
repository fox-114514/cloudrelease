package com.studyshot.relay.upload

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class UploadWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val taskId = inputData.getString(KEY_TASK_ID) ?: return Result.failure()
        return when (UploadTaskExecutor(applicationContext).execute(taskId, runAttemptCount)) {
            UploadExecutionResult.Success -> Result.success()
            UploadExecutionResult.Retry -> Result.retry()
            UploadExecutionResult.Failure -> Result.failure()
        }
    }

    companion object {
        const val KEY_TASK_ID = "task_id"
    }
}
