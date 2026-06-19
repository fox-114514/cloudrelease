package com.studyshot.relay.ui.help

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.QuickActionCard
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.navigation.Destination
import com.studyshot.relay.ui.theme.SlateMuted

@Composable
fun HelpScreen(
    state: AppState,
    onNavigate: (String) -> Unit,
) {
    val settings by state.app.secureSettings.settings.collectAsState()
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(top = 8.dp, bottom = 96.dp),
    ) {
        item { HelpHeader(bound = settings.deviceTokenAvailable) }
        item { SectionHeader(title = "从零开始") }
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                QuickActionCard(
                    title = "首次使用引导",
                    description = "3 步把第一台设备和服务器配对",
                    icon = Icons.Outlined.PlayCircle,
                    onClick = { onNavigate(Destination.HelpFirstRun.route) },
                )
                QuickActionCard(
                    title = "后台运行原理",
                    description = "Foreground Service、省电策略、厂商限制",
                    icon = Icons.Outlined.School,
                    onClick = { onNavigate(Destination.HelpBackground.route) },
                )
            }
        }
        item { SectionHeader(title = "遇到问题") }
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                QuickActionCard(
                    title = "常见问题",
                    description = "截图没传上来、连接断开、权限被拒等",
                    icon = Icons.Outlined.QuestionAnswer,
                    onClick = { onNavigate(Destination.HelpFaq.route) },
                )
                QuickActionCard(
                    title = "权限说明",
                    description = "本 App 申请了哪些权限、为什么",
                    icon = Icons.Outlined.Security,
                    onClick = { onNavigate(Destination.HelpPermissions.route) },
                )
            }
        }
        item { SectionHeader(title = "其他") }
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                QuickActionCard(
                    title = "关于",
                    description = "版本号、服务器地址、致谢",
                    icon = Icons.Outlined.Info,
                    onClick = { onNavigate(Destination.HelpAbout.route) },
                )
            }
        }
    }
}

@Composable
private fun HelpHeader(bound: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Column {
            Text(
                text = "帮助",
                style = MaterialTheme.typography.displayMedium,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = if (bound) "已绑定，可以参考以下内容" else "先完成绑定，再来读这些",
                style = MaterialTheme.typography.bodyMedium,
                color = SlateMuted,
            )
        }
    }
}
