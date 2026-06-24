package com.studyshot.relay.ui.help

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing

@Composable
fun HelpPermissionsScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "权限说明",
            subtitle = "本 App 申请的权限、为什么。",
        )

        HelpCallout(
            text = "本 App 不申请任何「访问所有文件」/ MANAGE_EXTERNAL_STORAGE 类的高风险权限。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "图片访问",
            footer = "READ_MEDIA_IMAGES 是 Android 13 之后的标准权限。Android 12 及以下用 READ_EXTERNAL_STORAGE；Android 8/9 写入公共 Downloads 还需要 WRITE_EXTERNAL_STORAGE。",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Photo,
                title = "READ_MEDIA_IMAGES",
                subtitle = "读取设备上的图片。自动监听需要完整授权。",
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "网络与同步",
            footer = "Foreground Service 是「实时学习模式」和「自动接收」必需的。",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Wifi,
                title = "INTERNET",
                subtitle = "上传 / 下载 / WebSocket",
                isLast = false,
            )
            SettingsRow(
                icon = Icons.Outlined.Wifi,
                title = "ACCESS_NETWORK_STATE",
                subtitle = "用于「仅 Wi-Fi 上传」判断",
                isLast = false,
            )
            SettingsRow(
                icon = Icons.Outlined.Bolt,
                title = "FOREGROUND_SERVICE",
                subtitle = "允许在前台运行 Service",
                isLast = false,
            )
            SettingsRow(
                icon = Icons.Outlined.Bolt,
                title = "FOREGROUND_SERVICE_DATA_SYNC",
                subtitle = "声明 Service 类型为「数据同步」",
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(title = "通知") {
            SettingsRow(
                icon = Icons.Outlined.Notifications,
                title = "POST_NOTIFICATIONS",
                subtitle = "Android 13+ 需要。下载完成通知、前台 Service 通知都用它。",
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "应用更新",
            footer = "只用于安装当前 StudyShot 服务器提供、且 SHA-256 校验通过的 APK；最终安装仍由 Android 系统确认。",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Storage,
                title = "REQUEST_INSTALL_PACKAGES",
                subtitle = "允许从本 App 打开系统 APK 安装器",
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "用户选择的部分照片（Android 14+）",
            footer = "如果你选了「允许访问部分照片」，自动监听可能漏图。",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Photo,
                title = "READ_MEDIA_VISUAL_USER_SELECTED",
                subtitle = "系统把已选照片单独授权给我们。",
                isLast = true,
            )
        }
    }
}
