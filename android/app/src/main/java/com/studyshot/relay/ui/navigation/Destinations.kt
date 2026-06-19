package com.studyshot.relay.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Destination(val route: String) {
    data object Home : Destination("home")
    data object Activity : Destination("activity")
    data object Settings : Destination("settings")
    data object Help : Destination("help")

    data object Bind : Destination("bind")
    data object UploadSettings : Destination("upload/settings")
    data object WatchAlbums : Destination("upload/albums")
    data object ReceiveSettings : Destination("receive/settings")
    data object ServerConfig : Destination("server/config")

    data object ManagementLogin : Destination("management/login")
    data object ManagementDevices : Destination("management/devices")
    data object ManagementDeviceDetail :
        Destination("management/device/{deviceId}") {
        fun withDevice(deviceId: String): String = "management/device/$deviceId"
    }
    data object ManagementImageLibrary : Destination("management/library")
    data object ManagementCreateCode : Destination("management/code")

    data object HelpFaq : Destination("help/faq")
    data object HelpAbout : Destination("help/about")
    data object HelpFirstRun : Destination("help/first-run")
    data object HelpBackground : Destination("help/background")
    data object HelpPermissions : Destination("help/permissions")
}

data class BottomTab(
    val destination: Destination,
    val label: String,
    val icon: ImageVector,
)

val bottomTabs = listOf(
    BottomTab(Destination.Home, "主页", Icons.Outlined.Home),
    BottomTab(Destination.Activity, "记录", Icons.Outlined.Forum),
    BottomTab(Destination.Settings, "设置", Icons.Outlined.Settings),
    BottomTab(Destination.Help, "帮助", Icons.Outlined.HelpOutline),
)
