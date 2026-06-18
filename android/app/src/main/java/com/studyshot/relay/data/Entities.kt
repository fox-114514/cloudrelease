package com.studyshot.relay.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "upload_tasks",
    indices = [
        Index(value = ["uri"], unique = true),
        Index(value = ["sha256"]),
        Index(value = ["status"]),
    ],
)
data class UploadTaskEntity(
    @PrimaryKey val id: String,
    val uri: String,
    val sourceKind: String,
    val sourceDisplayName: String?,
    val sourceMediaIdHash: String?,
    val sha256: String?,
    val fileSize: Long?,
    val status: String,
    val attemptCount: Int,
    val serverImageId: String?,
    val lastError: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "download_records",
    indices = [
        Index(value = ["imageId"]),
        Index(value = ["sha256"]),
    ],
)
data class DownloadRecordEntity(
    @PrimaryKey val deliveryId: String,
    val imageId: String,
    val sha256: String,
    val localUri: String?,
    val sourceDeviceName: String?,
    val status: String,
    val error: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(tableName = "uploaded_hashes")
data class UploadedHashEntity(
    @PrimaryKey val sha256: String,
    val imageId: String?,
    val createdAt: Long,
)

@Entity(tableName = "received_hashes")
data class ReceivedHashEntity(
    @PrimaryKey val sha256: String,
    val originImageId: String?,
    val receivedAt: Long,
)

@Entity(tableName = "event_logs")
data class EventLogEntity(
    @PrimaryKey val id: String,
    val level: String,
    val message: String,
    val detail: String?,
    val createdAt: Long,
)

