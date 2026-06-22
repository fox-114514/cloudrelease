package com.studyshot.relay.ui.receive

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Photo
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

@Composable
fun ReceiveSettingsScreen(
    state: AppState,
) {
    val settings by state.app.secureSettings.settings.collectAsState()
    val bound = settings.deviceTokenAvailable

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "接收",
            subtitle = "控制如何处理从其他设备发来的图片。",
        )

        if (!bound) {
            HelpCallout(
                text = "未绑定时，App 不会接收任何图片。",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        } else if (!settings.serverAllowsAutoReceive()) {
            HelpCallout(
                text = "服务端当前未允许本设备自动接收；本地开关不会建立连接。",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(title = "接收") {
            SettingsRow(
                icon = Icons.Outlined.Cloud,
                title = "自动接收",
                subtitle = "开启后保持 WebSocket 连接，新图片自动下载",
                trailing = RowTrailing.SwitchControl(
                    checked = settings.autoReceiveEnabled,
                    onCheckedChange = { state.saveReceiveSettings(autoReceiveEnabled = it) },
                ),
                isLast = false,
                enabled = bound && settings.serverAllowsAutoReceive(),
            )
            SettingsRow(
                icon = Icons.Outlined.Notifications,
                title = "下载完成通知",
                subtitle = "下载成功后发一条系统通知",
                trailing = RowTrailing.SwitchControl(
                    checked = settings.downloadNotificationEnabled,
                    onCheckedChange = {
                        state.saveReceiveSettings(downloadNotificationEnabled = it)
                    },
                ),
                isLast = false,
                enabled = bound,
            )
            SettingsRow(
                icon = Icons.Outlined.Photo,
                title = "保存到系统相册",
                subtitle = "额外写入 Pictures/StudyShot Relay；本机 sha256 已去重",
                trailing = RowTrailing.SwitchControl(
                    checked = settings.saveDownloadsToGallery,
                    onCheckedChange = {
                        state.saveReceiveSettings(saveDownloadsToGallery = it)
                    },
                ),
                isLast = true,
                enabled = bound,
            )
        }

        Spacer(Modifier.height(8.dp))

        HelpCallout(
            text = "本机不会接收自己上传的图片；下载目录的图片也不会被再次监听上传，避免循环。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
    }
}
