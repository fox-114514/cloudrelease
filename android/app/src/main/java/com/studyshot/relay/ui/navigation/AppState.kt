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
import com.studyshot.relay.network.LibraryImage
import com.studyshot.relay.network.ManagedDevice
import com.studyshot.relay.network.RegisterDeviceRequest
import com.studyshot.relay.upload.MediaStoreScanner
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

    fun bindDevice(server: String, code: String, name: String) {
        val normalized = SecureSettings.normalizeBaseUrl(server)
        if (normalized.isBlank()) {
            emit(TransientMessage("服务器地址不能为空", StatusTone.Critical))
            return
        }
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            emit(TransientMessage("服务器地址必须以 http:// 或 https:// 开头", StatusTone.Critical))
            return
        }
        if (code.isBlank()) {
            emit(TransientMessage("绑定码不能为空", StatusTone.Critical))
            return
        }
        val finalName = name.ifBlank { android.os.Build.MODEL }
        scope.launch {
            try {
                val response = app.apiClient.registerDevice(
                    serverBaseUrl = normalized,
                    request = RegisterDeviceRequest(
                        bindCode = code,
                        deviceName = finalName,
                        osVersion = "Android ${android.os.Build.VERSION.RELEASE}",
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                )
                withContext(Dispatchers.IO) {
                    settingsWriteMutex.withLock {
                        app.secureSettings.saveBinding(
                            serverBaseUrl = normalized,
                            deviceId = response.deviceId,
                            deviceToken = response.deviceToken,
                            deviceName = finalName,
                        )
                    }
                }
                emit(TransientMessage("绑定成功", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage("绑定失败：${err.message ?: err.javaClass.simpleName}", StatusTone.Critical))
            }
        }
    }

    fun pickManualUpload(uri: Uri) {
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

    fun adminLogin(server: String, login: String, password: String) {
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
                if (response.user.role == "owner") {
                    refreshImageLibrary(session, normalized, reset = true)
                } else {
                    _libraryImages.value = emptyList()
                    _imageCursor.value = null
                }
                emit(TransientMessage("管理登录成功", StatusTone.Positive))
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "管理登录失败", StatusTone.Critical))
            }
        }
    }

    fun adminLogout() {
        _adminSession.value = null
        _adminDevices.value = emptyList()
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
        val session = _adminSession.value ?: return
        refreshImageLibrary(session, app.secureSettings.settings.value.serverBaseUrl, reset = true)
    }

    fun refreshImageLibraryFromSession() {
        val session = _adminSession.value ?: return
        refreshImageLibrary(session, app.secureSettings.settings.value.serverBaseUrl, reset = true)
    }

    fun loadMoreImages() {
        val session = _adminSession.value ?: return
        val cursor = _imageCursor.value ?: return
        scope.launch {
            try {
                val page = withContext(Dispatchers.IO) {
                    app.apiClient.listImages(
                        serverBaseUrl = app.secureSettings.settings.value.serverBaseUrl,
                        accessToken = session.accessToken,
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
        if (session.user.role != "owner") {
            _libraryImages.value = emptyList()
            _imageCursor.value = null
            return
        }
        _imageLoading.value = true
        scope.launch {
            try {
                val page = withContext(Dispatchers.IO) {
                    app.apiClient.listImages(
                        serverBaseUrl = server,
                        accessToken = session.accessToken,
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

    fun createBindCode(hint: String) {
        val session = _adminSession.value ?: return
        scope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    app.apiClient.createBindCode(
                        app.secureSettings.settings.value.serverBaseUrl,
                        session.accessToken,
                        hint,
                    )
                }
                emit(
                    TransientMessage(
                        "绑定码：${response.bindCode}（${response.expiresAt} 到期）",
                        StatusTone.Positive,
                    )
                )
            } catch (err: Exception) {
                emit(TransientMessage(err.message ?: "创建绑定码失败", StatusTone.Critical))
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
