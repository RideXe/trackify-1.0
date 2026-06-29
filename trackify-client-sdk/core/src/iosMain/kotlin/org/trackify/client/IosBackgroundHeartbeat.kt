package org.trackify.client

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import platform.BackgroundTasks.BGAppRefreshTask
import platform.BackgroundTasks.BGAppRefreshTaskRequest
import platform.BackgroundTasks.BGTaskScheduler
import platform.Foundation.NSDate
import platform.Foundation.dateByAddingTimeInterval

class IosBackgroundHeartbeat(
    scope: ComponentCoroutineScope,
    config: Config,
    state: StateFlow<State>,
) : SignalSource {

    private val intervalSeconds = config.location.heartbeatIntervalSeconds
    override val signals = MutableSharedFlow<Signal>(replay = 1, extraBufferCapacity = 8)

    init {
        instance = this
        scope.observeState(state, { it.enabled && it.paused }, inactive = false) { active ->
            if (active) scheduleNext(intervalSeconds) else cancelScheduled()
        }
    }

    companion object {
        private const val TASK_IDENTIFIER = "org.trackify.client.heartbeat"

        private var registered = false
        private var instance: IosBackgroundHeartbeat? = null

        fun register() {
            if (registered) return
            BGTaskScheduler.sharedScheduler.registerForTaskWithIdentifier(
                identifier = TASK_IDENTIFIER,
                usingQueue = null,
            ) { task -> handleTask(task as BGAppRefreshTask) }
            registered = true
        }

        @OptIn(ExperimentalForeignApi::class)
        private fun scheduleNext(intervalSeconds: Int) {
            if (intervalSeconds <= 0) return
            val request = BGAppRefreshTaskRequest(identifier = TASK_IDENTIFIER)
            request.earliestBeginDate = NSDate().dateByAddingTimeInterval(intervalSeconds.toDouble())
            BGTaskScheduler.sharedScheduler.submitTaskRequest(request, null)
            Log.log("Heartbeat scheduled in ${intervalSeconds}s")
        }

        private fun cancelScheduled() {
            BGTaskScheduler.sharedScheduler.cancelTaskRequestWithIdentifier(TASK_IDENTIFIER)
            Log.log("Heartbeat task cancelled")
        }

        private fun handleTask(task: BGAppRefreshTask) {
            Log.log("Heartbeat task fired")
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            task.setExpirationHandler {
                scope.cancel()
                task.setTaskCompletedWithSuccess(false)
            }
            scope.launch {
                val tracker = sharedTracker() ?: run {
                    task.setTaskCompletedWithSuccess(false)
                    return@launch
                }
                scheduleNext(tracker.config.location.heartbeatIntervalSeconds)
                instance?.signals?.tryEmit(Signal.HeartbeatTick)
                task.setTaskCompletedWithSuccess(true)
            }
        }
    }
}
