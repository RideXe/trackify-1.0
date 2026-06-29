package org.trackify.client

import kotlin.concurrent.Volatile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

internal object Log {

    @Volatile
    var store: LogStore? = null

    @Volatile
    var retention: Int = 5000

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun log(message: String) {
        scope.launch {
            val target = store ?: return@launch
            target.insert(message)
            target.trim(retention)
        }
    }
}
