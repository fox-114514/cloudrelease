package com.studyshot.relay.ui.upload

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing
import com.studyshot.relay.ui.components.SurfaceCard
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.navigation.Destination
import com.studyshot.relay.ui.theme.Hairline
import com.studyshot.relay.ui.theme.SlateMuted
import com.studyshot.relay.ui.theme.Teal600

@Composable
fun UploadSettingsScreen(
    state: AppState,
    onNavigate: (String) -> Unit,
    onRequestPermission: () -> Unit,
    hasImagePermission: Boolean,
    hasPartialImagePermission: Boolean,
) {
    val settings by state.app.secureSettings.settings.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "上传",
            subtitle = "控制何时、如何把截图发到你的服务器。",
        )

        if (!hasImagePermission) {
            HelpCallout(
                text = "自动监听需要完整的图片访问权限。",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                actionLabel = "申请",
                onAction = onRequestPermission,
            )
        } else if (hasPartialImagePermission) {
            HelpCallout(
                text = "你只授权了部分照片，监听可能漏图。建议改为完整授权。",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                actionLabel = "改完整",
                onAction = onRequestPermission,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(title = "自动上传") {
            SettingsRow(
                icon = Icons.Outlined.CloudUpload,
                title = "自动上传",
                subtitle = "开启后，监听到新截图会自动加入上传队列",
                trailing = RowTrailing.SwitchControl(
                    checked = settings.autoUploadEnabled,
                    onCheckedChange = { state.saveUploadSettings(autoUploadEnabled = it) },
                ),
                isLast = false,
                enabled = hasImagePermission,
            )
            SettingsRow(
                icon = Icons.Outlined.Bolt,
                title = "实时学习模式",
                subtitle = "保持前台监听，几乎实时；常驻通知 + 耗电略高",
                trailing = RowTrailing.SwitchControl(
                    checked = settings.realtimeModeEnabled,
                    onCheckedChange = { state.saveUploadSettings(realtimeModeEnabled = it) },
                ),
                isLast = false,
                enabled = settings.autoUploadEnabled,
            )
            SettingsRow(
                icon = Icons.Outlined.Schedule,
                title = "省电扫描模式",
                subtitle = "若关闭实时模式，则定时扫描新截图；耗电极低，可能漏极短间隔的截图",
                trailing = RowTrailing.SwitchControl(
                    checked = !settings.realtimeModeEnabled,
                    onCheckedChange = { realtime ->
                        state.saveUploadSettings(realtimeModeEnabled = !realtime)
                    },
                ),
                isLast = false,
                enabled = settings.autoUploadEnabled,
            )
            SettingsRow(
                icon = Icons.Outlined.Wifi,
                title = "仅 Wi-Fi 上传",
                subtitle = "在蜂窝数据下暂停上传，Wi-Fi 恢复后继续",
                trailing = RowTrailing.SwitchControl(
                    checked = settings.wifiOnly,
                    onCheckedChange = { state.saveUploadSettings(wifiOnly = it) },
                ),
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "监听范围",
            footer = "截图模式 = 仅 MediaStore 中标记为截图的新图片；图集模式 = 你指定的多个图集。",
        ) {
            ScopeOptionRow(
                title = "仅截图",
                description = "推荐。覆盖大多数学习场景。",
                icon = Icons.Outlined.Bolt,
                selected = settings.autoUploadScope == "screenshot_only",
                onSelect = {
                    state.saveUploadSettings(
                        autoUploadScope = "screenshot_only",
                        selectedAlbumPaths = emptyList(),
                        excludedAlbumPaths = emptyList(),
                    )
                },
                isLast = false,
            )
            ScopeOptionRow(
                title = "多个图集",
                description = if (settings.selectedAlbumPaths.isEmpty()) {
                    "未选择图集"
                } else {
                    "${settings.selectedAlbumPaths.size} 个图集"
                },
                icon = Icons.Outlined.Folder,
                selected = settings.autoUploadScope == "selected_album",
                onSelect = { onNavigate(Destination.WatchAlbums.route) },
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        HelpCallout(
            text = "实时学习模式会产生常驻通知。如果你看到通知「正在监听学习截图」，说明它正在工作。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun ScopeOptionRow(
    title: String,
    description: String,
    icon: ImageVector,
    selected: Boolean,
    onSelect: () -> Unit,
    isLast: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
            .padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = Teal600,
                modifier = Modifier.size(16.dp),
            )
        }
        Spacer(Modifier.size(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = SlateMuted,
            )
        }
        Spacer(Modifier.size(8.dp))
        Box(
            modifier = Modifier
                .size(20.dp)
                .background(
                    color = if (selected) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.surfaceContainerHigh,
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(MaterialTheme.colorScheme.surface, CircleShape),
                )
            }
        }
    }
    if (!isLast) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 56.dp)
                .height(1.dp)
                .background(Hairline),
        )
    }
}
