package org.trackify.client

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

@SuppressLint("MissingPermission")
class ActivityRecognitionDetector(
    private val scope: ComponentCoroutineScope,
    context: Context,
    config: Config,
    state: StateFlow<State>,
) : SignalSource {

    private val stopTimeoutSeconds = config.location.stopTimeoutSeconds

    private val appContext = context.applicationContext
    private val client = ActivityRecognition.getClient(appContext)

    override val signals = MutableSharedFlow<Signal>(extraBufferCapacity = 8)

    private var pendingIntent: PendingIntent? = null
    private var stopTimeoutJob: Job? = null

    init {
        scope.launch {
            ActivityRecognitionReceiver.events.collect { handleResult(it) }
        }
        scope.observeState(state, { it.enabled }, inactive = false) { active ->
            if (active) ensureRegistered() else ensureUnregistered()
        }
    }

    private fun ensureRegistered() {
        if (pendingIntent != null) return
        val newPendingIntent = PendingIntent.getBroadcast(
            appContext,
            0,
            Intent(appContext, ActivityRecognitionReceiver::class.java),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        pendingIntent = newPendingIntent

        val request = ActivityTransitionRequest(
            listOf(DetectedActivity.STILL, DetectedActivity.IN_VEHICLE, DetectedActivity.ON_BICYCLE, DetectedActivity.RUNNING, DetectedActivity.WALKING).flatMap { activity ->
                listOf(ActivityTransition.ACTIVITY_TRANSITION_ENTER, ActivityTransition.ACTIVITY_TRANSITION_EXIT).map { transition ->
                    ActivityTransition.Builder().setActivityType(activity).setActivityTransition(transition).build()
                }
            }
        )
        client.requestActivityTransitionUpdates(request, newPendingIntent)
            .addOnSuccessListener { Log.log("Activity transitions registered") }
            .addOnFailureListener { Log.log("Activity transitions failed: $it") }
    }

    private fun ensureUnregistered() {
        stopTimeoutJob?.cancel()
        stopTimeoutJob = null
        pendingIntent?.let {
            client.removeActivityTransitionUpdates(it)
            Log.log("Activity transitions removed")
        }
        pendingIntent = null
    }

    private fun handleResult(intent: Intent) {
        val result = ActivityTransitionResult.extractResult(intent) ?: return
        result.transitionEvents.forEach { event ->
            Log.log("Activity transition: ${activityName(event.activityType)} ${transitionName(event.transitionType)}")
            if (event.activityType != DetectedActivity.STILL) return@forEach
            if (event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER) onStillEnter()
            else onStillExit()
        }
    }

    private fun activityName(type: Int): String = when (type) {
        DetectedActivity.STILL -> "still"
        DetectedActivity.IN_VEHICLE -> "in_vehicle"
        DetectedActivity.ON_BICYCLE -> "on_bicycle"
        DetectedActivity.RUNNING -> "running"
        DetectedActivity.WALKING -> "walking"
        else -> "unknown"
    }

    private fun transitionName(type: Int): String = when (type) {
        ActivityTransition.ACTIVITY_TRANSITION_ENTER -> "enter"
        ActivityTransition.ACTIVITY_TRANSITION_EXIT -> "exit"
        else -> "unknown"
    }

    private fun onStillEnter() {
        stopTimeoutJob?.cancel()
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
}

class ActivityRecognitionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.log("Activity recognition broadcast received")
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                sharedTracker()
                events.tryEmit(intent)
            } finally {
                pending.finish()
            }
        }
    }

    internal companion object {
        val events = MutableSharedFlow<Intent>(replay = 1, extraBufferCapacity = 8)
    }
}
