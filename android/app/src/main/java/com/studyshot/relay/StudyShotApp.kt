package com.studyshot.relay

import android.app.Application
import com.studyshot.relay.data.SecureSettings
import com.studyshot.relay.data.StudyShotDatabase
import com.studyshot.relay.network.StudyShotApiClient
import com.studyshot.relay.upload.UploadRepository

class StudyShotApp : Application() {
    val database: StudyShotDatabase by lazy { StudyShotDatabase.get(this) }
    val secureSettings: SecureSettings by lazy { SecureSettings(this) }
    val apiClient: StudyShotApiClient by lazy { StudyShotApiClient() }
    val uploadRepository: UploadRepository by lazy { UploadRepository(this, database) }
}

