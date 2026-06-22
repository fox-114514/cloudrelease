package com.studyshot.relay.ui.management

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Inventory
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.studyshot.relay.network.ManagedDevice
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing
import com.studyshot.relay.ui.components.SurfaceCard
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.theme.Rose700

@Composable
fun ManagementDeviceDetailScreen(
    state: AppState,
    deviceId: String,
    onBack: () -> Unit,
) {
    val devices by state.adminDevices.collectAsState()
    val session by state.adminSession.collectAsState()
    val device = remember(devices, deviceId) { devices.firstOrNull { it.id == deviceId } }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = device?.name ?: "设备",
            subtitle = device?.let { "${it.platform} · ${it.userDisplayName ?: it.userId}" } ?: "",
            actionLabel = "返回",
            onAction = onBack,
        )
        if (device == null) {
            SurfaceCard {
                Text(
                    "找不到该设备。返回列表后下拉刷新。",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            return
        }
        DeviceProfileSection(state = state, device = device)
        val isOwner = session?.user?.role == "owner"
        DevicePermissionsSection(state = state, device = device, isOwner = isOwner)
        if (!isOwner) {
            HelpCallout(
                text = "成员可修改自己设备的手动上传/下载权限；自动权限请使用安全用途预设，管理空间等高级权限由空间管理员设置。",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        DeviceRevokeSection(state = state, device = device, onDeleted = onBack)
    }
}

@Composable
private fun DeviceProfileSection(
    state: AppState,
    device: ManagedDevice,
) {
    val revoked = !device.revokedAt.isNullOrBlank()
    val profiles = listOf(
        "manual_only" to "只手动分享",
        "upload_only" to "只上传截图",
        "receive_own" to "只接收我的图片",
        "sync_own" to "我的设备双向同步",
    )
    SettingsGroup(
        title = "设备用途",
        footer = if (device.profile == "custom") "当前为自定义高级配置；选择预设会安全重置运行权限。" else "用途预设不会授予管理空间等高危权限。",
    ) {
        profiles.forEachIndexed { index, (profile, label) ->
            SettingsRow(
                icon = Icons.Outlined.Devices,
                title = label,
                value = if (device.profile == profile) "当前" else null,
                isLast = index == profiles.lastIndex,
                enabled = !revoked,
                onClick = { state.updateDeviceProfile(device.id, profile) },
            )
        }
    }
}

@Composable
private fun DevicePermissionsSection(
    state: AppState,
    device: ManagedDevice,
    isOwner: Boolean,
) {
    val revoked = !device.revokedAt.isNullOrBlank()
    val rows = listOf(
        Triple("canAutoUpload", "自动上传", Icons.Outlined.CloudUpload),
        Triple("canManualUpload", "手动上传", Icons.Outlined.Inventory),
        Triple("canAutoReceive", "自动接收", Icons.Outlined.Cloud),
        Triple("canManualDownload", "手动下载", Icons.Outlined.HelpOutline),
        Triple("canManageSpace", "管理空间", Icons.Outlined.Key),
        Triple("canCreateInvite", "创建邀请", Icons.Outlined.Folder),
    ).filter { isOwner || it.first == "canManualUpload" || it.first == "canManualDownload" }
    SettingsGroup(
        title = "权限",
        footer = "修改会立即生效。已撤销的设备不能修改权限。",
    ) {
        rows.forEachIndexed { index, (key, label, icon) ->
            val checked = permissionValue(device, key)
            SettingsRow(
                icon = icon,
                title = label,
                trailing = RowTrailing.SwitchControl(
                    checked = checked,
                    onCheckedChange = { state.updateDevicePermission(device.id, key, it) },
                ),
                isLast = index == rows.lastIndex,
                enabled = !revoked,
            )
        }
    }

    Spacer(Modifier.height(8.dp))
    SettingsGroup(title = "范围") {
        SettingsRow(
            icon = Icons.Outlined.CloudUpload,
            title = "上传范围",
            value = device.permissions.autoUploadScope,
            isLast = false,
        )
        SettingsRow(
            icon = Icons.Outlined.Cloud,
            title = "接收范围",
            value = device.permissions.autoReceiveScope,
            isLast = true,
        )
    }
}

@Composable
private fun DeviceRevokeSection(
    state: AppState,
    device: ManagedDevice,
    onDeleted: () -> Unit,
) {
    val revoked = !device.revokedAt.isNullOrBlank()
    var confirmDelete by remember { mutableStateOf(false) }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("删除已撤销设备？") },
            text = { Text("设备会从管理列表隐藏，历史图片和审计记录仍会保留。此操作不可恢复。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDelete = false
                        state.deleteDevice(device.id, onDeleted = onDeleted)
                    },
                ) {
                    Text("确认删除", color = Rose700)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) {
                    Text("取消")
                }
            },
        )
    }
    Column(
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        if (revoked) {
            HelpCallout(
                text = "该设备已被撤销，所有 token 立即失效。可以将它从设备列表删除。",
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = { confirmDelete = true },
                colors = ButtonDefaults.buttonColors(
                    containerColor = Rose700,
                    contentColor = androidx.compose.ui.graphics.Color.White,
                ),
                modifier = Modifier.fillMaxSize(),
            ) {
                Text(
                    text = "删除已撤销设备",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        } else {
            Button(
                onClick = { state.revokeDevice(device.id) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = Rose700,
                    contentColor = androidx.compose.ui.graphics.Color.White,
                ),
                modifier = Modifier.fillMaxSize(),
            ) {
                Text(
                    text = "撤销设备",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = "撤销后该设备的所有 token 立即失效，且不能恢复。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private fun permissionValue(device: ManagedDevice, key: String): Boolean {
    return when (key) {
        "canAutoUpload" -> device.permissions.canAutoUpload
        "canManualUpload" -> device.permissions.canManualUpload
        "canAutoReceive" -> device.permissions.canAutoReceive
        "canManualDownload" -> device.permissions.canManualDownload
        "canManageSpace" -> device.permissions.canManageSpace
        "canCreateInvite" -> device.permissions.canCreateInvite
        else -> false
    }
}
