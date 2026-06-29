package org.trackify.client

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.CancellationSignal
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.core.location.LocationManagerCompat
import kotlin.coroutines.resume
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

@SuppressLint("MissingPermission")
class AndroidLocationSource(
    scope: ComponentCoroutineScope,
    context: Context,
    config: Config,
    state: StateFlow<State>,
) : LocationSource {

    private val locationConfig = config.location.effective
    private val appContext = context.applicationContext
    private val locationManager: LocationManager = checkNotNull(appContext.getSystemService())

    override val positions = MutableSharedFlow<Position>(extraBufferCapacity = 8)

    private var listener: LocationListener? = null
    private var currentLocationCancellation: CancellationSignal? = null

    init {
        scope.observeState(state, State::locationMode, inactive = LocationMode.Off) { mode ->
            when (mode) {
                LocationMode.Active -> ensureStarted()
                LocationMode.Stationary -> ensureStopped(awaitFinalFix = true)
                LocationMode.Off -> ensureStopped(awaitFinalFix = false)
            }
        }
    }

    private fun ensureStarted() {
        if (listener != null) return
        startUpdates()
    }

    private suspend fun ensureStopped(awaitFinalFix: Boolean) {
        if (listener == null) return
        if (awaitFinalFix) {
            val finalFix = awaitCurrentLocation()
            finalFix?.let { positions.emit(it.toPosition()) }
        }
        stopUpdates()
    }

    override suspend fun fetchOnce(): Position? {
        val fresh = withTimeoutOrNull(LOCATION_FETCH_TIMEOUT) { awaitCurrentLocation() }
        return (fresh ?: locationManager.getLastKnownLocation(locationConfig.accuracy.toAndroidProvider()))
            ?.toPosition()
    }

    private fun startUpdates() {
        val newListener = LocationListener { location ->
            positions.tryEmit(location.toPosition())
        }
        locationManager.requestLocationUpdates(
            locationConfig.accuracy.toAndroidProvider(),
            locationConfig.intervalSeconds * 1000L,
            locationConfig.distanceMeters.toFloat(),
            newListener,
            Looper.getMainLooper(),
        )
        listener = newListener
        Log.log("Location updates started")
    }

    private fun stopUpdates() {
        listener?.let {
            locationManager.removeUpdates(it)
            Log.log("Location updates stopped")
        }
        listener = null
    }

    private suspend fun awaitCurrentLocation(): Location? {
        currentLocationCancellation?.cancel()
        val signal = CancellationSignal()
        currentLocationCancellation = signal
        return try {
            suspendCancellableCoroutine { continuation ->
                LocationManagerCompat.getCurrentLocation(
                    locationManager,
                    locationConfig.accuracy.toAndroidProvider(),
                    signal,
                    ContextCompat.getMainExecutor(appContext),
                ) { location ->
                    if (continuation.isActive) continuation.resume(location)
                }
                continuation.invokeOnCancellation { signal.cancel() }
            }
        } finally {
            if (currentLocationCancellation === signal) currentLocationCancellation = null
        }
    }

    private fun Location.toPosition(): Position = Position(
        latitude = latitude,
        longitude = longitude,
        accuracy = accuracy.toDouble(),
        time = time,
        altitude = if (hasAltitude()) altitude else null,
        speed = if (hasSpeed()) speed.toDouble() else null,
        bearing = if (hasBearing()) bearing.toDouble() else null,
    )
}

private fun Accuracy.toAndroidProvider(): String = when (this) {
    Accuracy.HIGHEST, Accuracy.HIGH -> LocationManager.GPS_PROVIDER
    Accuracy.MEDIUM -> LocationManager.NETWORK_PROVIDER
    Accuracy.LOW -> LocationManager.PASSIVE_PROVIDER
}
