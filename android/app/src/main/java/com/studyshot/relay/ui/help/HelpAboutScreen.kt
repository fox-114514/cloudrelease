package com.studyshot.relay.ui.help

import android.os.Build
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Android
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.studyshot.relay.BuildConfig
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.components.RowTrailing
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.theme.MonoCaptionStyle
import com.studyshot.relay.ui.theme.SlateMuted

@Composable
fun HelpAboutScreen(
    state: AppState,
) {
    val settings by state.app.secureSettings.settings.collectAsState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "关于",
            subtitle = "StudyShot Relay 是一个私有、低延迟的跨设备图片快传系统。",
        )
        HelpCallout(
            text = "当前版本 ${BuildConfig.VERSION_NAME}。如果遇到 bug，请把服务器日志一起提供。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Spacer(Modifier.height(8.dp))

        SettingsGroup(title = "本机") {
            SettingsRow(
                icon = Icons.Outlined.Android,
                title = "系统",
                value = "Android ${Build.VERSION.RELEASE} · SDK ${Build.VERSION.SDK_INT}",
                isLast = false,
            )
            SettingsRow(
                icon = Icons.Outlined.Fingerprint,
                title = "App 版本",
                value = BuildConfig.VERSION_NAME,
                isLast = true,
            )
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "服务器",
            footer = "服务器地址保存在本机加密存储；token 也在加密存储。换设备或重装 App 都需要重新绑定。",
        ) {
            SettingsRow(
                icon = Icons.Outlined.Storage,
                title = "服务器地址",
                value = settings.serverBaseUrl.ifBlank { "未配置" },
                isLast = settings.deviceId.isBlank(),
            )
            if (settings.deviceId.isNotBlank()) {
                SettingsRow(
                    title = "设备 ID",
                    value = settings.deviceId,
                    isLast = true,
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        SettingsGroup(
            title = "致谢",
            footer = "StudyShot Relay 是私有部署项目，无云端、无遥测、无广告。",
        ) {
            SettingsRow(
                title = "后端 / 桌面 / 网页",
                value = "Fastify · Prisma · Electron · Vanilla",
                isLast = false,
            )
            SettingsRow(
                title = "Android App",
                value = "Kotlin · Jetpack Compose · Material 3",
                isLast = true,
            )
        }
    }
}
