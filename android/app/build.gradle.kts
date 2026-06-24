import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
}

android {
    namespace = "com.studyshot.relay"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.studyshot.relay"
        minSdk = 26
        targetSdk = 34
        versionCode = 8
        versionName = "0.5.0"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    // ---- Signing ----
    // Two layers of variables feed the release signing config:
    //   1. keystore.properties next to the app module (gitignored), populated
    //      by `scripts/generate-keystore.sh` for the dev/test key, or by a
    //      release engineer with the production key.
    //   2. Environment variables SSR_KEYSTORE_PATH / SSR_KEYSTORE_PASSWORD /
    //      SSR_KEY_ALIAS / SSR_KEY_PASSWORD, used by CI.
    // Env vars win over the properties file. If neither supplies a keystore
    // path, the **release** build fails fast instead of silently falling back
    // to the test key. debug builds are unaffected.
    val keystoreProps = run {
        val propsFile = rootProject.file("app/keystore.properties")
        if (propsFile.isFile) {
            Properties().apply { propsFile.inputStream().use { load(it) } }
        } else {
            null
        }
    }
    fun signingProp(envKey: String, propsKey: String, default: String? = null): String? {
        System.getenv(envKey)?.takeIf { it.isNotBlank() }?.let { return it }
        keystoreProps?.getProperty(propsKey)?.takeIf { it.isNotBlank() }?.let { return it }
        return default
    }
    val releaseKeystorePath = signingProp("SSR_KEYSTORE_PATH", "storeFile")
    val releaseKeystorePassword = signingProp("SSR_KEYSTORE_PASSWORD", "storePassword")
    val releaseKeyAlias = signingProp("SSR_KEY_ALIAS", "keyAlias")
    val releaseKeyPassword = signingProp("SSR_KEY_PASSWORD", "keyPassword")
    val hasReleaseSigning = !releaseKeystorePath.isNullOrBlank() &&
        !releaseKeystorePassword.isNullOrBlank() &&
        !releaseKeyAlias.isNullOrBlank() &&
        !releaseKeyPassword.isNullOrBlank()

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                // Resolve relative paths against the project root (not the app
                // module dir) so keystore.properties can use the conventional
                // "app/keystore/..." form and env vars can use absolute paths.
                val resolvedStoreFile = File(releaseKeystorePath!!).let { f ->
                    if (f.isAbsolute) f else rootProject.file(f.path)
                }
                storeFile = resolvedStoreFile
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                // Enable V2/V3 signature schemes so Android 7+ and 11+ verify
                // the production build correctly.
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            // If no signing material is configured we leave signingConfig null.
            // The hard-fail below (registered on the task graph) prevents
            // actually producing an unsigned release APK/AAB, instead of
            // silently using a dev/test key for production as before.
        }
        debug {
            // Debug builds keep using the AGP default debug signing config.
        }
    }

    // Hard-fail release-oriented assemble/package tasks when no signing
    // material exists. Evaluated lazily so debug/config-only builds still
    // work in CI without a keystore.
    gradle.taskGraph.whenReady {
        val releaseTaskScheduled = allTasks.any { task ->
            task.name.startsWith("assemble") || task.name.startsWith("bundle") || task.name.startsWith("package")
        }.let { _ ->
            allTasks.any { task ->
                val n = task.name
                // assembleRelease, bundleRelease, packageRelease, :app:assembleRelease ...
                n.endsWith("Release", ignoreCase = true) ||
                    n.endsWith("ReleaseUnitTest", ignoreCase = true) ||
                    n.endsWith("ReleaseAndroidTest", ignoreCase = true)
            }
        }
        if (releaseTaskScheduled && !hasReleaseSigning) {
            throw GradleException(
                "Release build requires signing configuration. Provide " +
                    "either app/keystore.properties or environment variables " +
                    "SSR_KEYSTORE_PATH / SSR_KEYSTORE_PASSWORD / SSR_KEY_ALIAS / " +
                    "SSR_KEY_PASSWORD. For local dev/test builds run " +
                    "scripts/generate-keystore.sh first.",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.10"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")

    implementation("androidx.compose.ui:ui:1.6.1")
    implementation("androidx.compose.ui:ui-tooling-preview:1.6.1")
    implementation("androidx.compose.material3:material3:1.2.0")
    implementation("androidx.compose.material:material-icons-core:1.6.1")
    implementation("androidx.compose.material:material-icons-extended:1.6.1")
    implementation("androidx.compose.animation:animation:1.6.1")
    debugImplementation("androidx.compose.ui:ui-tooling:1.6.1")

    implementation("androidx.navigation:navigation-compose:2.7.7")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")

    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // §8.8 §3: Android unit-test coverage for SecureSettings (R0-3 storage-
    // status gating, R0-4 full-fidelity fallback migration). Robolectric
    // supplies a real SharedPreferences implementation on the JVM so we
    // don't need an emulator for these tests.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.11.1")
    testImplementation("androidx.test:core:1.5.0")
    testImplementation("androidx.test.ext:junit:1.1.5")
}
