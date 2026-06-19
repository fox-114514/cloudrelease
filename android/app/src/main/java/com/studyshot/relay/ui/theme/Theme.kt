package com.studyshot.relay.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColors = lightColorScheme(
    primary = Teal600,
    onPrimary = White,
    primaryContainer = Teal100,
    onPrimaryContainer = Teal700,
    secondary = Indigo600,
    onSecondary = White,
    secondaryContainer = Indigo100,
    onSecondaryContainer = Indigo600,
    tertiary = Teal500,
    onTertiary = White,
    tertiaryContainer = Teal50,
    onTertiaryContainer = Teal700,
    background = Paper,
    onBackground = Ink,
    surface = Surface,
    onSurface = Ink,
    surfaceVariant = PaperWarm,
    onSurfaceVariant = SlateMuted,
    surfaceContainerLowest = Surface,
    surfaceContainerLow = SurfaceSunken,
    surfaceContainer = Surface,
    surfaceContainerHigh = SurfaceSunken,
    surfaceContainerHighest = PaperWarm,
    outline = Hairline,
    outlineVariant = Hairline,
    error = Rose700,
    onError = White,
    errorContainer = Rose50,
    onErrorContainer = Rose700,
)

private val DarkBg = Color(0xFF0F1A24)
private val DarkSurface = Color(0xFF15202B)
private val DarkSurfaceVariant = Color(0xFF1F2A37)
private val DarkOutline = Color(0xFF2C3A4D)
private val DarkError = Color(0xFFF4A8A4)
private val DarkErrorContainer = Color(0xFF5C1F1F)

private val DarkColors = darkColorScheme(
    primary = Teal500,
    onPrimary = Ink,
    primaryContainer = Teal700,
    onPrimaryContainer = Teal100,
    secondary = Indigo100,
    onSecondary = Indigo600,
    secondaryContainer = Indigo600,
    onSecondaryContainer = Indigo100,
    background = DarkBg,
    onBackground = White,
    surface = DarkSurface,
    onSurface = White,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = Stone,
    outline = DarkOutline,
    error = DarkError,
    onError = Ink,
    errorContainer = DarkErrorContainer,
    onErrorContainer = Color(0xFFF4D8D6),
)

@Composable
fun StudyShotTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !darkTheme
        }
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = StudyShotTypography,
        shapes = StudyShotShapes,
        content = content,
    )
}
