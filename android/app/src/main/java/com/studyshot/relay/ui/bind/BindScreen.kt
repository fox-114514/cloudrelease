package com.studyshot.relay.ui.bind

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "设备绑定",
            subtitle = "把本设备和你的服务器配对。绑定码在网页管理后台或主用户 App 里生成。",
        )

        HelpCallout(
            text = "未绑定时，本应用不会上传任何图片，也不会接收任何图片。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )

        Spacer(Modifier.height(12.dp))

        SettingsGroup(
            footer = "支持 http:// 用于局域网测试，公开部署请使用 https://。",
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
                onValueChange = { server = it },
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
                onClick = { showCode = !showCode },
                isLast = false,
            )
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.uppercase() },
                singleLine = true,
                visualTransformation = if (showCode) VisualTransformation.None else PasswordVisualTransformation(),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("例如 6D2F-9KQT") },
            )
            SettingsRow(
                icon = Icons.Outlined.Bolt,
                title = "设备名",
                subtitle = "在网页管理后台显示的名字",
                value = name,
                isLast = true,
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("如：我的平板") },
            )
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = {
                binding = true
                state.bindDevice(
                    server = server,
                    code = code,
                    name = name,
                    onComplete = { binding = false },
                )
            },
            enabled = !binding && server.isNotBlank() && code.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Teal600,
                contentColor = androidx.compose.ui.graphics.Color.White,
            ),
        ) {
            Text(
                text = when {
                    binding -> "绑定中…"
                    settings.deviceTokenAvailable -> "重新绑定"
                    else -> "绑定"
                },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        if (settings.deviceTokenAvailable) {
            Spacer(Modifier.height(12.dp))
            HelpCallout(
                text = "当前已绑定到 ${settings.deviceName}（${settings.deviceId}）。重新绑定会替换本设备的 token，旧 token 立即失效。",
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
    }
}
