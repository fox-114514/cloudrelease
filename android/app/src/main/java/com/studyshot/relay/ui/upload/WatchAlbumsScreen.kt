package com.studyshot.relay.ui.upload

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddCircle
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.EmptyState
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.theme.Teal600

@Composable
fun WatchAlbumsScreen(
    state: AppState,
    onAddAlbum: () -> Unit,
    hasImagePermission: Boolean,
) {
    val settings by state.app.secureSettings.settings.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "监听图集",
            subtitle = "只有选中的图集里的新图片会被监听到。",
        )

        if (!hasImagePermission) {
            HelpCallout(
                text = "需要先授予完整图片权限。",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        } else {
            HelpCallout(
                text = "添加图集后，路径会写入安全存储，App 重启仍然生效。",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "图集列表",
            footer = if (settings.selectedAlbumPaths.isNotEmpty()) {
                "移除图集不会删除服务器上已经上传的图片。"
            } else null,
        ) {
            if (settings.selectedAlbumPaths.isEmpty()) {
                SettingsRow(
                    icon = Icons.Outlined.FolderOff,
                    title = "还没有图集",
                    subtitle = "添加一个本地图片目录",
                    value = "添加",
                    onClick = onAddAlbum,
                    isLast = true,
                    enabled = hasImagePermission,
                )
            } else {
                settings.selectedAlbumPaths.forEachIndexed { index, path ->
                    SettingsRow(
                        icon = Icons.Outlined.Folder,
                        title = path,
                        subtitle = "点击右侧移除",
                        value = "移除",
                        onClick = { state.removeAlbumPath(path) },
                        isLast = index == settings.selectedAlbumPaths.lastIndex,
                    )
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        Button(
            onClick = onAddAlbum,
            enabled = hasImagePermission,
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Teal600,
                contentColor = androidx.compose.ui.graphics.Color.White,
            ),
        ) {
            Text(
                text = "添加图集",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
