package com.studyshot.relay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.provider.MediaStore
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.studyshot.relay.data.DownloadRecordEntity
import com.studyshot.relay.data.ReceivedHashEntity
import com.studyshot.relay.network.ApiException
import com.studyshot.relay.network.DeliveryPayload
import com.studyshot.relay.network.StudyShotApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

class RelayReceiveService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val socket = AtomicReference<WebSocket?>(null)
    private val heartbeatJob = AtomicReference<Job?>(null)
    private val reconnectJob = AtomicReference<Job?>(null)
    private val reconnectDelayMs = AtomicLong(1_000L)
    private val lastMessageAt = AtomicLong(0L)
    private val reconnectAttempts = AtomicInteger(0)
    private val processingDeliveries = mutableSetOf<String>()
    private val connectMutex = Mutex()
    @Volatile
    private var destroyed = false

    private val app: StudyShotApp
        get() = application as StudyShotApp

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(
            NOTIFICATION_ID,
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("StudyShot Relay")
                .setContentText("正在接收学习截图")
                .setOngoing(true)
                .build(),
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        scope.launch { connect() }
        return START_STICKY
    }

    override fun onDestroy() {
        destroyed = true
        reconnectJob.getAndSet(null)?.cancel()
        heartbeatJob.getAndSet(null)?.cancel()
        socket.getAndSet(null)?.close(1000, "Service stopped")
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun connect() = connectMutex.withLock {
        if (destroyed) return@withLock
        val settings = app.secureSettings.settings.value
        val token = app.secureSettings.getDeviceToken()
        if (!settings.autoReceiveEnabled || settings.serverBaseUrl.isBlank() || token.isNullOrBlank()) {
            stopSelf()
            return@withLock
        }

        reconnectJob.getAndSet(null)?.cancel()
        socket.getAndSet(null)?.close(1000, "Reconnect")

        val request = Request.Builder()
            .url(StudyShotApiClient.wsUrl(settings.serverBaseUrl))
            .header("Authorization", "Bearer $token")
            .build()

        lastMessageAt.set(System.currentTimeMillis())
        val newSocket = app.apiClient.rawClient().newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (destroyed || socket.get() !== webSocket) return
                reconnectDelayMs.set(1_000L)
                reconnectAttempts.set(0)
                webSocket.send("""{"type":"hello"}""")
                startHeartbeat()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (destroyed || socket.get() !== webSocket) return
                lastMessageAt.set(System.currentTimeMillis())
                handleSocketMessage(text)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (socket.get() === webSocket) {
                    socket.set(null)
                    heartbeatJob.getAndSet(null)?.cancel()
                    if (!destroyed) scheduleReconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "WebSocket failure", t)
                if (socket.get() === webSocket) {
                    socket.set(null)
                    heartbeatJob.getAndSet(null)?.cancel()
                    if (!destroyed) scheduleReconnect()
                }
            }
        })
        socket.set(newSocket)
    }

    private fun handleSocketMessage(raw: String) {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (json.optString("type")) {
            "hello.ack" -> scope.launch { fetchPending() }
            "pong" -> Unit
            "image.created" -> scope.launch {
                processDelivery(app.apiClient.parseDelivery(json))
            }
        }
    }

    private suspend fun fetchPending() {
        val settings = app.secureSettings.settings.value
        val token = app.secureSettings.getDeviceToken() ?: return
        if (!settings.autoReceiveEnabled || settings.serverBaseUrl.isBlank()) return

        runCatching {
            app.apiClient.getPendingDeliveries(settings.serverBaseUrl, token).deliveries.forEach {
                processDelivery(it)
            }
        }
    }

    private suspend fun processDelivery(delivery: DeliveryPayload) {
        synchronized(processingDeliveries) {
            if (!processingDeliveries.add(delivery.deliveryId)) return
        }

        try {
            val existing = app.database.dao().getDownloadRecord(delivery.deliveryId)
            if (existing?.status == "downloaded") return
            downloadWithRetries(delivery)
        } finally {
            synchronized(processingDeliveries) {
                processingDeliveries.remove(delivery.deliveryId)
            }
        }
    }

    private suspend fun downloadWithRetries(delivery: DeliveryPayload) {
        var lastError: Throwable? = null
        repeat(3) { attempt ->
            try {
                downloadOnce(delivery)
                return
            } catch (err: Throwable) {
                lastError = err
                if (err is ApiException && (err.statusCode == 401 || err.statusCode == 403)) {
                    recordFailed(delivery, err.message)
                    // Do not stopSelf(); a single auth failure should not kill the service.
                    // The next reconnect will also fail auth and we will eventually give up.
                    return
                }
                delay((attempt + 1) * 800L)
            }
        }

        val message = lastError?.message ?: lastError?.javaClass?.simpleName ?: "Download failed"
        safeAck(delivery.deliveryId, "failed", message, null)
        recordFailed(delivery, message)
    }

    private suspend fun downloadOnce(delivery: DeliveryPayload) {
        val settings = app.secureSettings.settings.value
        val token = app.secureSettings.getDeviceToken() ?: throw IllegalStateException("Device is not bound")
        val downloaded = app.apiClient.downloadImage(settings.serverBaseUrl, token, delivery.image.id)
        val sha256 = downloaded.bytes.sha256()
        if (sha256 != delivery.image.sha256) {
            throw IllegalStateException("Downloaded image sha256 mismatch")
        }

        val target = uniqueTargetFile(delivery, downloaded.mimeType)
        withContext(Dispatchers.IO) {
            val parent = target.parentFile
            if (parent == null || !parent.exists() && !parent.mkdirs()) {
                throw IllegalStateException("Unable to create download directory: ${target.parent}")
            }
            val nomedia = File(parent, ".nomedia")
            if (!nomedia.exists()) {
                nomedia.createNewFile()
            }
            target.writeBytes(downloaded.bytes)
        }

        val now = System.currentTimeMillis()
        app.database.dao().upsertReceivedHash(
            ReceivedHashEntity(
                sha256 = sha256,
                originImageId = delivery.image.id,
                receivedAt = now,
            )
        )
        if (settings.saveDownloadsToGallery) {
            runCatching {
                saveImageToGallery(target.name, downloaded.mimeType, downloaded.bytes)
            }.onFailure { err ->
                Log.e(TAG, "Failed to save image to gallery", err)
            }
        }
        app.database.dao().upsertDownloadRecord(
            DownloadRecordEntity(
                deliveryId = delivery.deliveryId,
                imageId = delivery.image.id,
                sha256 = sha256,
                localUri = target.toURI().toString(),
                sourceDeviceName = delivery.source.uploadDeviceName ?: delivery.source.uploadDeviceId,
                status = "downloaded",
                error = null,
                createdAt = now,
                updatedAt = now,
            )
        )
        safeAck(delivery.deliveryId, "downloaded", null, target.absolutePath)
        showDownloadedNotification(delivery)
    }

    private fun saveImageToGallery(
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ) {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
            put(MediaStore.Images.Media.MIME_TYPE, mimeType.substringBefore(';'))
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/StudyShot Relay")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: error("Unable to create gallery image")
        try {
            contentResolver.openOutputStream(uri)?.use { output ->
                output.write(bytes)
            } ?: error("Unable to open gallery image")
            if (Build.VERSION.SDK_INT >= 29) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                contentResolver.update(uri, values, null, null)
            }
        } catch (err: Throwable) {
            contentResolver.delete(uri, null, null)
            throw err
        }
    }

    private suspend fun recordFailed(delivery: DeliveryPayload, message: String) {
        val now = System.currentTimeMillis()
        app.database.dao().upsertDownloadRecord(
            DownloadRecordEntity(
                deliveryId = delivery.deliveryId,
                imageId = delivery.image.id,
                sha256 = delivery.image.sha256,
                localUri = null,
                sourceDeviceName = delivery.source.uploadDeviceName ?: delivery.source.uploadDeviceId,
                status = "failed",
                error = message,
                createdAt = now,
                updatedAt = now,
            )
        )
    }

    private suspend fun safeAck(
        deliveryId: String,
        status: String,
        errorMessage: String?,
        localPathHint: String?,
    ) {
        val settings = app.secureSettings.settings.value
        val token = app.secureSettings.getDeviceToken() ?: return
        runCatching {
            app.apiClient.ackDelivery(
                serverBaseUrl = settings.serverBaseUrl,
                deviceToken = token,
                deliveryId = deliveryId,
                status = status,
                errorMessage = errorMessage,
                localPathHint = localPathHint,
            )
        }
    }

    private fun startHeartbeat() {
        heartbeatJob.getAndSet(null)?.cancel()
        heartbeatJob.set(scope.launch {
            while (true) {
                delay(30_000)
                if (destroyed) return@launch
                val current = socket.get() ?: return@launch
                if (System.currentTimeMillis() - lastMessageAt.get() > 90_000) {
                    current.close(1001, "Heartbeat timeout")
                    return@launch
                }
                current.send("""{"type":"ping"}""")
            }
        })
    }

    private fun scheduleReconnect() {
        val settings = app.secureSettings.settings.value
        if (!settings.autoReceiveEnabled || destroyed) return
        if (reconnectAttempts.incrementAndGet() > MAX_RECONNECT_ATTEMPTS) {
            Log.w(TAG, "Giving up WebSocket reconnect after $MAX_RECONNECT_ATTEMPTS attempts")
            stopSelf()
            return
        }
        reconnectJob.getAndSet(null)?.cancel()
        reconnectJob.set(scope.launch {
            val delayMs = reconnectDelayMs.get().coerceAtMost(60_000L)
            reconnectDelayMs.set((reconnectDelayMs.get() * 2).coerceAtMost(60_000L))
            delay(delayMs)
            if (!destroyed) connect()
        })
    }

    private fun uniqueTargetFile(delivery: DeliveryPayload, mimeType: String): File {
        val dir = getExternalFilesDir(Environment.DIRECTORY_PICTURES)
            ?.resolve("studyshot-received")
            ?: File(filesDir, "studyshot-received")
        val base = listOf(
            delivery.createdAt.toFileTimestamp(),
            sanitizeFilePart(delivery.source.uploadDeviceName ?: delivery.source.uploadDeviceId),
            delivery.image.id.take(8),
        ).joinToString("_")
        val extension = extensionForMime(mimeType.ifBlank { delivery.image.mimeType })

        for (index in 0 until 1000) {
            val suffix = if (index == 0) "" else "-${index + 1}"
            val candidate = File(dir, "$base$suffix$extension")
            if (!candidate.exists()) return candidate
        }
        error("Unable to allocate image file")
    }

    private fun showDownloadedNotification(delivery: DeliveryPayload) {
        val settings = app.secureSettings.settings.value
        if (!settings.downloadNotificationEnabled) return
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                this,
                android.Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = getSystemService(NotificationManager::class.java)
        val source = delivery.source.uploadDeviceName ?: delivery.source.uploadDeviceId
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("收到新图片")
            .setContentText("$source 的图片已保存")
            .setAutoCancel(true)
            .build()
        manager.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "StudyShot receive",
            NotificationManager.IMPORTANCE_LOW,
        )
        manager.createNotificationChannel(channel)
    }

    private fun ByteArray.sha256(): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(this)
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun String.toFileTimestamp(): String {
        val instant = runCatching { Instant.parse(this) }.getOrDefault(Instant.now())
        return instant.toString()
            .replace(":", "")
            .replace("-", "")
            .substringBefore(".")
            .replace("T", "-")
            .replace("Z", "")
    }

    private fun sanitizeFilePart(value: String): String {
        return value
            .replace(Regex("""[<>:"/\\|?*\u0000-\u001f]"""), "_")
            .replace(Regex("""\s+"""), " ")
            .trim()
            .take(80)
            .ifBlank { "unknown-device" }
    }

    private fun extensionForMime(mimeType: String): String {
        return when (mimeType.substringBefore(';')) {
            "image/jpeg" -> ".jpg"
            "image/png" -> ".png"
            "image/webp" -> ".webp"
            "image/gif" -> ".gif"
            else -> ".img"
        }
    }

    companion object {
        private const val CHANNEL_ID = "studyshot_receive"
        private const val NOTIFICATION_ID = 1002
        private const val TAG = "RelayReceiveService"
        private const val MAX_RECONNECT_ATTEMPTS = 20
    }
}
