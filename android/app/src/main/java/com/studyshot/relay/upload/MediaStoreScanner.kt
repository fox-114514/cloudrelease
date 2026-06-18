package com.studyshot.relay.upload

import android.content.ContentResolver
import android.content.ContentUris
import android.os.Build
import android.provider.MediaStore
import java.security.MessageDigest

data class CandidateImage(
    val uri: android.net.Uri,
    val displayName: String,
    val relativePath: String,
    val mediaIdHash: String,
)

class MediaStoreScanner(
    private val resolver: ContentResolver,
) {
    fun queryRecentImages(sinceSeconds: Long): List<CandidateImage> {
        val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val projection = buildList {
            add(MediaStore.Images.Media._ID)
            add(MediaStore.Images.Media.DISPLAY_NAME)
            add(MediaStore.Images.Media.RELATIVE_PATH)
            add(MediaStore.Images.Media.DATE_ADDED)
            if (Build.VERSION.SDK_INT >= 29) {
                add(MediaStore.Images.Media.IS_PENDING)
            }
        }.toTypedArray()
        val selection = if (Build.VERSION.SDK_INT >= 29) {
            "${MediaStore.Images.Media.DATE_ADDED} >= ? AND ${MediaStore.Images.Media.IS_PENDING} = 0"
        } else {
            "${MediaStore.Images.Media.DATE_ADDED} >= ?"
        }
        val args = arrayOf(sinceSeconds.toString())
        val sort = "${MediaStore.Images.Media.DATE_ADDED} DESC"

        val result = mutableListOf<CandidateImage>()
        resolver.query(collection, projection, selection, args, sort)?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val pathCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.RELATIVE_PATH)
            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val name = cursor.getString(nameCol).orEmpty()
                val relativePath = cursor.getString(pathCol).orEmpty()
                if (!isLikelyScreenshot(relativePath, name)) continue
                result += CandidateImage(
                    uri = ContentUris.withAppendedId(collection, id),
                    displayName = name,
                    relativePath = relativePath,
                    mediaIdHash = hashMediaId(id.toString()),
                )
            }
        }
        return result
    }

    companion object {
        fun isLikelyScreenshot(relativePath: String, displayName: String): Boolean {
            val path = relativePath.lowercase()
            val name = displayName.lowercase()
            val pathMatch = path.contains("screenshots") ||
                path.contains("screenshot") ||
                relativePath.contains("截图") ||
                relativePath.contains("截屏")
            val nameMatch = name.contains("screenshot") ||
                displayName.contains("截图") ||
                displayName.contains("截屏")
            return pathMatch || nameMatch
        }

        private fun hashMediaId(value: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}
