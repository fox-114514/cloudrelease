package com.studyshot.relay.ui.bind

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.studyshot.relay.data.SecureSettings
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.theme.SlateMuted
import com.studyshot.relay.ui.theme.Teal600

private val DEVICE_PROFILES = listOf(
    "manual_only" to "只手动分享",
    "upload_only" to "只上传截图",
    "receive_own" to "只接收我的图片",
    "sync_own" to "我的设备双向同步",
)

private fun roleLabel(role: String): String = when (role) {
    "owner" -> "空间管理员"
    "child" -> "成员"
    else -> role
}

private fun profileLabel(profile: String): String = DEVICE_PROFILES.firstOrNull { it.first == profile }?.second
    ?: when (profile) {
        "custom" -> "自定义(高级)"
        else -> profile
    }

@Composable
fun BindScreen(
    state: AppState,
) {
    val settings by state.app.secureSettings.settings.collectAsState()
    var server by rememberSaveable(settings.serverBaseUrl) { mutableStateOf(settings.serverBaseUrl) }
    var code by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable(settings.deviceName) { mutableStateOf(settings.deviceName) }
    var showCode by rememberSaveable { mutableStateOf(false) }
    var binding by remember { mutableStateOf(false) }
    var mode by rememberSaveable { mutableStateOf<BindMode>(BindMode.Code) }
    var loginName by rememberSaveable { mutableStateOf("") }
    var loginPassword by rememberSaveable { mutableStateOf("") }
    var profile by rememberSaveable { mutableStateOf("sync_own") }
    var preview by remember { mutableStateOf<com.studyshot.relay.network.BindCodePreview?>(null) }
    var previewLoading by remember { mutableStateOf(false) }
    var previewError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        // Always refresh self identity on first render so that home screen and
        // bind screen stay consistent with server-side permissions.
        if (settings.deviceTokenAvailable) {
            state.refreshSelfIdentity()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "设备绑定",
            subtitle = "把本设备和你的服务器配对。",
        )

        if (settings.boundUserId.isNotBlank()) {
            IdentityBanner(settings = settings)
        }

        HelpCallout(
            text = "未绑定时,本应用不会上传任何图片,也不会接收任何图片。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )

        Spacer(Modifier.height(12.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = mode == BindMode.Code,
                onClick = { mode = BindMode.Code; preview = null; previewError = null },
                label = { Text("使用绑定码") },
            )
            FilterChip(
                selected = mode == BindMode.Account,
                onClick = { mode = BindMode.Account; preview = null; previewError = null },
                label = { Text("使用账号绑定") },
            )
        }

        Spacer(Modifier.height(12.dp))

        if (mode == BindMode.Account) {
            AccountBindSection(
                state = state,
                server = server,
                onServerChange = { server = it },
                loginName = loginName,
                onLoginNameChange = { loginName = it },
                loginPassword = loginPassword,
                onLoginPasswordChange = { loginPassword = it },
                deviceName = name,
                onDeviceNameChange = { name = it },
                profile = profile,
                onProfileChange = { profile = it },
                binding = binding,
                onBind = {
                    binding = true
                    state.bindWithLogin(
                        server = server,
                        login = loginName,
                        password = loginPassword,
                        deviceName = name,
                        profile = profile,
                        onComplete = { binding = false },
                    )
                },
            )
        } else {
            CodeBindSection(
                state = state,
                server = server,
                onServerChange = { server = it },
                code = code,
                onCodeChange = { code = it; preview = null; previewError = null },
                name = name,
                onNameChange = { name = it },
                showCode = showCode,
                onToggleShowCode = { showCode = !showCode },
                profile = profile,
                onProfileChange = { profile = it },
                binding = binding,
                preview = preview,
                previewLoading = previewLoading,
                previewError = previewError,
                onPreview = {
                    previewLoading = true
                    previewError = null
                    state.previewBindCode(
                        server = server,
                        bindCode = code,
                        onResult = { result ->
                            previewLoading = false
                            result.onSuccess { preview = it }
                                .onFailure { previewError = it.message ?: it.javaClass.simpleName }
                        },
                    )
                },
                onBind = {
                    binding = true
                    state.bindDevice(
                        server = server,
                        code = code,
                        name = name,
                        profile = profile,
                        onComplete = { binding = false },
                    )
                },
            )
        }
    }
}

private enum class BindMode { Code, Account }

@Composable
private fun IdentityBanner(settings: com.studyshot.relay.data.AppSettings) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = "当前身份:${settings.boundUserDisplayName.ifBlank { settings.boundUserId }} · ${roleLabel(settings.boundUserRole)}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (settings.lastKnownDeviceProfile.isNotBlank()) {
                Text(
                    text = "设备用途:${profileLabel(settings.lastKnownDeviceProfile)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = SlateMuted,
                )
            }
        }
    }
}

@Composable
private fun CodeBindSection(
    state: AppState,
    server: String,
    onServerChange: (String) -> Unit,
    code: String,
    onCodeChange: (String) -> Unit,
    name: String,
    onNameChange: (String) -> Unit,
    showCode: Boolean,
    onToggleShowCode: () -> Unit,
    profile: String,
    onProfileChange: (String) -> Unit,
    binding: Boolean,
    preview: com.studyshot.relay.network.BindCodePreview?,
    previewLoading: Boolean,
    previewError: String?,
    onPreview: () -> Unit,
    onBind: () -> Unit,
) {
    Column {
        SettingsGroup(
            footer = "支持 http:// 用于局域网测试,公开部署请使用 https://。",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Storage,
                title = "服务器地址",
                value = server,
                onClick = { },
                isLast = false,
            )
            OutlinedTextField(
                value = server,
                onValueChange = onServerChange,
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("https://studyshot.example.com") },
            )
            SettingsRow(
                icon = Icons.Outlined.Key,
                title = "绑定码",
                value = if (showCode && code.isNotBlank()) code else if (code.isBlank()) "未输入" else "••••••",
                onClick = onToggleShowCode,
                isLast = false,
            )
            OutlinedTextField(
                value = code,
                onValueChange = onCodeChange,
                singleLine = true,
                visualTransformation = if (showCode) VisualTransformation.None else PasswordVisualTransformation(),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("粘贴生成的绑定码(区分大小写)") },
            )
        }
        Spacer(Modifier.height(12.dp))
        TextButton(
            onClick = onPreview,
            enabled = !previewLoading && code.isNotBlank() && server.isNotBlank(),
            modifier = Modifier.padding(horizontal = 16.dp),
        ) {
            Text(if (previewLoading) "校验中…" else "下一步:查看目标成员")
        }
        previewError?.let { err ->
            Text(
                text = err,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        preview?.let { p ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text("将加入:${p.space.displayName}", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = "设备属于:${p.targetUser.displayName ?: p.targetUser.id} (${roleLabel(p.targetUser.role)})",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
        ProfilePicker(selected = profile, onSelect = onProfileChange, modifier = Modifier.padding(top = 8.dp))
        SettingsGroup(
            title = "设备名",
            footer = "在网页管理后台显示的名字",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Bolt,
                title = "设备名",
                value = name,
                isLast = true,
            )
            OutlinedTextField(
                value = name,
                onValueChange = onNameChange,
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("如:我的平板") },
            )
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onBind,
            enabled = !binding && server.isNotBlank() && code.isNotBlank() && preview != null,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Teal600, contentColor = androidx.compose.ui.graphics.Color.White),
        ) {
            Text(
                text = when {
                    binding -> "绑定中…"
                    else -> "确认绑定"
                },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun AccountBindSection(
    state: AppState,
    server: String,
    onServerChange: (String) -> Unit,
    loginName: String,
    onLoginNameChange: (String) -> Unit,
    loginPassword: String,
    onLoginPasswordChange: (String) -> Unit,
    deviceName: String,
    onDeviceNameChange: (String) -> Unit,
    profile: String,
    onProfileChange: (String) -> Unit,
    binding: Boolean,
    onBind: () -> Unit,
) {
    Column {
        HelpCallout(
            text = "使用成员账号和密码直接绑定。设备将归属当前登录的成员,JWT 仅在绑定瞬间使用,完成后立即丢弃。",
            modifier = Modifier.padding(horizontal = 0.dp, vertical = 0.dp),
        )
        SettingsGroup {
            SettingsRow(
                icon = Icons.Outlined.Storage,
                title = "服务器地址",
                value = server,
                onClick = { },
                isLast = false,
            )
            OutlinedTextField(
                value = server,
                onValueChange = onServerChange,
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("https://studyshot.example.com") },
            )
            SettingsRow(
                icon = Icons.Outlined.AccountCircle,
                title = "成员账号",
                value = loginName,
                isLast = false,
            )
            OutlinedTextField(
                value = loginName,
                onValueChange = onLoginNameChange,
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("如:zhangsan") },
            )
            SettingsRow(
                icon = Icons.Outlined.Key,
                title = "密码",
                value = if (loginPassword.isBlank()) "未输入" else "••••••",
                isLast = true,
            )
            OutlinedTextField(
                value = loginPassword,
                onValueChange = onLoginPasswordChange,
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("成员登录密码") },
            )
        }
        ProfilePicker(selected = profile, onSelect = onProfileChange, modifier = Modifier.padding(top = 8.dp))
        SettingsGroup(
            title = "设备名",
            footer = "在网页管理后台显示的名字",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Bolt,
                title = "设备名",
                value = deviceName,
                isLast = true,
            )
            OutlinedTextField(
                value = deviceName,
                onValueChange = onDeviceNameChange,
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("如:客厅 iPad") },
            )
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onBind,
            enabled = !binding && server.isNotBlank() && loginName.isNotBlank() && loginPassword.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Teal600, contentColor = androidx.compose.ui.graphics.Color.White),
        ) {
            Text(
                text = if (binding) "绑定中…" else "登录并绑定",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun ProfilePicker(
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.padding(horizontal = 16.dp)) {
        Text(
            text = "设备用途",
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(vertical = 4.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            DEVICE_PROFILES.forEach { (id, label) ->
                FilterChip(
                    selected = selected == id,
                    onClick = { onSelect(id) },
                    label = { Text(label) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}