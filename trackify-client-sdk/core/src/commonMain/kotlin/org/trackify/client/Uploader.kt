package org.trackify.client

interface Uploader {
    suspend fun upload(position: Position): Boolean
}
