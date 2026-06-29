package org.trackify.client

import app.cash.sqldelight.db.SqlDriver
import kotlin.time.Clock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.withContext
import org.trackify.client.db.Database

class LogStore(driver: SqlDriver) {

    private val queries = Database(driver).logEntryQueries

    suspend fun insert(message: String) = withContext(Dispatchers.IO) {
        queries.insert(time = Clock.System.now().toEpochMilliseconds(), message = message)
    }

    suspend fun all(): List<LogEntry> = withContext(Dispatchers.IO) {
        queries.selectAll().executeAsList().map {
            LogEntry(time = it.time, message = it.message)
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        queries.clear()
    }

    suspend fun trim(keep: Int) = withContext(Dispatchers.IO) {
        queries.trim(keep.toLong())
    }
}
