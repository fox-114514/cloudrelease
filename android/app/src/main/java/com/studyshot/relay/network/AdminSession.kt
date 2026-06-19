package com.studyshot.relay.network

data class AdminSession(
    val accessToken: String,
    val user: UserInfo,
)
