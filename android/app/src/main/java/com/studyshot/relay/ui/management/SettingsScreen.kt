package com.studyshot.relay.ui.management

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.navigation.Destination
import com.studyshot.relay.ui.theme.SlateMuted

@Composable
fun SettingsScreen(
    state: AppState,
    onNavigate: (String) -> Unit,
) {
    val settings by state.app.secureSettings.settings.collectAsState()
    val adminSession by state.adminSession.collectAsState()
    val server = settings.serverBaseUrl.ifBlank { "未配置" }
    val device = settings.deviceName.ifBlank { "未命名" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "设置",
            subtitle = "按需调整各模块。修改立即生效。",
        )

        SettingsGroup(title = "设备") {
            SettingsRow(
                icon = Icons.Outlined.Storage,
                title = "服务器与设备",
                subtitle = "$server · $device",
                onClick = { onNavigate(Destination.Bind.route) },
                isLast = false,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(title = "上传") {
            SettingsRow(
                icon = Icons.Outlined.CloudUpload,
                title = "上传设置",
                subtitle = uploadSummary(settings),
                onClick = { onNavigate(Destination.UploadSettings.route) },
                isLast = false,
            )
            SettingsRow(
                icon = Icons.Outlined.Folder,
                title = "监听图集",
                subtitle = if (settings.autoUploadScope == "selected_album") {
                    "${settings.selectedAlbumPaths.size} 个目录 · 排除 ${settings.excludedAlbumPaths.size} 个"
                } else {
                    "默认只监听截图"
                },
                onClick = { onNavigate(Destination.WatchAlbums.route) },
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(title = "接收") {
            SettingsRow(
                icon = Icons.Outlined.Cloud,
                title = "接收设置",
                subtitle = receiveSummary(settings),
                onClick = { onNavigate(Destination.ReceiveSettings.route) },
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "管理",
            footer = if (adminSession != null) {
                "已登录：${adminSession?.user?.displayName ?: adminSession?.user?.emailOrLogin ?: adminSession?.user?.id}（${adminSession?.user?.role}）"
            } else {
                "管理 token 仅保存在内存。退出 App 自动失效。"
            },
        ) {
            SettingsRow(
                icon = Icons.Outlined.Person,
                title = if (adminSession != null) "重新登录管理" else "登录管理",
                subtitle = if (adminSession != null) "切换账号或重新获取 token" else "owner 可看图库、撤销设备",
                onClick = { onNavigate(Destination.ManagementLogin.route) },
                isLast = adminSession == null,
            )
            if (adminSession != null) {
                SettingsRow(
                    icon = Icons.Outlined.Devices,
                    title = "设备管理",
                    subtitle = "权限 / 撤销 / 邀请",
                    onClick = { onNavigate(Destination.ManagementDevices.route) },
                    isLast = true,
                )
            }
        }
    }
}

private fun uploadSummary(settings: com.studyshot.relay.data.AppSettings): String {
    return when {
        !settings.serverAllowsAutoUpload() -> "服务端未允许"
        !settings.autoUploadEnabled -> "关闭"
        settings.realtimeModeEnabled -> "实时监听 · ${if (settings.wifiOnly) "仅 Wi-Fi" else "蜂窝数据也上传"}"
        else -> "省电扫描 · ${if (settings.autoUploadScope == "selected_album") "${settings.selectedAlbumPaths.size} 个图集" else "仅截图"}"
    }
}

private fun receiveSummary(settings: com.studyshot.relay.data.AppSettings): String {
    return when {
        !settings.deviceTokenAvailable -> "未绑定"
        !settings.serverAllowsAutoReceive() -> "服务端未允许"
        !settings.autoReceiveEnabled -> "关闭"
        settings.saveDownloadsToGallery -> "下载到相册"
        settings.downloadNotificationEnabled -> "下载后通知"
        else -> "静默接收"
    }
}
