package org.trackify.client

import android.annotation.SuppressLint
import android.content.Context
import android.os.PowerManager
import androidx.core.content.getSystemService
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow

class WakeLockHolder(
    scope: ComponentCoroutineScope,
    context: Context,
    state: StateFlow<State>,
) : SignalSource {

    override val signals: Flow<Signal> = emptyFlow()

    private val powerManager: PowerManager? = context.applicationContext.getSystemService()
    private var wakeLock: PowerManager.WakeLock? = null

    init {
        scope.observeState(state, { it.enabled && !it.paused }, inactive = false) { active ->
            if (active) acquire() else release()
        }
    }

    @SuppressLint("WakelockTimeout")
    private fun acquire() {
        if (wakeLock != null) return
        wakeLock = powerManager
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "trackify:tracker")
            ?.also {
                it.acquire()
                Log.log("Wakelock acquired")
            }
    }

    private fun release() {
        wakeLock?.release() ?: return
        wakeLock = null
        Log.log("Wakelock released")
    }
}
