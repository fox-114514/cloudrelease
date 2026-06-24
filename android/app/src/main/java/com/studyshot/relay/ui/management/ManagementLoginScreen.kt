package com.studyshot.relay.ui.management

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing
import com.studyshot.relay.ui.components.SurfaceCard
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.theme.Teal600

@Composable
fun ManagementLoginScreen(
    state: AppState,
) {
    val settings by state.app.secureSettings.settings.collectAsState()
    val adminSession by state.adminSession.collectAsState()

    var server by rememberSaveable(settings.serverBaseUrl) { mutableStateOf(settings.serverBaseUrl) }
    var login by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var logging by remember { mutableStateOf(false) }
    var allowInsecureHttp by rememberSaveable(settings.allowInsecureHttp) {
        mutableStateOf(settings.allowInsecureHttp)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "登录管理",
            subtitle = "owner 可以看图片库、撤销设备；子用户只能查看自己名下设备。",
        )

        HelpCallout(
            text = "管理 token 仅保存在内存。退出应用或点退出管理后会自动清除。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )

        Spacer(Modifier.height(8.dp))

        SettingsGroup(title = "账号") {
            SettingsRow(
                icon = Icons.Outlined.Storage,
                title = "服务器地址",
                value = server,
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
                icon = Icons.Outlined.Storage,
                title = "允许不安全 HTTP",
                value = if (allowInsecureHttp) "密码和令牌将明文传输" else "已阻止",
                trailing = RowTrailing.SwitchControl(allowInsecureHttp) { allowInsecureHttp = it },
                isLast = false,
            )
            SettingsRow(
                icon = Icons.Outlined.Person,
                title = "登录名 / 邮箱",
                value = login,
                isLast = false,
            )
            OutlinedTextField(
                value = login,
                onValueChange = { login = it },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
            )
            SettingsRow(
                icon = Icons.Outlined.Key,
                title = "密码",
                value = if (showPassword && password.isNotEmpty()) password else if (password.isEmpty()) "未输入" else "••••••",
                onClick = { showPassword = !showPassword },
                isLast = true,
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                singleLine = true,
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }

        if (adminSession != null) {
            Spacer(Modifier.height(12.dp))
            SurfaceCard(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            ) {
                Text(
                    text = "当前已登录：${adminSession?.user?.displayName ?: adminSession?.user?.emailOrLogin ?: adminSession?.user?.id}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    text = "角色：${adminSession?.user?.role}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = {
                logging = true
                state.adminLogin(
                    server = server,
                    login = login,
                    password = password,
                    allowInsecureHttp = allowInsecureHttp,
                    onComplete = { logging = false },
                )
            },
            enabled = !logging && server.isNotBlank() && login.isNotBlank() && password.isNotBlank(),
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
                    logging -> "登录中…"
                    adminSession != null -> "重新登录"
                    else -> "登录"
                },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
