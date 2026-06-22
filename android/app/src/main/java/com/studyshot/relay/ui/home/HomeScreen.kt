package com.studyshot.relay.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.WifiTethering
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.studyshot.relay.data.AppSettings
import com.studyshot.relay.data.DownloadRecordEntity
import com.studyshot.relay.data.UploadTaskEntity
import com.studyshot.relay.ui.components.ConnectionDot
import com.studyshot.relay.ui.components.ConnectionVisualState
import com.studyshot.relay.ui.components.EmptyState
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.MetricTile
import com.studyshot.relay.ui.components.QuickActionCard
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.StatusPill
import com.studyshot.relay.ui.components.StatusTone
import com.studyshot.relay.ui.components.SurfaceCard
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.navigation.Destination
import com.studyshot.relay.ui.theme.SlateMuted
import com.studyshot.relay.ui.theme.Teal600

@Composable
fun HomeScreen(
    state: AppState,
    onNavigate: (String) -> Unit,
    onPickImage: () -> Unit,
    hasImagePermission: Boolean,
    hasPartialImagePermission: Boolean,
    hasDeviceToken: Boolean,
) {
    val settings by state.app.secureSettings.settings.collectAsState()
    val uploadsFlow = remember(state.app.database) { state.app.database.dao().observeUploadTasks(5) }
    val downloadsFlow = remember(state.app.database) { state.app.database.dao().observeDownloadRecords(5) }
    val uploads by uploadsFlow.collectAsState(initial = emptyList())
    val downloads by downloadsFlow.collectAsState(initial = emptyList())
    val adminSession by state.adminSession.collectAsState()

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(top = 8.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        item { HomeHeader(settings = settings) }

        if (!hasDeviceToken) {
            item {
                HelpCallout(
                    text = "还没有绑定设备。先在服务器上创建一个绑定码，然后回到这里完成绑定。",
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    actionLabel = "去绑定",
                    onAction = { onNavigate(Destination.Bind.route) },
                )
            }
        } else if (hasPartialImagePermission) {
            item {
                HelpCallout(
                    text = "你目前只授权了部分照片。自动监听需要完整图片权限，否则部分截图可能漏传。",
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    actionLabel = "授予完整",
                    onAction = onPickImage,
                )
            }
        }

        item { StatusOverviewSection(settings = settings) }

        item { SectionHeader(title = "快速入口") }

        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                QuickActionCard(
                    title = if (hasDeviceToken) "设备与服务器" else "绑定到服务器",
                    description = if (hasDeviceToken) "查看服务器地址、重命名本设备" else "输入绑定码，把这台设备加入你的空间",
                    icon = Icons.Outlined.Key,
                    onClick = { onNavigate(Destination.Bind.route) },
                )
                QuickActionCard(
                    title = "上传设置",
                    description = uploadSummary(settings, hasImagePermission),
                    icon = Icons.Outlined.CloudUpload,
                    onClick = { onNavigate(Destination.UploadSettings.route) },
                )
                QuickActionCard(
                    title = "接收设置",
                    description = receiveSummary(settings),
                    icon = Icons.Outlined.Cloud,
                    onClick = { onNavigate(Destination.ReceiveSettings.route) },
                )
                QuickActionCard(
                    title = "监听图集",
                    description = if (settings.autoUploadScope == "selected_album") {
                        "${settings.selectedAlbumPaths.size} 个目录 · 排除 ${settings.excludedAlbumPaths.size} 个"
                    } else {
                        "默认只监听截图"
                    },
                    icon = Icons.Outlined.Folder,
                    onClick = { onNavigate(Destination.WatchAlbums.route) },
                )
                QuickActionCard(
                    title = if (adminSession != null) "管理：${adminSession?.user?.displayName ?: adminSession?.user?.emailOrLogin ?: ""}" else "登录管理",
                    description = if (adminSession != null) "管理我的设备 / 查看可访问图片" else "成员可管理自己的设备和图片，owner 可管理全空间",
                    icon = Icons.Outlined.Security,
                    onClick = {
                        if (adminSession != null) {
                            onNavigate(Destination.ManagementDevices.route)
                        } else {
                            onNavigate(Destination.ManagementLogin.route)
                        }
                    },
                )
            }
        }

        item { SectionHeader(title = "最近活动") }
        if (uploads.isEmpty() && downloads.isEmpty()) {
            item {
                EmptyState(
                    icon = Icons.Outlined.Bolt,
                    title = "还没有活动",
                    description = "试试手动上传一张图片，或在另一台已绑定设备上截一张图。",
                    modifier = Modifier.height(280.dp),
                )
            }
        } else {
            items(uploads, key = { "u-${it.id}" }) { record ->
                UploadActivityRow(record, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
            items(downloads, key = { "d-${it.deliveryId}" }) { record ->
                DownloadActivityRow(record, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
        }

        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun HomeHeader(settings: AppSettings) {
    val isBound = settings.deviceTokenAvailable
    val effectiveAutoUpload = settings.autoUploadEnabled && settings.serverAllowsAutoUpload()
    val dotState = if (isBound && effectiveAutoUpload) ConnectionVisualState.Connected
    else if (isBound) ConnectionVisualState.Connecting
    else ConnectionVisualState.Disconnected
    val identity = if (settings.boundUserDisplayName.isNotBlank() || settings.boundUserId.isNotBlank()) {
        val who = settings.boundUserDisplayName.ifBlank { settings.boundUserId }
        val role = when (settings.boundUserRole) {
            "owner" -> "空间管理员"
            "child" -> "成员"
            else -> settings.boundUserRole
        }
        "$who · $role"
    } else null
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "StudyShot Relay",
                style = MaterialTheme.typography.displayMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                ConnectionDot(state = dotState)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (isBound && identity != null) "已绑定 · $identity" else if (isBound) "已绑定 · ${settings.deviceName}" else "未绑定",
                    style = MaterialTheme.typography.bodyMedium,
                    color = SlateMuted,
                )
            }
            if (isBound && settings.lastKnownDeviceProfile.isNotBlank()) {
                val profileLabel = when (settings.lastKnownDeviceProfile) {
                    "manual_only" -> "只手动分享"
                    "upload_only" -> "只上传截图"
                    "receive_own" -> "只接收我的图片"
                    "sync_own" -> "我的设备双向同步"
                    "custom" -> "自定义(高级)"
                    else -> settings.lastKnownDeviceProfile
                }
                Text(
                    text = "设备用途:$profileLabel",
                    style = MaterialTheme.typography.bodySmall,
                    color = SlateMuted,
                )
            }
        }
        StatusPill(
            text = if (effectiveAutoUpload) "上传开" else "上传关",
            tone = if (effectiveAutoUpload) StatusTone.Positive else StatusTone.Neutral,
            pulse = effectiveAutoUpload && settings.realtimeModeEnabled,
        )
    }
}

@Composable
private fun StatusOverviewSection(settings: AppSettings) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MetricTile(
                label = "服务器",
                value = settings.serverBaseUrl.ifBlank { "未配置" },
                icon = Icons.Outlined.Storage,
                tone = if (settings.serverBaseUrl.isBlank()) StatusTone.Warning else StatusTone.Neutral,
                modifier = Modifier.weight(1f),
            )
            MetricTile(
                label = "上传",
                value = when {
                    !settings.serverAllowsAutoUpload() -> "服务端禁止"
                    !settings.autoUploadEnabled -> "关闭"
                    settings.realtimeModeEnabled -> "实时"
                    else -> "省电扫描"
                },
                icon = Icons.Outlined.CloudUpload,
                tone = if (settings.autoUploadEnabled && settings.serverAllowsAutoUpload()) StatusTone.Positive else StatusTone.Neutral,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MetricTile(
                label = "接收",
                value = if (!settings.serverAllowsAutoReceive()) "服务端禁止" else if (settings.autoReceiveEnabled) "自动" else "手动",
                icon = Icons.Outlined.WifiTethering,
                tone = if (settings.autoReceiveEnabled && settings.serverAllowsAutoReceive()) StatusTone.Positive else StatusTone.Neutral,
                modifier = Modifier.weight(1f),
            )
            MetricTile(
                label = "范围",
                value = if (settings.autoUploadScope == "selected_album") {
                    "${settings.selectedAlbumPaths.size} 个图集"
                } else {
                    "仅截图"
                },
                icon = Icons.Outlined.Visibility,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun UploadActivityRow(record: UploadTaskEntity, modifier: Modifier = Modifier) {
    val tone = when (record.status) {
        "uploaded", "completed" -> StatusTone.Positive
        "failed" -> StatusTone.Critical
        "uploading" -> StatusTone.Info
        else -> StatusTone.Neutral
    }
    SurfaceCard(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Outlined.CloudUpload,
                contentDescription = null,
                tint = Teal600,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = record.sourceDisplayName ?: record.sourceKind,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = record.lastError?.takeIf { it.isNotBlank() } ?: "状态：${record.status}",
                    style = MaterialTheme.typography.bodySmall,
                    color = SlateMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusPill(text = record.status, tone = tone)
        }
    }
}

@Composable
private fun DownloadActivityRow(record: DownloadRecordEntity, modifier: Modifier = Modifier) {
    val tone = when (record.status) {
        "downloaded", "completed", "saved" -> StatusTone.Positive
        "failed" -> StatusTone.Critical
        else -> StatusTone.Neutral
    }
    SurfaceCard(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Outlined.Cloud,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = record.sourceDeviceName ?: record.imageId,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = record.error?.takeIf { it.isNotBlank() } ?: record.localUri ?: "状态：${record.status}",
                    style = MaterialTheme.typography.bodySmall,
                    color = SlateMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusPill(text = record.status, tone = tone)
        }
    }
}

private fun uploadSummary(settings: AppSettings, hasImagePermission: Boolean): String {
    return when {
        !hasImagePermission -> "需要授予图片权限"
        !settings.serverAllowsAutoUpload() -> "服务端未允许自动上传"
        !settings.autoUploadEnabled -> "关闭 · 改为开启"
        settings.realtimeModeEnabled -> "实时监听中 · ${if (settings.wifiOnly) "仅 Wi-Fi" else "蜂窝数据也上传"}"
        else -> "省电扫描中 · ${settings.autoUploadScopeDisplay()}"
    }
}

private fun receiveSummary(settings: AppSettings): String {
    return when {
        !settings.deviceTokenAvailable -> "绑定后才能接收"
        !settings.serverAllowsAutoReceive() -> "服务端未允许自动接收"
        !settings.autoReceiveEnabled -> "关闭 · 改为开启"
        settings.saveDownloadsToGallery -> "下载到系统相册"
        settings.downloadNotificationEnabled -> "下载后通知"
        else -> "静默接收"
    }
}

private fun AppSettings.autoUploadScopeDisplay(): String {
    return if (autoUploadScope == "selected_album") "${selectedAlbumPaths.size} 个图集" else "仅截图"
}
