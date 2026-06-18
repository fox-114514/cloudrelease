package com.studyshot.relay.network

data class RegisterDeviceRequest(
    val bindCode: String,
    val deviceName: String,
    val platform: String = "android",
    val osVersion: String,
    val appVersion: String,
)

data class RegisterDeviceResponse(
    val deviceId: String,
    val deviceToken: String,
    val permissions: DevicePermissions,
)

data class LoginResponse(
    val accessToken: String,
    val user: UserInfo,
)

data class UserInfo(
    val id: String,
    val ownerUserId: String,
    val role: String,
    val displayName: String?,
    val emailOrLogin: String?,
)

data class CreateBindCodeResponse(
    val bindCode: String,
    val expiresAt: String,
)

data class DevicePermissions(
    val canAutoUpload: Boolean = false,
    val canManualUpload: Boolean = false,
    val canAutoReceive: Boolean = false,
    val canManualDownload: Boolean = false,
    val canManageSpace: Boolean = false,
    val canCreateInvite: Boolean = false,
    val autoUploadScope: String = "screenshot_only",
    val autoReceiveScope: String = "disabled",
)

data class UploadImageResponse(
    val imageId: String,
    val deduplicated: Boolean,
    val createdDeliveriesCount: Int,
    val expiresAt: String,
)

data class ImageMeta(
    val id: String,
    val mimeType: String,
    val fileSize: Long,
    val width: Int?,
    val height: Int?,
    val sha256: String,
)

data class DeliverySource(
    val uploadUserId: String,
    val uploadDeviceId: String,
    val uploadDeviceName: String?,
)

data class DeliveryPayload(
    val deliveryId: String,
    val image: ImageMeta,
    val source: DeliverySource,
    val createdAt: String,
    val expiresAt: String,
)

data class PendingDeliveriesResponse(
    val deliveries: List<DeliveryPayload>,
)

data class DownloadedImage(
    val bytes: ByteArray,
    val mimeType: String,
)

data class ManagedDevice(
    val id: String,
    val userId: String,
    val userDisplayName: String?,
    val name: String,
    val platform: String,
    val revokedAt: String?,
    val permissions: DevicePermissions,
)

data class ApiError(
    val code: String,
    val message: String,
)
