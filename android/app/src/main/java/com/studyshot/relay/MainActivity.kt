package com.studyshot.relay

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.studyshot.relay.data.AppSettings
import com.studyshot.relay.data.SecureSettings
import com.studyshot.relay.network.ManagedDevice
import com.studyshot.relay.network.RegisterDeviceRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private val app: StudyShotApp
        get() = application as StudyShotApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleSharedImage(intent)

        setContent {
            StudyShotTheme {
                MainScreen(
                    app = app,
                    hasImagePermission = ::hasImagePermission,
                    hasPartialImagePermission = ::hasPartialImagePermission,
                    startRealtimeService = ::startRealtimeService,
                    stopRealtimeService = ::stopRealtimeService,
                    startReceiveService = ::startReceiveService,
                    stopReceiveService = ::stopReceiveService,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleSharedImage(intent)
    }

    private fun handleSharedImage(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val uri = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        } ?: return

        kotlinx.coroutines.MainScope().launch(Dispatchers.IO) {
            app.uploadRepository.enqueueManualUpload(uri, app.secureSettings.settings.value.wifiOnly)
        }
    }

    private fun hasImagePermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 33) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun hasPartialImagePermission(): Boolean {
        return Build.VERSION.SDK_INT >= 34 &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
            ) == PackageManager.PERMISSION_GRANTED &&
            !hasImagePermission()
    }

    private fun startRealtimeService() {
        val intent = Intent(this, ScreenshotObserverService::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopRealtimeService() {
        stopService(Intent(this, ScreenshotObserverService::class.java))
    }

    private fun startReceiveService() {
        val intent = Intent(this, RelayReceiveService::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopReceiveService() {
        stopService(Intent(this, RelayReceiveService::class.java))
    }
}

@Composable
private fun StudyShotTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = androidx.compose.ui.graphics.Color(0xFF0F7B6C),
            secondary = androidx.compose.ui.graphics.Color(0xFF285F9F),
            background = androidx.compose.ui.graphics.Color(0xFFF6F7F9),
            surface = androidx.compose.ui.graphics.Color.White,
        ),
        content = content,
    )
}

@Composable
private fun MainScreen(
    app: StudyShotApp,
    hasImagePermission: () -> Boolean,
    hasPartialImagePermission: () -> Boolean,
    startRealtimeService: () -> Unit,
    stopRealtimeService: () -> Unit,
    startReceiveService: () -> Unit,
    stopReceiveService: () -> Unit,
) {
    val settings by app.secureSettings.settings.collectAsState()
    val uploads by app.database.dao().observeUploadTasks().collectAsState(initial = emptyList())
    val downloads by app.database.dao().observeDownloadRecords().collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    var selectedTab by remember { mutableIntStateOf(0) }
    var message by remember { mutableStateOf("") }
    var adminToken by remember { mutableStateOf<String?>(null) }
    var adminDevices by remember { mutableStateOf<List<ManagedDevice>>(emptyList()) }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            scope.launch {
                app.uploadRepository.enqueueManualUpload(uri, settings.wifiOnly)
                message = "已加入上传队列"
            }
        }
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        message = if (hasImagePermission()) "图片权限已授权" else "图片权限不足"
    }

    LaunchedEffect(settings.realtimeModeEnabled, settings.autoUploadEnabled) {
        if (settings.autoUploadEnabled && settings.realtimeModeEnabled && hasImagePermission()) {
            startRealtimeService()
        } else {
            stopRealtimeService()
        }
    }

    LaunchedEffect(settings.autoUploadEnabled, settings.realtimeModeEnabled, settings.wifiOnly) {
        if (settings.autoUploadEnabled && !settings.realtimeModeEnabled && hasImagePermission()) {
            app.uploadRepository.schedulePowerSaveScan(settings.wifiOnly)
        } else {
            app.uploadRepository.cancelPowerSaveScan()
        }
    }

    LaunchedEffect(settings.autoReceiveEnabled, settings.deviceTokenAvailable) {
        if (settings.autoReceiveEnabled && settings.deviceTokenAvailable) {
            startReceiveService()
        } else {
            stopReceiveService()
        }
    }

    Scaffold(
        topBar = {
            Column {
                Text(
                    text = "StudyShot Relay",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(16.dp, 14.dp, 16.dp, 4.dp),
                )
                Text(
                    text = if (settings.deviceId.isBlank()) "未绑定" else "${settings.deviceName} · ${settings.deviceId}",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
                TabRow(selectedTabIndex = selectedTab) {
                    listOf("状态", "绑定", "上传", "设置", "管理").forEachIndexed { index, label ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = { Text(label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            color = MaterialTheme.colorScheme.background,
        ) {
            LazyColumn(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (message.isNotBlank()) {
                    item { InfoCard(message) }
                }
                when (selectedTab) {
                    0 -> item {
                        StatusPage(
                            settings = settings,
                            hasImagePermission = hasImagePermission(),
                            hasPartialImagePermission = hasPartialImagePermission(),
                        )
                    }
                    1 -> item {
                        BindPage(
                            settings = settings,
                            onBind = { server, code, name ->
                                scope.launch {
                                    message = bindDevice(app, server, code, name)
                                }
                            },
                        )
                    }
                    2 -> {
                        item {
                            ManualUploadPage(
                                onPick = { pickImage.launch("image/*") },
                                onRequestPermission = {
                                    permissionLauncher.launch(requiredPermissions())
                                },
                                hasImagePermission = hasImagePermission(),
                            )
                        }
                        items(uploads, key = { it.id }) { task ->
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp)) {
                                    Text(task.sourceKind, fontWeight = FontWeight.SemiBold)
                                    Text("状态：${task.status}")
                                    if (!task.sha256.isNullOrBlank()) Text("sha256：${task.sha256}")
                                    if (!task.lastError.isNullOrBlank()) Text("错误：${task.lastError}")
                                }
                            }
                        }
                    }
                    3 -> item {
                        SettingsPage(
                            settings = settings,
                            onSave = { autoUpload, realtime, wifiOnly, scopeValue, autoReceive, downloadNotify, saveGallery ->
                                app.secureSettings.saveUploadSettings(
                                    autoUploadEnabled = autoUpload,
                                    realtimeModeEnabled = realtime,
                                    wifiOnly = wifiOnly,
                                    autoUploadScope = scopeValue,
                                )
                                app.secureSettings.saveReceiveSettings(
                                    autoReceiveEnabled = autoReceive,
                                    downloadNotificationEnabled = downloadNotify,
                                    saveDownloadsToGallery = saveGallery,
                                )
                                message = "设置已保存"
                            },
                        )
                    }
                    4 -> item {
                        ManagementPage(
                            settings = settings,
                            isLoggedIn = adminToken != null,
                            devices = adminDevices,
                            onLogin = { server, login, password ->
                                scope.launch {
                                    try {
                                        val normalized = SecureSettings.normalizeBaseUrl(server.ifBlank { settings.serverBaseUrl })
                                        val response = withContext(Dispatchers.IO) {
                                            app.apiClient.login(normalized, login, password)
                                        }
                                        adminToken = response.accessToken
                                        app.secureSettings.saveServerAndDeviceName(normalized, settings.deviceName)
                                        adminDevices = withContext(Dispatchers.IO) {
                                            app.apiClient.listDevices(normalized, response.accessToken)
                                        }
                                        message = "管理登录成功"
                                    } catch (err: Exception) {
                                        message = err.message ?: "管理登录失败"
                                    }
                                }
                            },
                            onCreateBindCode = { hint ->
                                scope.launch {
                                    val token = adminToken
                                    if (token.isNullOrBlank()) {
                                        message = "请先登录管理"
                                        return@launch
                                    }
                                    try {
                                        val response = withContext(Dispatchers.IO) {
                                            app.apiClient.createBindCode(settings.serverBaseUrl, token, hint)
                                        }
                                        message = "绑定码：${response.bindCode}，有效期至 ${response.expiresAt}"
                                    } catch (err: Exception) {
                                        message = err.message ?: "创建绑定码失败"
                                    }
                                }
                            },
                            onRefresh = {
                                scope.launch {
                                    val token = adminToken
                                    if (token.isNullOrBlank()) return@launch
                                    try {
                                        adminDevices = withContext(Dispatchers.IO) {
                                            app.apiClient.listDevices(settings.serverBaseUrl, token)
                                        }
                                        message = "设备列表已刷新"
                                    } catch (err: Exception) {
                                        message = err.message ?: "刷新失败"
                                    }
                                }
                            },
                            onTogglePermission = { deviceId, key, value ->
                                scope.launch {
                                    val token = adminToken
                                    if (token.isNullOrBlank()) return@launch
                                    try {
                                        withContext(Dispatchers.IO) {
                                            app.apiClient.updateDevicePermission(settings.serverBaseUrl, token, deviceId, key, value)
                                        }
                                        adminDevices = withContext(Dispatchers.IO) {
                                            app.apiClient.listDevices(settings.serverBaseUrl, token)
                                        }
                                    } catch (err: Exception) {
                                        message = err.message ?: "权限更新失败"
                                    }
                                }
                            },
                            onRevoke = { deviceId ->
                                scope.launch {
                                    val token = adminToken
                                    if (token.isNullOrBlank()) return@launch
                                    try {
                                        withContext(Dispatchers.IO) {
                                            app.apiClient.revokeDevice(settings.serverBaseUrl, token, deviceId)
                                        }
                                        adminDevices = withContext(Dispatchers.IO) {
                                            app.apiClient.listDevices(settings.serverBaseUrl, token)
                                        }
                                        message = "设备已撤销"
                                    } catch (err: Exception) {
                                        message = err.message ?: "撤销失败"
                                    }
                                }
                            },
                        )
                    }
                }
                if (selectedTab == 0 && downloads.isNotEmpty()) {
                    items(downloads, key = { it.deliveryId }) { record ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp)) {
                                Text(record.sourceDeviceName ?: record.imageId, fontWeight = FontWeight.SemiBold)
                                Text("接收状态：${record.status}")
                                if (!record.localUri.isNullOrBlank()) Text("位置：${record.localUri}")
                                if (!record.error.isNullOrBlank()) Text("错误：${record.error}")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoCard(message: String) {
    Card(Modifier.fillMaxWidth()) {
        Text(message, Modifier.padding(14.dp))
    }
}

@Composable
private fun StatusPage(
    settings: AppSettings,
    hasImagePermission: Boolean,
    hasPartialImagePermission: Boolean,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("当前状态", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("服务器：${settings.serverBaseUrl.ifBlank { "-" }}")
            Text("设备：${settings.deviceName}")
            Text("绑定：${if (settings.deviceTokenAvailable) "已绑定" else "未绑定"}")
            Text("自动上传：${if (settings.autoUploadEnabled) "开启" else "关闭"}")
            Text("自动接收：${if (settings.autoReceiveEnabled) "开启" else "关闭"}")
            Text("实时学习模式：${if (settings.realtimeModeEnabled) "开启" else "关闭"}")
            Text("图片权限：${if (hasImagePermission) "完整授权" else "未完整授权"}")
            if (hasPartialImagePermission) {
                Text("当前是部分照片访问，自动监听可能漏图。")
            }
        }
    }
}

@Composable
private fun BindPage(
    settings: AppSettings,
    onBind: (String, String, String) -> Unit,
) {
    var server by remember(settings.serverBaseUrl) { mutableStateOf(settings.serverBaseUrl) }
    var code by remember { mutableStateOf("") }
    var name by remember(settings.deviceName) { mutableStateOf(settings.deviceName) }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("设备绑定", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            OutlinedTextField(server, { server = it }, label = { Text("服务器地址") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(code, { code = it }, label = { Text("绑定码") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(name, { name = it }, label = { Text("设备名") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { onBind(server, code, name) }) {
                Text("绑定")
            }
        }
    }
}

@Composable
private fun ManualUploadPage(
    onPick: () -> Unit,
    onRequestPermission: () -> Unit,
    hasImagePermission: Boolean,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("手动上传", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = onPick) {
                    Text("选择图片")
                }
                TextButton(onClick = onRequestPermission) {
                    Text(if (hasImagePermission) "重新检查权限" else "申请图片权限")
                }
            }
        }
    }
}

@Composable
private fun SettingsPage(
    settings: AppSettings,
    onSave: (Boolean, Boolean, Boolean, String, Boolean, Boolean, Boolean) -> Unit,
) {
    var autoUpload by remember(settings.autoUploadEnabled) { mutableStateOf(settings.autoUploadEnabled) }
    var realtime by remember(settings.realtimeModeEnabled) { mutableStateOf(settings.realtimeModeEnabled) }
    var wifiOnly by remember(settings.wifiOnly) { mutableStateOf(settings.wifiOnly) }
    var scopeValue by remember(settings.autoUploadScope) { mutableStateOf(settings.autoUploadScope) }
    var autoReceive by remember(settings.autoReceiveEnabled) { mutableStateOf(settings.autoReceiveEnabled) }
    var downloadNotify by remember(settings.downloadNotificationEnabled) {
        mutableStateOf(settings.downloadNotificationEnabled)
    }
    var saveGallery by remember(settings.saveDownloadsToGallery) {
        mutableStateOf(settings.saveDownloadsToGallery)
    }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("上传设置", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            ToggleRow("自动上传", autoUpload) { autoUpload = it }
            ToggleRow("实时学习模式", realtime) { realtime = it }
            ToggleRow("仅 Wi-Fi 上传", wifiOnly) { wifiOnly = it }
            OutlinedTextField(
                scopeValue,
                { scopeValue = it },
                label = { Text("上传范围") },
                modifier = Modifier.fillMaxWidth(),
            )
            Text("默认范围应保持 screenshot_only；all_images 需要额外确认后再实现。")
            Spacer(Modifier.height(4.dp))
            Text("接收设置", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            ToggleRow("自动接收", autoReceive) { autoReceive = it }
            ToggleRow("下载完成通知", downloadNotify) { downloadNotify = it }
            ToggleRow("保存到系统相册", saveGallery) { saveGallery = it }
            Text("默认只保存到 App 私有目录，避免再次触发自动上传。")
            if (saveGallery) {
                Text("保存到相册会额外写入 Pictures/StudyShot Relay；本地会记录 sha256，自动上传遇到同图会跳过。")
            }
            Button(onClick = { onSave(autoUpload, realtime, wifiOnly, scopeValue, autoReceive, downloadNotify, saveGallery) }) {
                Text("保存")
            }
        }
    }
}

@Composable
private fun ManagementPage(
    settings: AppSettings,
    isLoggedIn: Boolean,
    devices: List<ManagedDevice>,
    onLogin: (String, String, String) -> Unit,
    onCreateBindCode: (String) -> Unit,
    onRefresh: () -> Unit,
    onTogglePermission: (String, String, Boolean) -> Unit,
    onRevoke: (String) -> Unit,
) {
    var server by remember(settings.serverBaseUrl) { mutableStateOf(settings.serverBaseUrl) }
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var bindHint by remember(settings.deviceName) { mutableStateOf(settings.deviceName) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("管理登录", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                OutlinedTextField(server, { server = it }, label = { Text("服务器地址") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(login, { login = it }, label = { Text("登录名") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    password,
                    { password = it },
                    label = { Text("密码") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { onLogin(server, login, password) }) {
                        Text(if (isLoggedIn) "重新登录" else "登录")
                    }
                    TextButton(onClick = onRefresh, enabled = isLoggedIn) {
                        Text("刷新设备")
                    }
                }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("创建绑定码", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                OutlinedTextField(bindHint, { bindHint = it }, label = { Text("设备名提示") }, modifier = Modifier.fillMaxWidth())
                Button(onClick = { onCreateBindCode(bindHint) }, enabled = isLoggedIn) {
                    Text("生成绑定码")
                }
            }
        }

        if (!isLoggedIn) {
            InfoCard("请先登录主用户或有管理权限的账号。")
        } else if (devices.isEmpty()) {
            InfoCard("暂无设备。")
        } else {
            devices.forEach { device ->
                DeviceManagementCard(
                    device = device,
                    onTogglePermission = onTogglePermission,
                    onRevoke = onRevoke,
                )
            }
        }
    }
}

@Composable
private fun DeviceManagementCard(
    device: ManagedDevice,
    onTogglePermission: (String, String, Boolean) -> Unit,
    onRevoke: (String) -> Unit,
) {
    val revoked = !device.revokedAt.isNullOrBlank()
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("${device.name} · ${device.platform}", fontWeight = FontWeight.Bold)
            Text("${device.userDisplayName ?: device.userId} · ${if (revoked) "已撤销" else "有效"}")
            val permissions = listOf(
                "canAutoUpload" to "自动上传",
                "canManualUpload" to "手动上传",
                "canAutoReceive" to "自动接收",
                "canManualDownload" to "手动下载",
                "canManageSpace" to "管理空间",
                "canCreateInvite" to "创建邀请",
            )
            permissions.forEach { (key, label) ->
                ToggleRow(label, permissionValue(device, key)) {
                    if (!revoked) onTogglePermission(device.id, key, it)
                }
            }
            Text("上传范围：${device.permissions.autoUploadScope}")
            Text("接收范围：${device.permissions.autoReceiveScope}")
            TextButton(onClick = { onRevoke(device.id) }, enabled = !revoked) {
                Text("撤销设备")
            }
        }
    }
}

private fun permissionValue(device: ManagedDevice, key: String): Boolean {
    return when (key) {
        "canAutoUpload" -> device.permissions.canAutoUpload
        "canManualUpload" -> device.permissions.canManualUpload
        "canAutoReceive" -> device.permissions.canAutoReceive
        "canManualDownload" -> device.permissions.canManualDownload
        "canManageSpace" -> device.permissions.canManageSpace
        "canCreateInvite" -> device.permissions.canCreateInvite
        else -> false
    }
}

@Composable
private fun ToggleRow(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, modifier = Modifier.padding(top = 12.dp))
        Switch(checked = value, onCheckedChange = onChange)
    }
}

private suspend fun bindDevice(
    app: StudyShotApp,
    server: String,
    code: String,
    name: String,
): String = withContext(Dispatchers.IO) {
    val response = app.apiClient.registerDevice(
        serverBaseUrl = com.studyshot.relay.data.SecureSettings.normalizeBaseUrl(server),
        request = RegisterDeviceRequest(
            bindCode = code,
            deviceName = name.ifBlank { Build.MODEL },
            osVersion = "Android ${Build.VERSION.RELEASE}",
            appVersion = "0.1.0",
        ),
    )
    app.secureSettings.saveBinding(
        serverBaseUrl = server,
        deviceId = response.deviceId,
        deviceToken = response.deviceToken,
        deviceName = name.ifBlank { Build.MODEL },
    )
    "绑定成功"
}

private fun requiredPermissions(): Array<String> {
    return buildList {
        add(
            if (Build.VERSION.SDK_INT >= 33) {
                Manifest.permission.READ_MEDIA_IMAGES
            } else {
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
        )
        if (Build.VERSION.SDK_INT >= 33) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }.toTypedArray()
}
