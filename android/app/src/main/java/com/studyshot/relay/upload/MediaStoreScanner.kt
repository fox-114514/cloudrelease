package com.studyshot.relay.upload

import android.content.ContentResolver
import android.content.ContentUris
import android.provider.DocumentsContract
import android.os.Build
import android.provider.MediaStore
import java.security.MessageDigest

data class CandidateImage(
    val uri: android.net.Uri,
    val displayName: String,
    val relativePath: String,
    val mediaIdHash: String,
    val sourceKind: String,
)

class MediaStoreScanner(
    private val resolver: ContentResolver,
) {
    fun queryRecentImages(
        sinceSeconds: Long,
        autoUploadScope: String,
        selectedAlbumPaths: List<String>,
    ): List<CandidateImage> {
        val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val projection = buildList {
            add(MediaStore.Images.Media._ID)
            add(MediaStore.Images.Media.DISPLAY_NAME)
            add(MediaStore.Images.Media.DATE_ADDED)
            add(MediaStore.Images.Media.MIME_TYPE)
            if (Build.VERSION.SDK_INT >= 29) {
                add(MediaStore.Images.Media.RELATIVE_PATH)
                add(MediaStore.Images.Media.IS_PENDING)
            } else {
                @Suppress("DEPRECATION")
                add(MediaStore.Images.Media.DATA)
            }
        }.toTypedArray()
        val selection = if (Build.VERSION.SDK_INT >= 29) {
            "${MediaStore.Images.Media.DATE_ADDED} >= ? AND ${MediaStore.Images.Media.IS_PENDING} = 0 AND ${MediaStore.Images.Media.MIME_TYPE} LIKE 'image/%'"
        } else {
            "${MediaStore.Images.Media.DATE_ADDED} >= ? AND ${MediaStore.Images.Media.MIME_TYPE} LIKE 'image/%'"
        }
        val args = arrayOf(sinceSeconds.toString())
        val sort = "${MediaStore.Images.Media.DATE_ADDED} DESC"

        val result = mutableListOf<CandidateImage>()
        resolver.query(collection, projection, selection, args, sort)?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val pathCol = if (Build.VERSION.SDK_INT >= 29) {
                cursor.getColumnIndexOrThrow(MediaStore.Images.Media.RELATIVE_PATH)
            } else {
                @Suppress("DEPRECATION")
                cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA)
            }
            val dateAddedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val name = cursor.getString(nameCol).orEmpty()
                val path = cursor.getString(pathCol).orEmpty()
                val dateAdded = cursor.getLong(dateAddedCol)
                val sourceKind = sourceKindFor(path, name, autoUploadScope, selectedAlbumPaths) ?: continue
                result += CandidateImage(
                    uri = ContentUris.withAppendedId(collection, id),
                    displayName = name,
                    relativePath = path,
                    mediaIdHash = hashMediaId("$id:$name:$dateAdded"),
                    sourceKind = sourceKind,
                )
            }
        }
        return result
    }

    fun resolveAlbumPath(uri: android.net.Uri): String? {
        val projection = buildList {
            if (Build.VERSION.SDK_INT >= 29) {
                add(MediaStore.Images.Media.RELATIVE_PATH)
            } else {
                @Suppress("DEPRECATION")
                add(MediaStore.Images.Media.DATA)
            }
        }.toTypedArray()

        resolver.query(uri, projection, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return null
            val rawPath = if (Build.VERSION.SDK_INT >= 29) {
                cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.RELATIVE_PATH))
            } else {
                @Suppress("DEPRECATION")
                cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA))
                    ?.substringBeforeLast('/', missingDelimiterValue = "")
            }
            return normalizeAlbumPath(rawPath)
        }
        return null
    }

    companion object {
        private val SCREENSHOT_PATH_KEYWORDS = listOf(
            "screenshots",
            "screenshot",
            "screen captures",
            "captures",
            "截图",
            "截屏",
            "screen_shots",
            "screen_shot",
        )

        private val SCREENSHOT_NAME_PREFIXES = listOf(
            "screenshot",
            "截屏",
            "截图",
            "screen_shot",
            "screen-shot",
            "screencapture",
            "screen_capture",
        )

        fun isLikelyScreenshot(path: String, displayName: String): Boolean {
            val pathLower = path.lowercase()
            val nameLower = displayName.lowercase()

            val pathMatch = SCREENSHOT_PATH_KEYWORDS.any { pathLower.contains(it) }
            val nameMatch = SCREENSHOT_NAME_PREFIXES.any { nameLower.startsWith(it) }

            return pathMatch || nameMatch
        }

        fun normalizeAlbumPath(path: String?): String? {
            val normalized = path
                ?.replace('\\', '/')
                ?.trim()
                ?.trim('/')
                ?.takeIf { it.isNotBlank() }
                ?: return null
            return normalized
        }

        fun albumPathFromTreeUri(uri: android.net.Uri): String? {
            val documentId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull()
                ?: return null
            val path = documentId.substringAfter(':', missingDelimiterValue = documentId)
            return normalizeAlbumPath(path)
        }

        private fun sourceKindFor(
            path: String,
            displayName: String,
            autoUploadScope: String,
            selectedAlbumPaths: List<String>,
        ): String? {
            return when (autoUploadScope) {
                "screenshot_only" -> if (isLikelyScreenshot(path, displayName)) "screenshot" else null
                "selected_album" -> if (matchesSelectedAlbum(path, selectedAlbumPaths)) "selected_album" else null
                else -> null
            }
        }

        private fun matchesSelectedAlbum(path: String, selectedAlbumPaths: List<String>): Boolean {
            val normalizedCandidate = normalizeAlbumPath(path)?.lowercase() ?: return false
            return selectedAlbumPaths.any { selected ->
                val normalizedSelected = normalizeAlbumPath(selected)?.lowercase() ?: return@any false
                normalizedCandidate == normalizedSelected || normalizedCandidate.startsWith("$normalizedSelected/")
            }
        }

        private fun hashMediaId(value: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}
