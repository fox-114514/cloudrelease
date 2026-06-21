package com.studyshot.relay.network

data class RegisterDeviceRequest(
    val bindCode: String,
    val deviceName: String,
    val platform: String = "android",
    val osVersion: String,
    val appVersion: String,
    val profile: String? = null,
)

data class RegisterDeviceResponse(
    val deviceId: String,
    val deviceToken: String,
    val profile: String?,
    val permissions: DevicePermissions,
    val user: UserSummary,
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

/** Compact summary returned to clients when registering or refreshing self. */
data class UserSummary(
    val id: String,
    val ownerUserId: String,
    val role: String,
    val displayName: String?,
)

data class CreateBindCodeRequest(
    val purpose: String = "bind_device",
    val userId: String? = null,
    val deviceNameHint: String? = null,
    val expiresInSeconds: Int = 600,
)

data class CreateBindCodeResponse(
    val bindCode: String,
    val expiresAt: String,
    val targetUser: BindCodeTargetUser?,
)

data class BindCodeTargetUser(
    val id: String,
    val role: String,
    val displayName: String?,
)

data class BindCodePreview(
    val expiresAt: String,
    val space: BindCodeSpace,
    val targetUser: BindCodeTargetUser,
)

data class BindCodeSpace(
    val ownerUserId: String,
    val displayName: String,
)

data class DeviceSelfInfo(
    val device: DeviceSelfDevice,
    val user: UserSummary,
    val profile: String,
    val permissions: DevicePermissions,
)

data class DeviceSelfDevice(
    val id: String,
    val name: String,
    val platform: String,
    val appVersion: String,
    val osVersion: String,
    val createdAt: String,
    val lastSeenAt: String?,
    val revokedAt: String?,
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
    val userRole: String?,
    val userDisplayName: String?,
    val name: String,
    val platform: String,
    val revokedAt: String?,
    val profile: String?,
    val permissions: DevicePermissions,
)

data class LibraryImageUploadedBy(
    val userId: String,
    val userDisplayName: String,
    val deviceId: String,
    val deviceName: String,
)

data class LibraryImage(
    val id: String,
    val mimeType: String,
    val fileSize: Long,
    val width: Int?,
    val height: Int?,
    val sha256: String,
    val sourceKind: String,
    val sourceDisplayName: String?,
    val uploadedBy: LibraryImageUploadedBy,
    val createdAt: String,
    val expiresAt: String,
    val isExpired: Boolean,
)

data class ImageLibraryPage(
    val images: List<LibraryImage>,
    val nextCursor: String?,
)

data class ApiError(
    val code: String,
    val message: String,
)