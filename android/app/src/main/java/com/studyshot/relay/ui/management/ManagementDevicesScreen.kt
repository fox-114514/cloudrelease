package com.studyshot.relay.ui.management

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.studyshot.relay.network.ManagedDevice
import com.studyshot.relay.ui.components.EmptyState
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SurfaceCard
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.navigation.Destination
import com.studyshot.relay.ui.theme.Hairline
import com.studyshot.relay.ui.theme.SlateMuted
import com.studyshot.relay.ui.theme.Teal600

@Composable
fun ManagementDevicesScreen(
    state: AppState,
    onNavigate: (String) -> Unit,
) {
    val adminSession by state.adminSession.collectAsState()
    val devices by state.adminDevices.collectAsState()

    LaunchedEffect(adminSession?.accessToken) {
        if (adminSession != null) {
            state.refreshDevicesFromSession()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        SectionHeader(
            title = "设备",
            subtitle = "管理本空间下所有设备的权限。",
            actionLabel = "刷新",
            onAction = { state.refreshDevicesFromSession() },
        )

        HelpCallout(
            text = "点任意设备可以细调其权限；点「+」生成新绑定码邀请新设备。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = { onNavigate(Destination.ManagementCreateCode.route) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = Teal600,
                    contentColor = androidx.compose.ui.graphics.Color.White,
                ),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Add,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text("生成绑定码", style = MaterialTheme.typography.labelLarge)
            }
            TextButton(onClick = {
                state.adminLogout()
                onNavigate(Destination.Settings.route)
            }) {
                Icon(
                    imageVector = Icons.Outlined.Logout,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(4.dp))
                Text("退出管理")
            }
        }

        if (devices.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.Devices,
                title = "暂无设备",
                description = "还没有设备绑定到你的空间。",
                modifier = Modifier.fillMaxSize(),
                actionLabel = "生成绑定码",
                onAction = { onNavigate(Destination.ManagementCreateCode.route) },
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(devices, key = { it.id }) { device ->
                    DeviceRow(
                        device = device,
                        onClick = { onNavigate(Destination.ManagementDeviceDetail.withDevice(device.id)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun DeviceRow(
    device: ManagedDevice,
    onClick: () -> Unit,
) {
    val revoked = !device.revokedAt.isNullOrBlank()
    SurfaceCard(
        onClick = onClick,
        contentPadding = PaddingValues(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .background(
                        if (revoked) MaterialTheme.colorScheme.errorContainer
                        else MaterialTheme.colorScheme.primaryContainer,
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.PhoneAndroid,
                    contentDescription = null,
                    tint = if (revoked) MaterialTheme.colorScheme.onErrorContainer
                    else MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = device.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${device.platform} · ${device.userDisplayName ?: device.userId}",
                    style = MaterialTheme.typography.bodySmall,
                    color = SlateMuted,
                )
            }
            Text(
                text = if (revoked) "已撤销" else "有效",
                style = MaterialTheme.typography.labelSmall,
                color = if (revoked) MaterialTheme.colorScheme.error else Teal600,
            )
        }
    }
}
