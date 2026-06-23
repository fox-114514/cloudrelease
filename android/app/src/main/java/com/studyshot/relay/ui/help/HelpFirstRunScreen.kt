package com.studyshot.relay.ui.help

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddLink
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Done
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SurfaceCard
import com.studyshot.relay.ui.navigation.Destination
import com.studyshot.relay.ui.theme.SlateMuted
import com.studyshot.relay.ui.theme.Teal100
import com.studyshot.relay.ui.theme.Teal600
import androidx.compose.foundation.background

@Composable
fun HelpFirstRunScreen(
    onNavigate: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "首次使用",
            subtitle = "3 步把第一台设备和你的服务器配对。",
        )

        StepRow(
            step = 1,
            title = "生成绑定码",
            description = "在服务器上打开网页管理后台 /admin，用主用户登录；或在你的电脑客户端上点「生成绑定码」。绑定码是一次性、几分钟内过期。",
        )
        StepRow(
            step = 2,
            title = "在这台设备上绑定",
            description = "回到本 App，底部 Tab「设置 → 设备与服务器」，填入服务器地址和绑定码。绑定成功后会自动保存。",
            onAction = "去绑定",
            onActionTarget = Destination.Bind,
            onNavigate = onNavigate,
        )
        StepRow(
            step = 3,
            title = "开自动上传",
            description = "底部 Tab「设置 → 上传设置」打开「自动上传」。第一次可先勾「实时学习模式」感受一下延迟。",
            onAction = "去上传设置",
            onActionTarget = Destination.UploadSettings,
            onNavigate = onNavigate,
        )

        Spacer(Modifier.height(12.dp))

        HelpCallout(
            text = "如果服务器启用了 HTTPS 但证书不被信任，App 会拒绝连接。请联系服务器管理员检查证书。",
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

@Composable
private fun StepRow(
    step: Int,
    title: String,
    description: String,
    onAction: String? = null,
    onActionTarget: Destination? = null,
    onNavigate: (String) -> Unit = {},
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .background(Teal100, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = step.toString(),
                style = MaterialTheme.typography.labelLarge,
                color = Teal600,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = SlateMuted,
            )
            if (onAction != null && onActionTarget != null) {
                Spacer(Modifier.height(8.dp))
                androidx.compose.material3.TextButton(
                    onClick = { onNavigate(onActionTarget.route) },
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                ) {
                    Text(onAction, color = Teal600)
                }
            }
        }
    }
}
