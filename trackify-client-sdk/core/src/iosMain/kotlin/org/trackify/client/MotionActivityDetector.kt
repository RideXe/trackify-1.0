package org.trackify.client

import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import platform.CoreMotion.CMMotionActivity
import platform.CoreMotion.CMMotionActivityManager
import platform.Foundation.NSOperationQueue

class MotionActivityDetector(
    private val scope: ComponentCoroutineScope,
    config: Config,
    state: StateFlow<State>,
) : SignalSource {

    private val stopTimeoutSeconds = config.location.stopTimeoutSeconds

    override val signals = MutableSharedFlow<Signal>(extraBufferCapacity = 8)

    private var activityManager: CMMotionActivityManager? = null
    private var stopTimeoutJob: Job? = null

    init {
        scope.observeState(state, { it.enabled }, inactive = false) { active ->
            if (active) ensureStarted() else ensureStopped()
        }
    }

    private fun ensureStarted() {
        if (activityManager != null) return
        if (!CMMotionActivityManager.isActivityAvailable()) {
            Log.log("Motion activity not available on this device")
            return
        }
        val manager = CMMotionActivityManager()
        activityManager = manager
        manager.startActivityUpdatesToQueue(NSOperationQueue.mainQueue) { motion ->
            if (motion == null) return@startActivityUpdatesToQueue
            Log.log("Motion update: ${motion.describe()}")
            when {
                motion.stationary -> onStillEnter()
                motion.walking || motion.running || motion.automotive || motion.cycling ->
                    onStillExit()
            }
        }
    }

    private fun ensureStopped() {
        stopTimeoutJob?.cancel()
        stopTimeoutJob = null
        activityManager?.stopActivityUpdates()
        activityManager = null
    }

    private fun onStillEnter() {
        if (stopTimeoutJob?.isActive == true) return
        Log.log("Stop detection: arming ${stopTimeoutSeconds}s timeout")
        stopTimeoutJob = scope.launch {
            delay(stopTimeoutSeconds.seconds)
            signals.emit(Signal.StationaryEnter)
        }
    }

    private fun onStillExit() {
        if (stopTimeoutJob?.isActive == true) Log.log("Stop detection: cancelled")
        stopTimeoutJob?.cancel()
        stopTimeoutJob = null
        scope.launch { signals.emit(Signal.StationaryExit) }
    }

    private fun CMMotionActivity.describe(): String {
        val types = buildList {
            if (stationary) add("stationary")
            if (walking) add("walking")
            if (running) add("running")
            if (automotive) add("automotive")
            if (cycling) add("cycling")
            if (unknown) add("unknown")
        }
        val label = if (types.isEmpty()) "none" else types.joinToString("/")
        return "$label/confidence=$confidence"
    }

}
