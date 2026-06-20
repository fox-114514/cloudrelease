package com.studyshot.relay.ui.navigation

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
) {
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val settings by state.app.secureSettings.settings.collectAsState()
    val transient by state.transient.collectAsState()

    LaunchedEffect(transient?.id) {
        val msg = transient ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(msg.text)
        if (result == SnackbarResult.Dismissed) {
            state.clearTransient()
        }
    }

    val permissionRefreshTick = rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(
        settings.autoUploadEnabled,
        settings.realtimeModeEnabled,
        permissionRefreshTick.intValue,
    ) {
        if (settings.autoUploadEnabled && settings.realtimeModeEnabled && hasImagePermission()) {
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
        permissionRefreshTick.intValue,
    ) {
        if (settings.autoUploadEnabled && !settings.realtimeModeEnabled && hasImagePermission()) {
            state.app.uploadRepository.schedulePowerSaveScan(settings.wifiOnly)
        } else {
            state.app.uploadRepository.cancelPowerSaveScan()
        }
    }

    LaunchedEffect(settings.autoReceiveEnabled, settings.deviceTokenAvailable) {
        if (settings.autoReceiveEnabled && settings.deviceTokenAvailable) {
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
        NavHost(
            navController = navController,
            startDestination = Destination.Home.route,
            modifier = Modifier.padding(padding),
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
                    hasDeviceToken = settings.deviceTokenAvailable,
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
