package com.studyshot.relay.upload

import android.content.ContentResolver
import android.net.Uri
import java.security.MessageDigest

data class ImageDigest(
    val sha256: String,
    val fileSize: Long,
)

fun ContentResolver.computeSha256(uri: Uri): ImageDigest {
    val digest = MessageDigest.getInstance("SHA-256")
    var total = 0L
    openInputStream(uri)?.use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            digest.update(buffer, 0, read)
            total += read
        }
    } ?: error("Unable to open input stream")

    return ImageDigest(
        sha256 = digest.digest().joinToString("") { "%02x".format(it) },
        fileSize = total,
    )
}

fun ContentResolver.detectImageMimeType(uri: Uri): String? {
    val header = ByteArray(12)
    val read = openInputStream(uri)?.use { input ->
        input.read(header)
    } ?: return null

    if (read >= 4 &&
        header[0] == 0x89.toByte() &&
        header[1] == 0x50.toByte() &&
        header[2] == 0x4e.toByte() &&
        header[3] == 0x47.toByte()
    ) {
        return "image/png"
    }

    if (read >= 3 &&
        header[0] == 0xff.toByte() &&
        header[1] == 0xd8.toByte() &&
        header[2] == 0xff.toByte()
    ) {
        return "image/jpeg"
    }

    if (read >= 12 &&
        header[0] == 0x52.toByte() &&
        header[1] == 0x49.toByte() &&
        header[2] == 0x46.toByte() &&
        header[3] == 0x46.toByte() &&
        header[8] == 0x57.toByte() &&
        header[9] == 0x45.toByte() &&
        header[10] == 0x42.toByte() &&
        header[11] == 0x50.toByte()
    ) {
        return "image/webp"
    }

    return null
}
