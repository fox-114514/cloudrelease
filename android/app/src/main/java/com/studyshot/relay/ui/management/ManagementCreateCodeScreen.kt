package com.studyshot.relay.ui.management

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.studyshot.relay.ui.components.HelpCallout
import com.studyshot.relay.ui.components.SectionHeader
import com.studyshot.relay.ui.components.SettingsGroup
import com.studyshot.relay.ui.components.SettingsRow
import com.studyshot.relay.ui.navigation.AppState
import com.studyshot.relay.ui.theme.Teal600

@Composable
fun ManagementCreateCodeScreen(
    state: AppState,
) {
    val settings by state.app.secureSettings.settings.collectAsState()
    var hint by rememberSaveable(settings.deviceName) { mutableStateOf(settings.deviceName) }
    var creating by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        SectionHeader(
            title = "创建绑定码",
            subtitle = "把绑定码告诉要加入的设备。在新设备上打开 StudyShot Relay → 绑定到服务器。",
        )
        HelpCallout(
            text = "绑定码一次性使用，过期时间由服务器配置决定。",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Spacer(Modifier.height(8.dp))
        SettingsGroup(
            title = "设备名提示",
            footer = "仅用于让你自己记得这个绑定码是给哪个设备准备的；不影响实际注册。",
        ) {
            SettingsRow(
                icon = Icons.Outlined.PhoneAndroid,
                title = "设备名提示",
                value = hint,
                isLast = false,
            )
            OutlinedTextField(
                value = hint,
                onValueChange = { hint = it },
                singleLine = true,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                placeholder = { Text("如：客厅 iPad") },
            )
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                creating = true
                state.createBindCode(hint)
            },
            enabled = !creating,
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Teal600,
                contentColor = androidx.compose.ui.graphics.Color.White,
            ),
        ) {
            Text(
                text = "生成绑定码",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
