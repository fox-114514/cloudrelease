package com.studyshot.relay.ui.navigation

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.studyshot.relay.upload.MediaStoreScanner
import com.studyshot.relay.data.StorageStatus
import com.studyshot.relay.ui.bind.BindScreen
import com.studyshot.relay.ui.help.HelpAboutScreen
import com.studyshot.relay.ui.help.HelpBackgroundScreen
import com.studyshot.relay.ui.help.HelpFaqScreen
import com.studyshot.relay.ui.help.HelpFirstRunScreen
import com.studyshot.relay.ui.help.HelpPermissionsScreen
import com.studyshot.relay.ui.help.HelpScreen
import com.studyshot.relay.ui.home.HomeScreen
import com.studyshot.relay.ui.library.ActivityScreen
import com.studyshot.relay.ui.management.ManagementCreateCodeScreen
import com.studyshot.relay.ui.management.ManagementDeviceDetailScreen
import com.studyshot.relay.ui.management.ManagementDevicesScreen
import com.studyshot.relay.ui.management.ManagementLoginScreen
import com.studyshot.relay.ui.management.SettingsScreen
import com.studyshot.relay.ui.receive.ReceiveSettingsScreen
import com.studyshot.relay.ui.theme.SlateMuted
import com.studyshot.relay.ui.upload.UploadSettingsScreen
import com.studyshot.relay.ui.upload.WatchAlbumsScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun AppRoot(
    state: AppState,
    hasImagePermission: () -> Boolean,
    hasPartialImagePermission: () -> Boolean,
    startRealtimeService: () -> Unit,
    stopRealtimeService: () -> Unit,
    startReceiveService: () -> Unit,
    stopReceiveService: () -> Unit,
    acceptPendingDeliveries: () -> Unit,
    skipPendingDeliveries: () -> Unit,
) {
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val settings by state.app.secureSettings.settings.collectAsState()
    val transient by state.transient.collectAsState()
    val storageUnavailable = remember(settings.storageStatus) {
        (settings.storageStatus as? StorageStatus.Unavailable)
    }

    // R0-3: persistent top-of-screen error banner instead of a modal that
    // traps the user. The user can dismiss it with "我知道了" and it stays
    // dismissed for the rest of the launch. The Settings / Help destinations
    // remain reachable from the bottom nav, so the user can still diagnose
    // the issue or clear data to recover.
    var storageErrorDismissed by rememberSaveable {
        mutableStateOf(false)
    }
    val showStorageError = storageUnavailable != null && !storageErrorDismissed

    if (settings.pendingOfflineCount > 0) {
        AlertDialog(
            onDismissRequest = {},
            title = { Text("发现离线图片") },
            text = {
                Text(
                    "设备离线期间收到 ${settings.pendingOfflineCount} 张图片，是否现在接收？" +
                        "\n\n在线期间的新图片仍会自动接收。",
                )
            },
            confirmButton = {
                TextButton(onClick = acceptPendingDeliveries) { Text("全部接收") }
            },
            dismissButton = {
                TextButton(onClick = skipPendingDeliveries) { Text("忽略这些图片") }
            },
        )
    }

    LaunchedEffect(transient?.id) {
        val msg = transient ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(msg.text)
        if (result == SnackbarResult.Dismissed) {
            state.clearTransient()
        }
    }

    val permissionRefreshTick = rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(settings.deviceTokenAvailable, settings.deviceId) {
        while (settings.deviceTokenAvailable) {
            state.refreshSelfIdentity()
            delay(5 * 60 * 1000L)
        }
    }

    // R0-3 §3: every service that ships a device token over the network
    // must also gate on storageStatus being Ok. Without encrypted storage
    // we cannot persist or present a token safely, so the foreground
    // services must not start (and must not retry on the next tick).
    val storageReady = settings.storageStatus is StorageStatus.Ok
    val transportReady = settings.isServerTransportAllowed()

    LaunchedEffect(
        settings.autoUploadEnabled,
        settings.realtimeModeEnabled,
        settings.lastKnownPermissionsJson,
        permissionRefreshTick.intValue,
        storageReady,
        transportReady,
    ) {
        if (storageReady && transportReady && settings.autoUploadEnabled && settings.serverAllowsAutoUpload() && settings.realtimeModeEnabled && hasImagePermission()) {
            startRealtimeService()
        } else {
            stopRealtimeService()
        }
    }

    LaunchedEffect(
        settings.autoUploadEnabled,
        settings.realtimeModeEnabled,
        settings.wifiOnly,
        settings.autoUploadScope,
        settings.selectedAlbumPaths,
        settings.excludedAlbumPaths,
        settings.lastKnownPermissionsJson,
        permissionRefreshTick.intValue,
        storageReady,
        transportReady,
    ) {
        if (storageReady && transportReady && settings.autoUploadEnabled && settings.serverAllowsAutoUpload() && !settings.realtimeModeEnabled && hasImagePermission()) {
            state.app.uploadRepository.schedulePowerSaveScan(settings.wifiOnly)
        } else {
            state.app.uploadRepository.cancelPowerSaveScan()
        }
    }

    LaunchedEffect(
        settings.autoReceiveEnabled,
        settings.deviceTokenAvailable,
        settings.lastKnownPermissionsJson,
        storageReady,
        transportReady,
    ) {
        if (storageReady && transportReady && settings.autoReceiveEnabled && settings.serverAllowsAutoReceive() && settings.deviceTokenAvailable) {
            startReceiveService()
        } else {
            stopReceiveService()
        }
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            state.pickManualUpload(uri)
        }
    }
    val pickAlbumDirectory = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
            val albumPath = MediaStoreScanner.albumPathFromTreeUri(uri)
            if (albumPath.isNullOrBlank()) {
                state.emit(TransientMessage("无法识别该目录", StatusTone.Critical))
                return@launch
            }
            state.addAlbumPath(albumPath)
            state.emit(TransientMessage("已添加监听图集：$albumPath", StatusTone.Positive))
        }
    }
    val pickExcludedAlbumDirectory = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val albumPath = MediaStoreScanner.albumPathFromTreeUri(uri)
            if (albumPath.isNullOrBlank()) {
                state.emit(TransientMessage("无法识别该目录", StatusTone.Critical))
                return@launch
            }
            state.addExcludedAlbumPath(albumPath)
        }
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        permissionRefreshTick.intValue = permissionRefreshTick.intValue + 1
        val ok = hasImagePermission()
        state.emit(
            TransientMessage(
                if (ok) "图片权限已授权" else "图片权限不足",
                if (ok) StatusTone.Positive else StatusTone.Critical,
            )
        )
    }

    val onPickImage: () -> Unit = { pickImage.launch("image/*") }
    // `onPickImage` is forwarded into AppNavHost below.

    Scaffold(
        bottomBar = {
            AppBottomBar(navController = navController)
        },
        snackbarHost = {
            SnackbarHost(snackbarHostState) { data ->
                Snackbar(
                    snackbarData = data,
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                )
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            if (showStorageError) {
                StorageErrorBanner(
                    message = storageUnavailable?.message ?: "",
                    onDismiss = { storageErrorDismissed = true },
                )
            }
            AppNavHost(
                navController = navController,
                state = state,
                hasImagePermission = hasImagePermission,
                hasPartialImagePermission = hasPartialImagePermission,
                onPickImage = onPickImage,
                permissionLauncher = permissionLauncher,
                pickAlbumDirectory = pickAlbumDirectory,
                pickExcludedAlbumDirectory = pickExcludedAlbumDirectory,
                hasDeviceToken = settings.deviceTokenAvailable,
            )
        }
    }
}

@Composable
private fun StorageErrorBanner(
    message: String,
    onDismiss: () -> Unit,
) {
    // Persistent banner that lives at the top of the screen. R0-3 §1
    // rejected a modal because it traps the user and blocks access to
    // Settings / Help; an "我知道了" button is wired to a real dismiss
    // (rememberSaveable state) so the user can hide it for the rest of
    // the launch without losing the underlying data.
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        tonalElevation = 0.dp,
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Text(
                    text = "加密存储不可用",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Outlined.Close, contentDescription = "我知道了")
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "建议：进入 设置 → 应用 → StudyShot Relay → 存储 → 清除数据 并重启；" +
                    "或重启设备后重试。设置/帮助仍可访问以查看诊断信息。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun AppNavHost(
    navController: NavHostController,
    state: AppState,
    hasImagePermission: () -> Boolean,
    hasPartialImagePermission: () -> Boolean,
    onPickImage: () -> Unit,
    permissionLauncher: androidx.activity.result.ActivityResultLauncher<Array<String>>,
    pickAlbumDirectory: androidx.activity.result.ActivityResultLauncher<Uri?>,
    pickExcludedAlbumDirectory: androidx.activity.result.ActivityResultLauncher<Uri?>,
    hasDeviceToken: Boolean,
) {
    NavHost(
        navController = navController,
        startDestination = Destination.Home.route,
        modifier = Modifier,
        enterTransition = {
            slideInHorizontally(
                initialOffsetX = { it / 6 },
                animationSpec = tween(220),
            ) + fadeIn(tween(220))
        },
        exitTransition = {
            slideOutHorizontally(
                targetOffsetX = { -it / 8 },
                animationSpec = tween(180),
            ) + fadeOut(tween(180))
        },
        popEnterTransition = {
            slideInHorizontally(
                initialOffsetX = { -it / 8 },
                animationSpec = tween(220),
            ) + fadeIn(tween(220))
        },
        popExitTransition = {
            slideOutHorizontally(
                targetOffsetX = { it / 6 },
                animationSpec = tween(180),
            ) + fadeOut(tween(180))
        },
    ) {
        composable(Destination.Home.route) {
            HomeScreen(
                state = state,
                onNavigate = { navController.navigate(it) },
                onPickImage = onPickImage,
                hasImagePermission = hasImagePermission(),
                hasPartialImagePermission = hasPartialImagePermission(),
                hasDeviceToken = hasDeviceToken,
            )
        }
        composable(Destination.Activity.route) {
            ActivityScreen(state = state, onPickImage = onPickImage)
        }
        composable(Destination.Settings.route) {
            SettingsScreen(
                state = state,
                onNavigate = { navController.navigate(it) },
            )
        }
        composable(Destination.Help.route) {
            HelpScreen(
                state = state,
                onNavigate = { navController.navigate(it) },
            )
        }
        composable(Destination.Bind.route) {
            BindScreen(state = state)
        }
        composable(Destination.UploadSettings.route) {
            UploadSettingsScreen(
                state = state,
                onNavigate = { navController.navigate(it) },
                onRequestPermission = { permissionLauncher.launch(requiredPermissions()) },
                hasImagePermission = hasImagePermission(),
                hasPartialImagePermission = hasPartialImagePermission(),
            )
        }
        composable(Destination.WatchAlbums.route) {
            WatchAlbumsScreen(
                state = state,
                onAddAlbum = { pickAlbumDirectory.launch(null) },
                onAddExcludedAlbum = { pickExcludedAlbumDirectory.launch(null) },
                hasImagePermission = hasImagePermission(),
            )
        }
        composable(Destination.ReceiveSettings.route) {
            ReceiveSettingsScreen(state = state)
        }
        composable(Destination.ManagementLogin.route) {
            ManagementLoginScreen(state = state)
        }
        composable(Destination.ManagementDevices.route) {
            ManagementDevicesScreen(
                state = state,
                onNavigate = { navController.navigate(it) },
            )
        }
        composable(
            Destination.ManagementDeviceDetail.route,
            arguments = listOf(navArgument("deviceId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val deviceId = backStackEntry.arguments?.getString("deviceId") ?: ""
            ManagementDeviceDetailScreen(
                state = state,
                deviceId = deviceId,
                onBack = { navController.popBackStack() },
            )
        }
        composable(Destination.ManagementCreateCode.route) {
            ManagementCreateCodeScreen(state = state)
        }
        composable(Destination.HelpFaq.route) { HelpFaqScreen() }
        composable(Destination.HelpAbout.route) { HelpAboutScreen(state = state) }
        composable(Destination.HelpFirstRun.route) {
            HelpFirstRunScreen(
                onNavigate = { navController.navigate(it) },
            )
        }
        composable(Destination.HelpBackground.route) { HelpBackgroundScreen() }
        composable(Destination.HelpPermissions.route) { HelpPermissionsScreen() }
    }
}

@Composable
private fun AppBottomBar(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val current = backStackEntry?.destination
    val showBar = current?.hierarchy?.any { dest ->
        bottomTabs.any { it.destination.route == dest.route }
    } ?: true
    if (!showBar) return

    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = 0.dp,
    ) {
        bottomTabs.forEach { tab ->
            val selected = current?.hierarchy?.any { it.route == tab.destination.route } == true
            NavigationBarItem(
                selected = selected,
                onClick = {
                    if (!selected) {
                        navController.navigate(tab.destination.route) {
                            popUpTo(navController.graph.findStartDestination().id) {
                                saveState = true
                            }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                },
                icon = {
                    Icon(
                        imageVector = tab.icon,
                        contentDescription = tab.label,
                    )
                },
                label = {
                    Text(
                        text = tab.label,
                        style = MaterialTheme.typography.labelMedium,
                    )
                },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedTextColor = MaterialTheme.colorScheme.primary,
                    indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                    unselectedIconColor = SlateMuted,
                    unselectedTextColor = SlateMuted,
                ),
            )
        }
    }
}

private fun requiredPermissions(): Array<String> {
    return buildList {
        add(
            if (Build.VERSION.SDK_INT >= 33) {
                Manifest.permission.READ_MEDIA_IMAGES
            } else {
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
        )
        if (Build.VERSION.SDK_INT >= 33) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }.toTypedArray()
}
