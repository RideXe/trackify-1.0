package org.trackify.client

import app.cash.sqldelight.db.SqlDriver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.updateAndGet
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import org.trackify.client.db.Database
import org.trackify.client.db.StateQueries

class StateStore internal constructor(
    private val queries: StateQueries,
    initialState: State,
) {
    private val _state = MutableStateFlow(initialState)
    val state: StateFlow<State> = _state.asStateFlow()

    suspend fun update(transform: (State) -> State) {
        val next = _state.updateAndGet(transform)
        withContext(Dispatchers.IO) {
            queries.saveState(Json.encodeToString(next))
        }
    }

    companion object {
        suspend fun create(driver: SqlDriver): StateStore = withContext(Dispatchers.IO) {
            val queries = Database(driver).stateQueries
            val initial = queries.selectState().executeAsOneOrNull()
                ?.let { Json.decodeFromString<State>(it) } ?: State()
            StateStore(queries, initial)
        }
    }
}
