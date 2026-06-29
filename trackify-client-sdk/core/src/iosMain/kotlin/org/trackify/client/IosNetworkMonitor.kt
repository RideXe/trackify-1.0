@file:OptIn(ExperimentalForeignApi::class)

package org.trackify.client

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.flow.MutableStateFlow
import platform.Network.nw_path_get_status
import platform.Network.nw_path_monitor_create
import platform.Network.nw_path_monitor_set_queue
import platform.Network.nw_path_monitor_set_update_handler
import platform.Network.nw_path_monitor_start
import platform.Network.nw_path_status_satisfied
import platform.darwin.dispatch_queue_create

class IosNetworkMonitor : NetworkMonitor {

    override val isOnline = MutableStateFlow(false)

    private val monitor = nw_path_monitor_create()

    init {
        nw_path_monitor_set_update_handler(monitor) { path ->
            val online = path != null && nw_path_get_status(path) == nw_path_status_satisfied
            if (isOnline.value != online) Log.log("Network ${if (online) "online" else "offline"}")
            isOnline.value = online
        }
        nw_path_monitor_set_queue(monitor, dispatch_queue_create("org.trackify.networkmonitor", null))
        nw_path_monitor_start(monitor)
    }
}
