package org.trackify.client

import app.cash.sqldelight.db.SqlDriver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import org.trackify.client.db.Database

class ConfigStore(driver: SqlDriver) {

    private val queries = Database(driver).configQueries

    suspend fun save(config: Config) = withContext(Dispatchers.IO) {
        queries.saveConfig(Json.encodeToString(config))
    }

    suspend fun load(): Config? = withContext(Dispatchers.IO) {
        queries.selectConfig().executeAsOneOrNull()?.let { Json.decodeFromString(it) }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        queries.clearConfig()
    }
}
