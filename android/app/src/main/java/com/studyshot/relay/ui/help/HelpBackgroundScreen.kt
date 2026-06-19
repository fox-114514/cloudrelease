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
import androidx.compose.material.icons.outlined.Power
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing
import com.studyshot.relay.ui.components.ExpandableRow
import com.studyshot.relay.ui.theme.SlateMuted

@Composable
fun HelpBackgroundScreen() {
    var realtime by rememberSaveable { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "后台运行原理",
            subtitle = "本 App 用了两种模式监听截图，各有取舍。",
        )

        HelpCallout(
            text = "现代 Android 对后台限制很严。下文说明本 App 的取舍；遇到「App 被杀」时回到这里。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "实时学习模式",
            footer = "延迟 1-3 秒。常驻通知 + 耗电略高。",
        ) {
            ExpandableRow(
                icon = Icons.Outlined.Bolt,
                title = "Foreground Service + ContentObserver",
                subtitle = "对 MediaStore 注册观察器，截图写入即触发",
                expanded = realtime,
                onToggle = { realtime = !realtime },
                content = {
                    Text(
                        text = "Service 类型是 dataSync。Android 14 要求 dataSync 类型必须有可见通知；这就是你看到的「正在监听学习截图」通知。\n\n" +
                            "对 MediaStore.Images 注册 ContentObserver，OEM 截图 App 写入新图片时回调。在回调里扫描最近 N 秒的图片，加入上传队列。",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                },
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "省电扫描模式",
            footer = "延迟几分钟。几乎不耗电；可能漏极短间隔的截图。",
        ) {
            ExpandableRow(
                icon = Icons.Outlined.Schedule,
                title = "WorkManager 周期任务",
                subtitle = "约每 15 分钟跑一次，扫描新图片",
                expanded = false,
                onToggle = { },
                content = {
                    Text(
                        text = "由 WorkManager 调度，受系统 Doze、App Standby 限制。当设备空闲时可能延迟到维护窗口执行。\n\n" +
                            "扫描基于 MediaStore 时间戳，只上传未上传过的图片。",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                },
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "接收端",
            footer = "接收走 WebSocket。失败会重连。",
        ) {
            ExpandableRow(
                icon = Icons.Outlined.Sync,
                title = "WebSocket 长连接",
                subtitle = "新图片事件秒级推送到接收端",
                expanded = false,
                onToggle = { },
                content = {
                    Text(
                        text = "绑定后，App 启动另一个 Foreground Service 与服务器保持 WebSocket 连接，接收 image.created 事件。\n\n" +
                            "断线时按指数退避重连，间隔 1-60 秒。被撤销的设备连接会被服务端拒绝。",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                },
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "厂商限制",
            footer = "国产 ROM 经常杀后台，遇到问题去对应设置里加白。",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Power,
                title = "ColorOS / OxygenOS",
                subtitle = "设置 → 电池 → 更多设置 → 关闭「睡眠待机优化」",
                isLast = false,
            )
            SettingsRow(
                icon = Icons.Outlined.Notifications,
                title = "MIUI / HyperOS",
                subtitle = "设置 → 应用 → StudyShot → 自启动 + 省电策略：无限制",
                isLast = false,
            )
            SettingsRow(
                icon = Icons.Outlined.Bolt,
                title = "EMUI / HarmonyOS",
                subtitle = "设置 → 应用 → StudyShot → 电池 → 启动管理：改为「手动管理」全勾",
                isLast = true,
            )
        }
    }
}
