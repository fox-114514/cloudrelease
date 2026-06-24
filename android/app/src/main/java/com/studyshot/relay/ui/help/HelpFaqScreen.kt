package com.studyshot.relay.ui.help

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.ExpandableRow
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text

@Composable
fun HelpFaqScreen() {
    val faqs = listOf(
        FaqEntry(
            icon = Icons.Outlined.Photo,
            title = "截图没自动传上来？",
            body = "检查 3 件事：\n" +
                "1) 设置 → 上传：自动上传已打开，并确认选择的是实时模式还是约 15 分钟一次的省电模式。\n" +
                "2) 设置里能看到当前设备名与「已绑定」。\n" +
                "3) 图片权限是「完整授权」而不是「部分照片」。",
        ),
        FaqEntry(
            icon = Icons.Outlined.Wifi,
            title = "Wi-Fi 下传了，蜂窝数据下不传？",
            body = "这是「仅 Wi-Fi 上传」开关的作用。关掉它就能在蜂窝数据下也上传。",
        ),
        FaqEntry(
            icon = Icons.Outlined.Storage,
            title = "更新包下载到哪里？",
            body = "更新包由你绑定的 StudyShot 服务器分发，保存到公共 Downloads/StudyShot Relay 目录。下载完成后 App 会校验 SHA-256 并打开系统安装器；首次使用需要允许“安装未知应用”。",
        ),
        FaqEntry(
            icon = Icons.Outlined.HelpOutline,
            title = "卸载或清除数据后会怎样？",
            body = "设备 token 和设置会被删除，需要重新绑定。服务器上的图片和设备记录不会随手机卸载自动删除；管理员可在 /admin 中撤销或删除旧设备。",
        ),
        FaqEntry(
            icon = Icons.Outlined.Notifications,
            title = "通知栏一直显示「正在监听」？",
            body = "实时学习模式需要常驻通知。这是预期行为。下拉通知可以查看最近上传 / 下载。",
        ),
        FaqEntry(
            icon = Icons.Outlined.Bolt,
            title = "耗电明显？",
            body = "实时学习模式会在截图变化时唤醒监听，比定时扫描快，但比纯后台省电。\n" +
                "如果你的设备是 ColorOS / OxygenOS，可能需要手动关闭电池优化并允许自启动。",
        ),
        FaqEntry(
            icon = Icons.Outlined.Storage,
            title = "服务器连接不上？",
            body = "常见原因：\n" +
                "• 服务器地址拼写错或漏端口。\n" +
                "• 服务器未启动 / 防火墙挡住。\n" +
                "• 自签名 HTTPS 证书，App 会拒绝。\n" +
                "• 设备 token 被 owner 撤销。",
        ),
        FaqEntry(
            icon = Icons.Outlined.HelpOutline,
            title = "怎么排查更具体？",
            body = "在服务器上：\n" +
                "• docker compose logs -f backend 看后端日志。\n" +
                "• 打开 /admin → 审计日志：所有上传、下载、撤销都在这里。\n" +
                "• 看「记录」Tab 的上传 / 下载日志，能定位是本地上传失败还是下载失败。",
        ),
    )
    val expanded = rememberSaveable(faqs.size) {
        mutableStateOf(setOf<Int>())
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "常见问题",
            subtitle = "点击展开。",
        )
        HelpCallout(
            text = "看不到答案？打开网页管理后台 /admin 看审计日志，通常能直接定位。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Spacer(Modifier.height(8.dp))

        SettingsGroup {
            faqs.forEachIndexed { index, entry ->
                ExpandableRow(
                    icon = entry.icon,
                    title = entry.title,
                    expanded = index in expanded.value,
                    onToggle = {
                        expanded.value = if (index in expanded.value) {
                            expanded.value - index
                        } else {
                            expanded.value + index
                        }
                    },
                    content = {
                        androidx.compose.material3.Text(
                            text = entry.body,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    },
                )
            }
        }
    }
}

private data class FaqEntry(
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val title: String,
    val body: String,
)
