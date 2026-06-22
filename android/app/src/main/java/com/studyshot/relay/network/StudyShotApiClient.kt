package com.studyshot.relay.network

import android.content.ContentResolver
import android.net.Uri
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ApiException(
    val statusCode: Int,
    val apiCode: String,
    override val message: String,
) : IOException(message)

class StudyShotApiClient(
    private val client: OkHttpClient = defaultClient(),
) {
    fun rawClient(): OkHttpClient = client

    suspend fun registerDevice(
        serverBaseUrl: String,
        request: RegisterDeviceRequest,
    ): RegisterDeviceResponse {
        val json = JSONObject()
            .put("bindCode", request.bindCode.trim())
            .put("deviceName", request.deviceName)
            .put("platform", request.platform)
            .put("osVersion", request.osVersion)
            .put("appVersion", request.appVersion)
        if (!request.profile.isNullOrBlank()) {
            json.put("profile", request.profile)
        }

        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/devices/register"))
            .post(json.toString().toRequestBody(JSON))
            .build()

        val data = executeJson(httpRequest)
        return RegisterDeviceResponse(
            deviceId = data.getString("deviceId"),
            deviceToken = data.getString("deviceToken"),
            profile = data.optString("profile").takeIf { it.isNotBlank() },
            permissions = parsePermissions(data.getJSONObject("permissions")),
            user = parseUserSummary(data.getJSONObject("user")),
        )
    }

    suspend fun login(
        serverBaseUrl: String,
        login: String,
        password: String,
    ): LoginResponse {
        val json = JSONObject()
            .put("login", login)
            .put("password", password)
            .toString()

        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/auth/login"))
            .post(json.toRequestBody(JSON))
            .build()

        val data = executeJson(httpRequest)
        val user = data.getJSONObject("user")
        return LoginResponse(
            accessToken = data.getString("accessToken"),
            user = UserInfo(
                id = user.getString("id"),
                ownerUserId = user.getString("ownerUserId"),
                role = user.getString("role"),
                displayName = user.optString("displayName").takeIf { it.isNotBlank() },
                emailOrLogin = user.optString("emailOrLogin").takeIf { it.isNotBlank() },
            ),
        )
    }

    suspend fun createBindCode(
        serverBaseUrl: String,
        accessToken: String,
        request: CreateBindCodeRequest,
    ): CreateBindCodeResponse {
        val json = JSONObject()
            .put("purpose", request.purpose)
            .put("expiresInSeconds", request.expiresInSeconds)
        request.userId?.takeIf { it.isNotBlank() }?.let { json.put("userId", it) }
        request.deviceNameHint?.takeIf { it.isNotBlank() }?.let { json.put("deviceNameHint", it) }

        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/bind-codes"))
            .header("Authorization", "Bearer $accessToken")
            .post(json.toString().toRequestBody(JSON))
            .build()

        val data = executeJson(httpRequest)
        return CreateBindCodeResponse(
            bindCode = data.getString("bindCode"),
            expiresAt = data.getString("expiresAt"),
            targetUser = data.optJSONObject("targetUser")?.let(::parseBindCodeTargetUser),
        )
    }

    suspend fun previewBindCode(
        serverBaseUrl: String,
        bindCode: String,
    ): BindCodePreview {
        val json = JSONObject().put("bindCode", bindCode.trim()).toString()
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/bind-codes/preview"))
            .post(json.toRequestBody(JSON))
            .build()

        val data = executeJson(httpRequest)
        val space = data.getJSONObject("space")
        val target = data.getJSONObject("targetUser")
        return BindCodePreview(
            expiresAt = data.getString("expiresAt"),
            space = BindCodeSpace(
                ownerUserId = space.getString("ownerUserId"),
                displayName = space.getString("displayName"),
            ),
            targetUser = BindCodeTargetUser(
                id = target.getString("id"),
                role = target.getString("role"),
                displayName = target.optString("displayName").takeIf { it.isNotBlank() },
            ),
        )
    }

    suspend fun getDeviceMe(
        serverBaseUrl: String,
        deviceToken: String,
    ): DeviceSelfInfo {
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/devices/me"))
            .header("Authorization", "Bearer $deviceToken")
            .get()
            .build()

        val data = executeJson(httpRequest)
        val device = data.getJSONObject("device")
        val user = data.getJSONObject("user")
        return DeviceSelfInfo(
            device = DeviceSelfDevice(
                id = device.getString("id"),
                name = device.getString("name"),
                platform = device.getString("platform"),
                appVersion = device.getString("appVersion"),
                osVersion = device.getString("osVersion"),
                createdAt = device.getString("createdAt"),
                lastSeenAt = device.optString("lastSeenAt").takeIf { it.isNotBlank() },
                revokedAt = device.optString("revokedAt").takeIf { it.isNotBlank() },
            ),
            user = parseUserSummary(user),
            profile = data.optString("profile", "custom"),
            permissions = parsePermissions(data.getJSONObject("permissions")),
        )
    }

    suspend fun updateDeviceProfile(
        serverBaseUrl: String,
        accessToken: String,
        deviceId: String,
        profile: String,
    ) {
        val json = JSONObject().put("profile", profile).toString()
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/devices/$deviceId/profile"))
            .header("Authorization", "Bearer $accessToken")
            .patch(json.toRequestBody(JSON))
            .build()

        executeJson(httpRequest)
    }

    suspend fun updateReceiveConfig(
        serverBaseUrl: String,
        accessToken: String,
        deviceId: String,
        mode: String,
        sourceDeviceIds: List<String> = emptyList(),
    ) {
        val json = JSONObject()
            .put("mode", mode)
        if (mode == "selected_devices") {
            val arr = org.json.JSONArray()
            sourceDeviceIds.forEach { arr.put(it) }
            json.put("sourceDeviceIds", arr)
        }
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/devices/$deviceId/receive-config"))
            .header("Authorization", "Bearer $accessToken")
            .put(json.toString().toRequestBody(JSON))
            .build()

        executeJson(httpRequest)
    }

    suspend fun listDevices(
        serverBaseUrl: String,
        accessToken: String,
    ): List<ManagedDevice> {
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/devices"))
            .header("Authorization", "Bearer $accessToken")
            .get()
            .build()

        val data = executeJson(httpRequest)
        val devicesJson = data.optJSONArray("devices") ?: org.json.JSONArray()
        return buildList {
            for (index in 0 until devicesJson.length()) {
                val json = devicesJson.getJSONObject(index)
                add(
                    ManagedDevice(
                        id = json.getString("id"),
                        userId = json.getString("userId"),
                        userRole = json.optString("userRole").takeIf { it.isNotBlank() },
                        userDisplayName = json.optString("userDisplayName").takeIf { it.isNotBlank() },
                        name = json.getString("name"),
                        platform = json.getString("platform"),
                        revokedAt = json.optString("revokedAt").takeIf { it.isNotBlank() },
                        profile = json.optString("profile").takeIf { it.isNotBlank() },
                        permissions = parsePermissions(json.getJSONObject("permissions")),
                    )
                )
            }
        }
    }

    suspend fun listImages(
        serverBaseUrl: String,
        accessToken: String,
        filter: String = "all",
        before: String? = null,
        limit: Int = 50,
        userId: String? = null,
    ): ImageLibraryPage {
        val urlBuilder = apiUrl(serverBaseUrl, "/api/v1/images").toHttpUrl().newBuilder()
            .addQueryParameter("filter", filter)
            .addQueryParameter("limit", limit.toString())
        if (!before.isNullOrBlank()) {
            urlBuilder.addQueryParameter("before", before)
        }
        if (!userId.isNullOrBlank()) {
            urlBuilder.addQueryParameter("userId", userId)
        }

        val httpRequest = Request.Builder()
            .url(urlBuilder.build())
            .header("Authorization", "Bearer $accessToken")
            .get()
            .build()

        val data = executeJson(httpRequest)
        val imagesJson = data.optJSONArray("images") ?: org.json.JSONArray()
        val images = buildList {
            for (index in 0 until imagesJson.length()) {
                val json = imagesJson.getJSONObject(index)
                val uploadedByJson = json.getJSONObject("uploadedBy")
                add(
                    LibraryImage(
                        id = json.getString("id"),
                        mimeType = json.getString("mimeType"),
                        fileSize = json.getLong("fileSize"),
                        width = json.optInt("width").takeIf { !json.isNull("width") },
                        height = json.optInt("height").takeIf { !json.isNull("height") },
                        sha256 = json.getString("sha256"),
                        sourceKind = json.optString("sourceKind", "unknown"),
                        sourceDisplayName = json.optString("sourceDisplayName").takeIf { it.isNotBlank() },
                        uploadedBy = LibraryImageUploadedBy(
                            userId = uploadedByJson.getString("userId"),
                            userDisplayName = uploadedByJson.getString("userDisplayName"),
                            deviceId = uploadedByJson.getString("deviceId"),
                            deviceName = uploadedByJson.getString("deviceName"),
                        ),
                        createdAt = json.getString("createdAt"),
                        expiresAt = json.getString("expiresAt"),
                        isExpired = json.optBoolean("isExpired", false),
                    )
                )
            }
        }

        return ImageLibraryPage(
            images = images,
            nextCursor = data.optString("nextCursor").takeIf { it.isNotBlank() },
        )
    }

    suspend fun deleteImage(
        serverBaseUrl: String,
        accessToken: String,
        imageId: String,
    ) {
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/images/$imageId"))
            .header("Authorization", "Bearer $accessToken")
            .delete()
            .build()

        executeJson(httpRequest)
    }

    suspend fun updateDevicePermission(
        serverBaseUrl: String,
        accessToken: String,
        deviceId: String,
        key: String,
        value: Boolean,
    ) {
        val json = JSONObject().put(key, value)
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/devices/$deviceId/permissions"))
            .header("Authorization", "Bearer $accessToken")
            .patch(json.toString().toRequestBody(JSON))
            .build()

        executeJson(httpRequest)
    }

    suspend fun revokeDevice(
        serverBaseUrl: String,
        accessToken: String,
        deviceId: String,
    ) {
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/devices/$deviceId/revoke"))
            .header("Authorization", "Bearer $accessToken")
            .post(ByteArray(0).toRequestBody())
            .build()

        executeJson(httpRequest)
    }

    suspend fun deleteDevice(
        serverBaseUrl: String,
        accessToken: String,
        deviceId: String,
    ) {
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/devices/$deviceId"))
            .header("Authorization", "Bearer $accessToken")
            .delete()
            .build()

        executeJson(httpRequest)
    }

    suspend fun uploadImage(
        serverBaseUrl: String,
        deviceToken: String,
        resolver: ContentResolver,
        uri: Uri,
        sha256: String,
        mimeType: String,
        sourceKind: String,
        sourceDisplayName: String?,
        sourceMediaIdHash: String?,
    ): UploadImageResponse {
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IOException("Unable to open image stream")

        val builder = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("sha256", sha256)
            .addFormDataPart("sourceKind", sourceKind)
            .addFormDataPart("file", "studyshot-upload", bytes.toRequestBody(mimeType.toMediaType()))

        if (!sourceDisplayName.isNullOrBlank()) {
            builder.addFormDataPart("sourceDisplayName", sourceDisplayName)
        }
        if (!sourceMediaIdHash.isNullOrBlank()) {
            builder.addFormDataPart("sourceMediaIdHash", sourceMediaIdHash)
        }

        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/images"))
            .header("Authorization", "Bearer $deviceToken")
            .post(builder.build())
            .build()

        val data = executeJson(httpRequest)
        return UploadImageResponse(
            imageId = data.getString("imageId"),
            deduplicated = data.optBoolean("deduplicated", false),
            createdDeliveriesCount = data.optInt("createdDeliveriesCount", 0),
            expiresAt = data.getString("expiresAt"),
        )
    }

    suspend fun getPendingDeliveries(
        serverBaseUrl: String,
        deviceToken: String,
    ): PendingDeliveriesResponse {
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/deliveries/pending"))
            .header("Authorization", "Bearer $deviceToken")
            .get()
            .build()

        val data = executeJson(httpRequest)
        val deliveriesJson = data.optJSONArray("deliveries") ?: org.json.JSONArray()
        val deliveries = buildList {
            for (index in 0 until deliveriesJson.length()) {
                add(parseDelivery(deliveriesJson.getJSONObject(index)))
            }
        }
        return PendingDeliveriesResponse(
            deliveries = deliveries,
            totalPending = data.optInt("totalPending", deliveries.size),
            hasMore = data.optBoolean("hasMore", false),
        )
    }

    suspend fun downloadImage(
        serverBaseUrl: String,
        deviceToken: String,
        imageId: String,
    ): DownloadedImage = withContext(Dispatchers.IO) {
        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/images/$imageId/download"))
            .header("Authorization", "Bearer $deviceToken")
            .get()
            .build()

        client.newCall(httpRequest).execute().use { response ->
            if (!response.isSuccessful) {
                val bodyText = response.body?.string().orEmpty()
                val envelope = if (bodyText.isBlank()) JSONObject() else JSONObject(bodyText)
                val error = envelope.optJSONObject("error")
                throw ApiException(
                    response.code,
                    error?.optString("code") ?: "HTTP_${response.code}",
                    error?.optString("message") ?: response.message,
                )
            }
            return@withContext DownloadedImage(
                bytes = response.body?.bytes() ?: throw IOException("Empty image response"),
                mimeType = response.header("Content-Type")?.substringBefore(';') ?: "application/octet-stream",
            )
        }
    }

    suspend fun ackDelivery(
        serverBaseUrl: String,
        deviceToken: String,
        deliveryId: String,
        status: String,
        errorMessage: String? = null,
        localPathHint: String? = null,
    ) {
        val json = JSONObject()
            .put("status", status)
        if (!errorMessage.isNullOrBlank()) {
            json.put("errorMessage", errorMessage)
        }
        if (!localPathHint.isNullOrBlank()) {
            json.put("localPathHint", localPathHint)
        }

        val httpRequest = Request.Builder()
            .url(apiUrl(serverBaseUrl, "/api/v1/deliveries/$deliveryId/ack"))
            .header("Authorization", "Bearer $deviceToken")
            .post(json.toString().toRequestBody(JSON))
            .build()

        executeJson(httpRequest)
    }

    private suspend fun executeJson(request: Request): JSONObject = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val bodyText = response.body?.string().orEmpty()
            val envelope = when {
                bodyText.isBlank() -> JSONObject()
                bodyText.trimStart().startsWith("{") -> try {
                    JSONObject(bodyText)
                } catch (err: org.json.JSONException) {
                    throw ApiException(
                        response.code,
                        "INVALID_JSON",
                        "服务器返回了非 JSON 响应：${bodyText.take(200)}",
                    )
                }
                else -> JSONObject()
            }
            if (!response.isSuccessful || envelope.optBoolean("success") != true) {
                val error = envelope.optJSONObject("error")
                throw ApiException(
                    response.code,
                    error?.optString("code") ?: "HTTP_${response.code}",
                    error?.optString("message") ?: response.message,
                )
            }
            return@withContext envelope.getJSONObject("data")
        }
    }

    private fun parsePermissions(json: JSONObject): DevicePermissions {
        return DevicePermissions(
            canAutoUpload = json.optBoolean("canAutoUpload", false),
            canManualUpload = json.optBoolean("canManualUpload", false),
            canAutoReceive = json.optBoolean("canAutoReceive", false),
            canManualDownload = json.optBoolean("canManualDownload", false),
            canManageSpace = json.optBoolean("canManageSpace", false),
            canCreateInvite = json.optBoolean("canCreateInvite", false),
            autoUploadScope = json.optString("autoUploadScope", "screenshot_only"),
            autoReceiveScope = json.optString("autoReceiveScope", "disabled"),
        )
    }

    fun parseDelivery(json: JSONObject): DeliveryPayload {
        val image = json.getJSONObject("image")
        val source = json.getJSONObject("source")
        return DeliveryPayload(
            deliveryId = json.getString("deliveryId"),
            image = ImageMeta(
                id = image.getString("id"),
                mimeType = image.getString("mimeType"),
                fileSize = image.optLong("fileSize"),
                width = image.optNullableInt("width"),
                height = image.optNullableInt("height"),
                sha256 = image.getString("sha256"),
            ),
            source = DeliverySource(
                uploadUserId = source.getString("uploadUserId"),
                uploadDeviceId = source.getString("uploadDeviceId"),
                uploadDeviceName = source.optString("uploadDeviceName").takeIf { it.isNotBlank() },
            ),
            createdAt = json.getString("createdAt"),
            expiresAt = json.getString("expiresAt"),
        )
    }

    private fun parseUserSummary(json: JSONObject): UserSummary = UserSummary(
        id = json.getString("id"),
        ownerUserId = json.getString("ownerUserId"),
        role = json.getString("role"),
        displayName = json.optString("displayName").takeIf { it.isNotBlank() },
    )

    private fun parseBindCodeTargetUser(json: JSONObject): BindCodeTargetUser = BindCodeTargetUser(
        id = json.getString("id"),
        role = json.getString("role"),
        displayName = json.optString("displayName").takeIf { it.isNotBlank() },
    )

    private fun JSONObject.optNullableInt(name: String): Int? {
        return if (isNull(name)) null else optInt(name)
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        fun defaultClient(): OkHttpClient {
            return OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .build()
        }

        fun apiUrl(serverBaseUrl: String, path: String): String {
            return serverBaseUrl.trimEnd('/') + path
        }

        fun wsUrl(serverBaseUrl: String): String {
            val normalized = serverBaseUrl.trimEnd('/')
            return when {
                normalized.startsWith("https://") -> normalized.replaceFirst("https://", "wss://") + "/api/v1/ws"
                normalized.startsWith("http://") -> normalized.replaceFirst("http://", "ws://") + "/api/v1/ws"
                else -> "wss://$normalized/api/v1/ws"
            }
        }
    }
}
