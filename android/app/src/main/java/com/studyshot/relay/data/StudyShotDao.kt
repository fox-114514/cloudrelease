package com.studyshot.relay.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface StudyShotDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertUploadTask(task: UploadTaskEntity)

    @Query("SELECT * FROM upload_tasks ORDER BY createdAt DESC LIMIT :limit")
    fun observeUploadTasks(limit: Int = 50): Flow<List<UploadTaskEntity>>

    @Query("SELECT * FROM upload_tasks WHERE id = :id")
    suspend fun getUploadTask(id: String): UploadTaskEntity?

    @Query(
        """
        UPDATE upload_tasks
        SET status = :status,
            sha256 = COALESCE(:sha256, sha256),
            fileSize = COALESCE(:fileSize, fileSize),
            serverImageId = COALESCE(:serverImageId, serverImageId),
            lastError = :lastError,
            attemptCount = attemptCount + :attemptDelta,
            updatedAt = :updatedAt
        WHERE id = :id
        """
    )
    suspend fun updateUploadTask(
        id: String,
        status: String,
        sha256: String?,
        fileSize: Long?,
        serverImageId: String?,
        lastError: String?,
        attemptDelta: Int,
        updatedAt: Long,
    )

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertUploadedHash(hash: UploadedHashEntity)

    @Query("SELECT EXISTS(SELECT 1 FROM uploaded_hashes WHERE sha256 = :sha256)")
    suspend fun hasUploadedHash(sha256: String): Boolean

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertReceivedHash(hash: ReceivedHashEntity)

    @Query("SELECT EXISTS(SELECT 1 FROM received_hashes WHERE sha256 = :sha256)")
    suspend fun hasReceivedHash(sha256: String): Boolean

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertDownloadRecord(record: DownloadRecordEntity)

    @Query("SELECT * FROM download_records WHERE deliveryId = :deliveryId")
    suspend fun getDownloadRecord(deliveryId: String): DownloadRecordEntity?

    @Query("SELECT * FROM download_records ORDER BY createdAt DESC LIMIT :limit")
    fun observeDownloadRecords(limit: Int = 50): Flow<List<DownloadRecordEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun addEventLog(log: EventLogEntity)

    @Query("SELECT * FROM event_logs ORDER BY createdAt DESC LIMIT :limit")
    fun observeEventLogs(limit: Int = 50): Flow<List<EventLogEntity>>
}
