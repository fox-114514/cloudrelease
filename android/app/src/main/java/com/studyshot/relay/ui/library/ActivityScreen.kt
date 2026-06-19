package com.studyshot.relay.ui.library

import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.studyshot.relay.data.DownloadRecordEntity
import com.studyshot.relay.data.UploadTaskEntity
import com.studyshot.relay.network.LibraryImage
import com.studyshot.relay.ui.components.EmptyState
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SurfaceCard
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.theme.Hairline
import com.studyshot.relay.ui.theme.MonoCaptionStyle
import com.studyshot.relay.ui.theme.SlateMuted
import com.studyshot.relay.ui.theme.Teal600
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class ActivityTab(val label: String) {
    Uploads("上传日志"),
    Downloads("下载日志"),
    Library("图片库"),
}

private val ActivityTabSaver = androidx.compose.runtime.saveable.Saver<ActivityTab, String>(
    save = { it.name },
    restore = { runCatching { ActivityTab.valueOf(it) }.getOrDefault(ActivityTab.Uploads) },
)

@Composable
fun ActivityScreen(
    state: AppState,
    onPickImage: () -> Unit,
) {
    val uploads by state.app.database.dao().observeUploadTasks(50).collectAsState(initial = emptyList())
    val downloads by state.app.database.dao().observeDownloadRecords(50).collectAsState(initial = emptyList())
    val adminSession by state.adminSession.collectAsState()
    val images by state.libraryImages.collectAsState()
    val imageLoading by state.imageLoading.collectAsState()
    val imageFilter by state.imageFilter.collectAsState()
    val imageCursor by state.imageCursor.collectAsState()

    var tab by rememberSaveable(stateSaver = ActivityTabSaver) {
        mutableStateOf(ActivityTab.Uploads)
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ActivityHeader(
            uploadsCount = uploads.size,
            downloadsCount = downloads.size,
            libraryCount = images.size,
            isOwner = adminSession?.user?.role == "owner",
            onPickImage = onPickImage,
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ActivityTab.values().forEach { entry ->
                val isActive = entry == tab
                val enabled = entry != ActivityTab.Library || adminSession?.user?.role == "owner"
                FilterChip(
                    selected = isActive,
                    onClick = { if (enabled) tab = entry },
                    enabled = enabled,
                    label = {
                        Text(
                            entry.label,
                            style = MaterialTheme.typography.labelLarge,
                        )
                    },
                    shape = RoundedCornerShape(999.dp),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    ),
                )
            }
        }

        when (tab) {
            ActivityTab.Uploads -> UploadsLog(uploads)
            ActivityTab.Downloads -> DownloadsLog(downloads)
            ActivityTab.Library -> {
                if (adminSession?.user?.role != "owner") {
                    EmptyState(
                        icon = Icons.Outlined.Photo,
                        title = "需要 owner 账号",
                        description = "图片库只对 owner 可见。请先在「设置 → 管理」中登录 owner 账号。",
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    ImageLibraryGrid(
                        state = state,
                        images = images,
                        imageFilter = imageFilter,
                        loading = imageLoading,
                        hasMore = imageCursor != null,
                    )
                }
            }
        }
    }
}

@Composable
private fun ActivityHeader(
    uploadsCount: Int,
    downloadsCount: Int,
    libraryCount: Int,
    isOwner: Boolean,
    onPickImage: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "记录",
                style = MaterialTheme.typography.displayMedium,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = "上传 $uploadsCount · 下载 $downloadsCount · ${if (isOwner) "图库 $libraryCount" else "图库仅 owner"}",
                style = MaterialTheme.typography.bodyMedium,
                color = SlateMuted,
            )
        }
        Button(
            onClick = onPickImage,
            colors = ButtonDefaults.buttonColors(
                containerColor = Teal600,
                contentColor = Color.White,
            ),
        ) {
            Icon(
                imageVector = Icons.Outlined.Add,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text("上传图片", style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun UploadsLog(uploads: List<UploadTaskEntity>) {
    if (uploads.isEmpty()) {
        EmptyState(
            icon = Icons.Outlined.Bolt,
            title = "还没有上传记录",
            description = "截一张图，或者从其它 App 分享图片到 StudyShot。",
            modifier = Modifier.fillMaxSize(),
        )
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(uploads, key = { it.id }) { task ->
            UploadLogCard(task)
        }
    }
}

@Composable
private fun UploadLogCard(task: UploadTaskEntity) {
    val tone = when (task.status) {
        "uploaded", "completed" -> Icons.Outlined.CheckCircle to Teal600
        "failed" -> Icons.Outlined.WarningAmber to MaterialTheme.colorScheme.error
        "uploading" -> Icons.Outlined.CloudUpload to MaterialTheme.colorScheme.secondary
        else -> Icons.Outlined.Bolt to SlateMuted
    }
    SurfaceCard(contentPadding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = tone.first,
                contentDescription = null,
                tint = tone.second,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = task.sourceDisplayName ?: task.sourceKind,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = task.lastError?.takeIf { it.isNotBlank() } ?: "状态：${task.status}",
                    style = MaterialTheme.typography.bodySmall,
                    color = SlateMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!task.sha256.isNullOrBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = "sha256 ${task.sha256.take(12)}…",
                        style = MonoCaptionStyle,
                        color = SlateMuted,
                    )
                }
            }
            Text(
                text = task.status,
                style = MaterialTheme.typography.labelSmall,
                color = tone.second,
            )
        }
    }
}

@Composable
private fun DownloadsLog(records: List<DownloadRecordEntity>) {
    if (records.isEmpty()) {
        EmptyState(
            icon = Icons.Outlined.Cloud,
            title = "还没有下载记录",
            description = "其他设备上传新图片后，会自动出现在这里。",
            modifier = Modifier.fillMaxSize(),
        )
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(records, key = { it.deliveryId }) { record ->
            DownloadLogCard(record)
        }
    }
}

@Composable
private fun DownloadLogCard(record: DownloadRecordEntity) {
    val tone = when (record.status) {
        "downloaded", "completed", "saved" -> Icons.Outlined.CheckCircle to Teal600
        "failed" -> Icons.Outlined.WarningAmber to MaterialTheme.colorScheme.error
        else -> Icons.Outlined.Cloud to SlateMuted
    }
    SurfaceCard(contentPadding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = tone.first,
                contentDescription = null,
                tint = tone.second,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = record.sourceDeviceName ?: record.imageId,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = record.error?.takeIf { it.isNotBlank() } ?: record.localUri ?: "状态：${record.status}",
                    style = MaterialTheme.typography.bodySmall,
                    color = SlateMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = record.status,
                style = MaterialTheme.typography.labelSmall,
                color = tone.second,
            )
        }
    }
}

private data class PreviewState(
    val image: LibraryImage? = null,
    val bytes: ByteArray? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

@Composable
private fun ImageLibraryGrid(
    state: AppState,
    images: List<LibraryImage>,
    imageFilter: String,
    loading: Boolean,
    hasMore: Boolean,
) {
    var preview by remember { mutableStateOf(PreviewState()) }
    val scope = rememberCoroutineScope()
    val filters = listOf(
        "all" to "全部",
        "active" to "有效",
        "expired" to "已过期",
        "today" to "今天",
        "week" to "近 7 天",
        "month" to "近 30 天",
    )

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            filters.take(3).forEach { (key, label) ->
                FilterChip(
                    selected = imageFilter == key,
                    onClick = { state.setImageFilter(key) },
                    label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                    shape = RoundedCornerShape(999.dp),
                )
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            filters.drop(3).forEach { (key, label) ->
                FilterChip(
                    selected = imageFilter == key,
                    onClick = { state.setImageFilter(key) },
                    label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                    shape = RoundedCornerShape(999.dp),
                )
            }
        }

        if (images.isEmpty() && loading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            }
        } else if (images.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.Photo,
                title = "没有图片",
                description = "当前筛选下没有图片。",
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 130.dp),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(images, key = { it.id }) { image ->
                    ImageLibraryTile(
                        image = image,
                        onClick = {
                            preview = PreviewState(image = image, isLoading = true)
                            scope.launch {
                                try {
                                    val downloaded = withContext(Dispatchers.IO) {
                                        val session = state.adminSession.value ?: return@withContext null
                                        state.app.apiClient.downloadImage(
                                            state.app.secureSettings.settings.value.serverBaseUrl,
                                            session.accessToken,
                                            image.id,
                                        )
                                    }
                                    if (downloaded != null) {
                                        preview = PreviewState(
                                            image = image,
                                            bytes = downloaded.bytes,
                                            isLoading = false,
                                        )
                                    } else {
                                        preview = PreviewState(image = image, error = "未登录", isLoading = false)
                                    }
                                } catch (err: Exception) {
                                    preview = PreviewState(
                                        image = image,
                                        error = err.message ?: "加载失败",
                                        isLoading = false,
                                    )
                                }
                            }
                        },
                        onDelete = { state.deleteImage(image) },
                    )
                }
            }
            if (hasMore) {
                Button(
                    onClick = { state.loadMoreImages() },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        contentColor = MaterialTheme.colorScheme.onSurface,
                    ),
                ) {
                    Text(if (loading) "加载中…" else "加载更多")
                }
            }
        }
    }

    if (preview.image != null) {
        AlertDialog(
            onDismissRequest = { preview = PreviewState() },
            title = { Text(preview.image!!.sourceDisplayName ?: preview.image!!.id) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    when {
                        preview.isLoading -> {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(
                                    strokeWidth = 2.dp,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text("正在加载预览")
                            }
                        }
                        preview.error != null -> Text(preview.error!!, color = MaterialTheme.colorScheme.error)
                        preview.bytes != null -> {
                            val bitmap = remember(preview.bytes) {
                                BitmapFactory.decodeByteArray(
                                    preview.bytes, 0, preview.bytes!!.size,
                                )?.asImageBitmap()
                            }
                            if (bitmap != null) {
                                Image(
                                    bitmap = bitmap,
                                    contentDescription = "图片预览",
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(MaterialTheme.colorScheme.surfaceContainerLow),
                                    contentScale = ContentScale.Fit,
                                )
                            } else {
                                Text("图片解码失败")
                            }
                            Text("来源：${preview.image!!.uploadedBy.userDisplayName} / ${preview.image!!.uploadedBy.deviceName}")
                            Text("sha256：${preview.image!!.sha256.take(16)}…", style = MonoCaptionStyle)
                            Text("时间：${preview.image!!.createdAt}")
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { state.deleteImage(preview.image!!) }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { preview = PreviewState() }) { Text("关闭") }
            },
        )
    }
}

@Composable
private fun ImageLibraryTile(
    image: LibraryImage,
    onClick: () -> Unit,
    onDelete: () -> Unit,
) {
    SurfaceCard(
        onClick = onClick,
        contentPadding = PaddingValues(0.dp),
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .background(MaterialTheme.colorScheme.surfaceContainerLow),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Photo,
                    contentDescription = null,
                    tint = SlateMuted,
                    modifier = Modifier.size(28.dp),
                )
                if (image.isExpired) {
                    Box(
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.errorContainer)
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                            .align(Alignment.TopEnd),
                    ) {
                        Text(
                            text = "已过期",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }
            Column(modifier = Modifier.padding(10.dp)) {
                Text(
                    text = image.sourceDisplayName ?: image.id,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${image.uploadedBy.deviceName} · ${formatBytes(image.fileSize)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = SlateMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0)
    return String.format("%.1f MB", bytes / (1024.0 * 1024.0))
}
