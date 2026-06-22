package com.studyshot.relay.ui.navigation

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import com.studyshot.relay.StudyShotApp
import com.studyshot.relay.BuildConfig
import com.studyshot.relay.data.SecureSettings
import com.studyshot.relay.network.AdminSession
import com.studyshot.relay.network.ApiException
import com.studyshot.relay.network.CreateBindCodeRequest
import com.studyshot.relay.network.CreateBindCodeResponse
import com.studyshot.relay.network.DeviceSelfInfo
import com.studyshot.relay.network.LibraryImage
import com.studyshot.relay.network.ManagedDevice
import com.studyshot.relay.network.RegisterDeviceRequest
import com.studyshot.relay.upload.MediaStoreScanner
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

@Stable
class AppState internal constructor(
    val app: StudyShotApp,
    val scope: CoroutineScope,
) {
    private val settingsWriteMutex = Mutex()
    private val _transient = MutableStateFlow<TransientMessage?>(null)
    val transient: StateFlow<TransientMessage?> = _transient.asStateFlow()

    private val _adminSession = MutableStateFlow<AdminSession?>(null)
    val adminSession: StateFlow<AdminSession?> = _adminSession.asStateFlow()

    private val _adminDevices = MutableStateFlow<List<ManagedDevice>>(emptyList())
    val adminDevices: StateFlow<List<ManagedDevice>> = _adminDevices.asStateFlow()

    private val _generatedBindCode = MutableStateFlow<CreateBindCodeResponse?>(null)
    val generatedBindCode: StateFlow<CreateBindCodeResponse?> = _generatedBindCode.asStateFlow()

    private val _libraryImages = MutableStateFlow<List<LibraryImage>>(emptyList())
    val libraryImages: StateFlow<List<LibraryImage>> = _libraryImages.asStateFlow()

    private val _imageCursor = MutableStateFlow<String?>(null)
    val imageCursor: StateFlow<String?> = _imageCursor.asStateFlow()

    private val _imageFilter = MutableStateFlow("all")
    val imageFilter: StateFlow<String> = _imageFilter.asStateFlow()

    private val _imageLoading = MutableStateFlow(false)
    val imageLoading: StateFlow<Boolean> = _imageLoading.asStateFlow()

    fun emit(message: TransientMessage) {
        _transient.value = message
    }

    fun clearTransient() {
        _transient.value = null
    }

    fun saveUploadSettings(
        autoUploadEnabled: Boolean? = null,
        realtimeModeEnabled: Boolean? = null,
        wifiOnly: Boolean? = null,
        autoUploadScope: String? = null,
        selectedAlbumPaths: List<String>? = null,
        excludedAlbumPaths: List<String>? = null,
    ) {
        if (autoUploadEnabled == true && !app.secureSettings.settings.value.serverAllowsAutoUpload()) {
            emit(TransientMessage("服务端未允许本设备自动上传", StatusTone.Critical))
            return
        }
        scope.launch(Dispatchers.IO) {
            settingsWriteMutex.withLock {
                val current = app.secureSettings.settings.value
                app.secureSettings.saveUploadSettings(
                    autoUploadEnabled = autoUploadEnabled ?: current.autoUploadEnabled,
                    realtimeModeEnabled = realtimeModeEnabled ?: current.realtimeModeEnabled,
                    wifiOnly = wifiOnly ?: current.wifiOnly,
                    autoUploadScope = autoUploadScope ?: current.autoUploadScope,
                    selectedAlbumPaths = selectedAlbumPaths ?: current.selectedAlbumPaths,
                    excludedAlbumPaths = excludedAlbumPaths ?: current.excludedAlbumPaths,
                )
            }
        }
    }

    fun saveReceiveSettings(
        autoReceiveEnabled: Boolean? = null,
        downloadNotificationEnabled: Boolean? = null,
        saveDownloadsToGallery: Boolean? = null,
    ) {
        if (autoReceiveEnabled == true && !app.secureSettings.settings.value.serverAllowsAutoReceive()) {
            emit(TransientMessage("服务端未允许本设备自动接收", StatusTone.Critical))
            return
        }
        scope.launch(Dispatchers.IO) {
            settingsWriteMutex.withLock {
                val current = app.secureSettings.settings.value
                app.secureSettings.saveReceiveSettings(
                    autoReceiveEnabled = autoReceiveEnabled ?: current.autoReceiveEnabled,
                    downloadNotificationEnabled = downloadNotificationEnabled ?: current.downloadNotificationEnabled,
                    saveDownloadsToGallery = saveDownloadsToGallery ?: current.saveDownloadsToGallery,
                )
            }
        }
    }

    fun saveServerAndDeviceName(server: String, deviceName: String) {
        scope.launch(Dispatchers.IO) {
            settingsWriteMutex.withLock {
                app.secureSettings.saveServerAndDeviceName(
                    SecureSettings.normalizeBaseUrl(server),
                    deviceName,
                )
            }
        }
    }

    fun addAlbumPath(path: String) {
        val current = app.secureSettings.settings.value
        val updated = (current.selectedAlbumPaths + path).distinct().sorted()
        saveUploadSettings(
            autoUploadScope = "selected_album",
            selectedAlbumPaths = updated,
        )
    }

    fun removeAlbumPath(path: String) {
        val current = app.secureSettings.settings.value
        val updated = current.selectedAlbumPaths.filterNot { it == path }
        val remainingExclusions = current.excludedAlbumPaths.filter { excluded ->
            updated.any { selected -> isSameOrDescendant(excluded, selected) }
        }
        saveUploadSettings(
            selectedAlbumPaths = updated,
            excludedAlbumPaths = remainingExclusions,
        )
    }

    fun addExcludedAlbumPath(path: String) {
        val normalized = MediaStoreScanner.normalizeAlbumPath(path) ?: return
        val current = app.secureSettings.settings.value
        val isInsideSelectedAlbum = current.selectedAlbumPaths.any { selected ->
            isStrictDescendant(normalized, selected)
        }
        if (!isInsideSelectedAlbum) {
            emit(TransientMessage("排除目录必须是已监听目录的子文件夹", StatusTone.Critical))
            return
        }
        val updated = (current.excludedAlbumPaths + normalized).distinct().sorted()
        saveUploadSettings(excludedAlbumPaths = updated)
        emit(TransientMessage("已排除目录：$normalized", StatusTone.Positive))
    }

    fun removeExcludedAlbumPath(path: String) {
        val current = app.secureSettings.settings.value
        saveUploadSettings(excludedAlbumPaths = current.excludedAlbumPaths.filterNot { it == path })
    }

    fun bindDevice(
        server: String,
        code: String,
        name: String,
        profile: String? = null,
        onComplete: () -> Unit = {},
    ) {
        val normalized = SecureSettings.normalizeBaseUrl(server)
        val normalizedCode = code.trim()
        if (normalized.isBlank()) {
            emit(TransientMessage("服务器地址不能为空", StatusTone.Critical))
            onComplete()
            return
        }
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            emit(TransientMessage("服务器地址必须以 http:// 或 https:// 开头", StatusTone.Critical))
            onComplete()
            return
        }
        if (normalizedCode.isBlank()) {
            emit(TransientMessage("绑定码不能为空", StatusTone.Critical))
            onComplete()
            return
        }
        val finalName = name.ifBlank { android.os.Build.MODEL }
        scope.launch {
            try {
                val response = app.apiClient.registerDevice(
                    serverBaseUrl = normalized,
                    request = RegisterDeviceRequest(
                        bindCode = normalizedCode,
                        deviceName = finalName,
                        osVersion = "Android ${android.os.Build.VERSION.RELEASE}",
                        appVersion = BuildConfig.VERSION_NAME,
                        profile = profile,
                    ),
                )
                withContext(Dispatchers.IO) {
                    settingsWriteMutex.withLock {
                        app.secureSettings.saveBinding(
                            serverBaseUrl = normalized,
                            deviceId = response.deviceId,
                            deviceToken = response.deviceToken,
                            deviceName = finalName,
                            boundUserId = response.user.id,
                            boundOwnerUserId = response.user.ownerUserId,
                            boundUserDisplayName = response.user.displayName ?: "",
                            boundUserRole = response.user.role,
                            lastKnownDeviceProfile = response.profile ?: "custom",
                            lastKnownPermissionsJson = serializePermissions(response.permissions),
                        )
                    }
                }
                emit(TransientMessage("绑定成功", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage("绑定失败：${err.message ?: err.javaClass.simpleName}", StatusTone.Critical))
            } finally {
                onComplete()
            }
        }
    }

    /**
     * Self-service bind: log in with the user account, ask the server to mint
     * a bind code targeted at the same user (server enforces identity), then
     * register the device. The temporary user JWT is discarded after register.
     */
    fun bindWithLogin(
        server: String,
        login: String,
        password: String,
        deviceName: String,
        profile: String,
        onComplete: () -> Unit = {},
    ) {
        val normalized = SecureSettings.normalizeBaseUrl(server)
        if (normalized.isBlank()) {
            emit(TransientMessage("服务器地址不能为空", StatusTone.Critical))
            onComplete()
            return
        }
        val finalName = deviceName.ifBlank { android.os.Build.MODEL }
        scope.launch {
            try {
                val loginResp = withContext(Dispatchers.IO) {
                    app.apiClient.login(normalized, login, password)
                }
                // Server enforces that the bind code is for the same user when
                // we omit userId. We never send a different userId here.
                val bindResp = withContext(Dispatchers.IO) {
                    app.apiClient.createBindCode(
                        serverBaseUrl = normalized,
                        accessToken = loginResp.accessToken,
                        request = CreateBindCodeRequest(
                            purpose = "bind_device",
                            deviceNameHint = finalName,
                            expiresInSeconds = 600,
                        ),
                    )
                }
                val targetUser = bindResp.targetUser
                if (targetUser != null && targetUser.id != loginResp.user.id) {
                    emit(TransientMessage("服务返回的绑定码不属于当前账号，已中止", StatusTone.Critical))
                    return@launch
                }
                val preview = withContext(Dispatchers.IO) {
                    app.apiClient.previewBindCode(normalized, bindResp.bindCode)
                }
                if (preview.targetUser.id != loginResp.user.id) {
                    emit(TransientMessage("绑定码预览身份与当前账号不一致，已中止", StatusTone.Critical))
                    return@launch
                }
                val registerResp = withContext(Dispatchers.IO) {
                    app.apiClient.registerDevice(
                        serverBaseUrl = normalized,
                        request = RegisterDeviceRequest(
                            bindCode = bindResp.bindCode,
                            deviceName = finalName,
                            osVersion = "Android ${android.os.Build.VERSION.RELEASE}",
                            appVersion = BuildConfig.VERSION_NAME,
                            profile = profile,
                        ),
                    )
                }
                withContext(Dispatchers.IO) {
                    settingsWriteMutex.withLock {
                        app.secureSettings.saveBinding(
                            serverBaseUrl = normalized,
                            deviceId = registerResp.deviceId,
                            deviceToken = registerResp.deviceToken,
                            deviceName = finalName,
                            boundUserId = registerResp.user.id,
                            boundOwnerUserId = registerResp.user.ownerUserId,
                            boundUserDisplayName = registerResp.user.displayName ?: "",
                            boundUserRole = registerResp.user.role,
                            lastKnownDeviceProfile = registerResp.profile ?: "custom",
                            lastKnownPermissionsJson = serializePermissions(registerResp.permissions),
                        )
                    }
                }
                emit(TransientMessage("账号绑定成功", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage("账号绑定失败：${err.message ?: err.javaClass.simpleName}", StatusTone.Critical))
            } finally {
                onComplete()
            }
        }
    }

    /**
     * Refresh this device's identity from the server. Should be called after
     * registration, on app start (if already bound), and after 403 responses
     * to pick up revoked / disabled / permission changes.
     */
    fun refreshSelfIdentity() {
        val settings = app.secureSettings.settings.value
        val token = app.secureSettings.getDeviceToken() ?: return
        val server = settings.serverBaseUrl
        if (server.isBlank()) return
        scope.launch {
            try {
                val info = withContext(Dispatchers.IO) {
                    app.apiClient.getDeviceMe(server, token)
                }
                withContext(Dispatchers.IO) {
                    settingsWriteMutex.withLock {
                        app.secureSettings.saveBinding(
                            serverBaseUrl = server,
                            deviceId = info.device.id,
                            deviceToken = token,
                            deviceName = info.device.name,
                            boundUserId = info.user.id,
                            boundOwnerUserId = info.user.ownerUserId,
                            boundUserDisplayName = info.user.displayName ?: "",
                            boundUserRole = info.user.role,
                            lastKnownDeviceProfile = info.profile,
                            lastKnownPermissionsJson = serializePermissions(info.permissions),
                        )
                    }
                }
                if (info.device.revokedAt != null) {
                    emit(TransientMessage("本设备已被撤销，请重新绑定", StatusTone.Critical))
                }
            } catch (err: ApiException) {
                if (err.apiCode == "DEVICE_AUTH_REQUIRED" || err.apiCode == "DEVICE_REVOKED" || err.apiCode == "USER_DISABLED" || err.statusCode == 401 || err.statusCode == 403) {
                    withContext(Dispatchers.IO) {
                        settingsWriteMutex.withLock { app.secureSettings.clearBinding() }
                    }
                    emit(TransientMessage("服务端已不再接受本设备 token，请重新绑定", StatusTone.Critical))
                }
            } catch (_: Exception) {
                // Silent failure: we don't want to spam errors on startup if
                // the server is briefly unavailable.
            }
        }
    }

    private fun serializePermissions(permissions: com.studyshot.relay.network.DevicePermissions): String {
        return JSONObject()
            .put("canAutoUpload", permissions.canAutoUpload)
            .put("canManualUpload", permissions.canManualUpload)
            .put("canAutoReceive", permissions.canAutoReceive)
            .put("canManualDownload", permissions.canManualDownload)
            .put("canManageSpace", permissions.canManageSpace)
            .put("canCreateInvite", permissions.canCreateInvite)
            .put("autoUploadScope", permissions.autoUploadScope)
            .put("autoReceiveScope", permissions.autoReceiveScope)
            .toString()
    }

    fun pickManualUpload(uri: Uri) {
        if (!app.secureSettings.settings.value.serverAllowsManualUpload()) {
            emit(TransientMessage("服务端未允许本设备手动上传", StatusTone.Critical))
            return
        }
        val wifiOnly = app.secureSettings.settings.value.wifiOnly
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    app.uploadRepository.enqueueManualUpload(uri, wifiOnly)
                }
                emit(TransientMessage("已加入上传队列", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage("加入队列失败：${err.message ?: err.javaClass.simpleName}", StatusTone.Critical))
            }
        }
    }

    fun adminLogin(
        server: String,
        login: String,
        password: String,
        onComplete: () -> Unit = {},
    ) {
        val normalized = SecureSettings.normalizeBaseUrl(server.ifBlank { app.secureSettings.settings.value.serverBaseUrl })
        scope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    app.apiClient.login(normalized, login, password)
                }
                val session = AdminSession(response.accessToken, response.user)
                _adminSession.value = session
                withContext(Dispatchers.IO) {
                    settingsWriteMutex.withLock {
                        app.secureSettings.saveServerAndDeviceName(
                            normalized,
                            app.secureSettings.settings.value.deviceName,
                        )
                    }
                }
                refreshDevices(session, normalized)
                refreshImageLibrary(session, normalized, reset = true)
                emit(TransientMessage("管理登录成功", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "管理登录失败", StatusTone.Critical))
            } finally {
                onComplete()
            }
        }
    }

    fun adminLogout() {
        _adminSession.value = null
        _adminDevices.value = emptyList()
        _generatedBindCode.value = null
        _libraryImages.value = emptyList()
        _imageCursor.value = null
    }

    fun refreshDevicesFromSession() {
        val session = _adminSession.value ?: return
        refreshDevices(session, app.secureSettings.settings.value.serverBaseUrl)
    }

    private fun refreshDevices(session: AdminSession, server: String) {
        scope.launch {
            try {
                val list = withContext(Dispatchers.IO) {
                    app.apiClient.listDevices(server, session.accessToken)
                }
                _adminDevices.value = list
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "设备列表刷新失败", StatusTone.Critical))
            }
        }
    }

    fun setImageFilter(filter: String) {
        _imageFilter.value = filter
        refreshImageLibraryFromAvailableAuth(reset = true)
    }

    fun refreshImageLibraryFromSession() {
        refreshImageLibraryFromAvailableAuth(reset = true)
    }

    fun libraryAccessToken(): String? {
        _adminSession.value?.accessToken?.let { return it }
        val settings = app.secureSettings.settings.value
        if (!settings.deviceTokenAvailable || !settings.serverAllowsManualDownload()) return null
        return app.secureSettings.getDeviceToken()
    }

    fun loadMoreImages() {
        val token = libraryAccessToken() ?: return
        val cursor = _imageCursor.value ?: return
        scope.launch {
            try {
                val page = withContext(Dispatchers.IO) {
                    app.apiClient.listImages(
                        serverBaseUrl = app.secureSettings.settings.value.serverBaseUrl,
                        accessToken = token,
                        filter = _imageFilter.value,
                        before = cursor,
                    )
                }
                _libraryImages.update { it + page.images }
                _imageCursor.value = page.nextCursor
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "加载更多失败", StatusTone.Critical))
            }
        }
    }

    private fun refreshImageLibrary(session: AdminSession, server: String, reset: Boolean) {
        refreshImageLibrary(session.accessToken, server, reset)
    }

    private fun refreshImageLibraryFromAvailableAuth(reset: Boolean) {
        val token = libraryAccessToken() ?: return
        refreshImageLibrary(token, app.secureSettings.settings.value.serverBaseUrl, reset)
    }

    private fun refreshImageLibrary(token: String, server: String, reset: Boolean) {
        _imageLoading.value = true
        scope.launch {
            try {
                val page = withContext(Dispatchers.IO) {
                    app.apiClient.listImages(
                        serverBaseUrl = server,
                        accessToken = token,
                        filter = _imageFilter.value,
                        before = if (reset) null else _imageCursor.value,
                    )
                }
                _libraryImages.update { if (reset) page.images else it + page.images }
                _imageCursor.value = page.nextCursor
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "图片库刷新失败", StatusTone.Critical))
            } finally {
                _imageLoading.value = false
            }
        }
    }

    fun deleteImage(image: LibraryImage) {
        val session = _adminSession.value ?: return
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    app.apiClient.deleteImage(
                        app.secureSettings.settings.value.serverBaseUrl,
                        session.accessToken,
                        image.id,
                    )
                }
                _libraryImages.update { it.filterNot { img -> img.id == image.id } }
                emit(TransientMessage("已删除图片", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "删除图片失败", StatusTone.Critical))
            }
        }
    }

    fun updateDevicePermission(deviceId: String, key: String, value: Boolean) {
        val session = _adminSession.value ?: return
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    app.apiClient.updateDevicePermission(
                        app.secureSettings.settings.value.serverBaseUrl,
                        session.accessToken,
                        deviceId,
                        key,
                        value,
                    )
                }
                refreshDevices(session, app.secureSettings.settings.value.serverBaseUrl)
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "权限更新失败", StatusTone.Critical))
            }
        }
    }

    fun updateDeviceProfile(deviceId: String, profile: String) {
        val session = _adminSession.value ?: return
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    app.apiClient.updateDeviceProfile(
                        app.secureSettings.settings.value.serverBaseUrl,
                        session.accessToken,
                        deviceId,
                        profile,
                    )
                }
                refreshDevices(session, app.secureSettings.settings.value.serverBaseUrl)
                emit(TransientMessage("设备用途已更新", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "用途更新失败", StatusTone.Critical))
            }
        }
    }

    fun revokeDevice(deviceId: String) {
        val session = _adminSession.value ?: return
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    app.apiClient.revokeDevice(
                        app.secureSettings.settings.value.serverBaseUrl,
                        session.accessToken,
                        deviceId,
                    )
                }
                refreshDevices(session, app.secureSettings.settings.value.serverBaseUrl)
                emit(TransientMessage("设备已撤销", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "撤销失败", StatusTone.Critical))
            }
        }
    }

    fun deleteDevice(
        deviceId: String,
        onDeleted: () -> Unit = {},
    ) {
        val session = _adminSession.value ?: return
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    app.apiClient.deleteDevice(
                        app.secureSettings.settings.value.serverBaseUrl,
                        session.accessToken,
                        deviceId,
                    )
                }
                _adminDevices.update { devices -> devices.filterNot { it.id == deviceId } }
                emit(TransientMessage("已删除撤销设备", StatusTone.Positive))
                onDeleted()
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "删除设备失败", StatusTone.Critical))
            }
        }
    }

    fun previewBindCode(
        server: String,
        bindCode: String,
        onResult: (Result<com.studyshot.relay.network.BindCodePreview>) -> Unit,
    ) {
        val normalized = SecureSettings.normalizeBaseUrl(server)
        if (normalized.isBlank() || bindCode.isBlank()) {
            onResult(Result.failure(IllegalArgumentException("服务器地址或绑定码为空")))
            return
        }
        scope.launch {
            try {
                val preview = withContext(Dispatchers.IO) {
                    app.apiClient.previewBindCode(normalized, bindCode.trim())
                }
                onResult(Result.success(preview))
            } catch (err: Throwable) {
                onResult(Result.failure(err))
            }
        }
    }

fun createBindCode(
        hint: String,
        targetUserId: String? = null,
        onComplete: () -> Unit = {},
    ) {
        val session = _adminSession.value
        if (session == null) {
            emit(TransientMessage("请先登录管理账号", StatusTone.Critical))
            onComplete()
            return
        }
        scope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    app.apiClient.createBindCode(
                        serverBaseUrl = app.secureSettings.settings.value.serverBaseUrl,
                        accessToken = session.accessToken,
                        request = CreateBindCodeRequest(
                            purpose = "bind_device",
                            userId = targetUserId,
                            deviceNameHint = hint,
                            expiresInSeconds = 600,
                        ),
                    )
                }
                _generatedBindCode.value = response
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "创建绑定码失败", StatusTone.Critical))
            } finally {
                onComplete()
            }
        }
    }

    private fun isSameOrDescendant(candidate: String, parent: String): Boolean {
        val normalizedCandidate = MediaStoreScanner.normalizeAlbumPath(candidate)?.lowercase() ?: return false
        val normalizedParent = MediaStoreScanner.normalizeAlbumPath(parent)?.lowercase() ?: return false
        return normalizedCandidate == normalizedParent || normalizedCandidate.startsWith("$normalizedParent/")
    }

    private fun isStrictDescendant(candidate: String, parent: String): Boolean {
        val normalizedCandidate = MediaStoreScanner.normalizeAlbumPath(candidate)?.lowercase() ?: return false
        val normalizedParent = MediaStoreScanner.normalizeAlbumPath(parent)?.lowercase() ?: return false
        return normalizedCandidate.startsWith("$normalizedParent/")
    }
}

enum class StatusTone { Positive, Neutral, Critical, Warning, Info }

data class TransientMessage(
    val text: String,
    val tone: StatusTone,
    val id: Long = System.nanoTime(),
)

@Composable
fun rememberAppState(app: StudyShotApp): AppState {
    val scope = rememberCoroutineScope()
    return remember(app) { AppState(app, scope) }
}
