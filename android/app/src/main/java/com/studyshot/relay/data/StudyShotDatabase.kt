package com.studyshot.relay.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        UploadTaskEntity::class,
        DownloadRecordEntity::class,
        UploadedHashEntity::class,
        ReceivedHashEntity::class,
        EventLogEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class StudyShotDatabase : RoomDatabase() {
    abstract fun dao(): StudyShotDao

    companion object {
        @Volatile
        private var instance: StudyShotDatabase? = null

        fun get(context: Context): StudyShotDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    StudyShotDatabase::class.java,
                    "studyshot.db",
                ).build().also { instance = it }
            }
        }
    }
}

