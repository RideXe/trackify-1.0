package org.trackify.client

import kotlin.time.Duration.Companion.seconds
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus
import kotlinx.coroutines.withTimeoutOrNull
import platform.CoreLocation.CLCircularRegion
import platform.CoreLocation.CLLocationCoordinate2DMake
import platform.CoreLocation.CLLocationManager
import platform.CoreLocation.CLLocationManagerDelegateProtocol
import platform.CoreLocation.CLRegion
import platform.CoreLocation.kCLAuthorizationStatusAuthorizedAlways
import platform.Foundation.NSError
import platform.darwin.NSObject

class RegionDetector(
    private val scope: ComponentCoroutineScope,
    config: Config,
    private val state: StateFlow<State>,
    private val incomingPositions: Flow<Position>,
) : SignalSource {

    private val radius = config.location.stationaryRadiusMeters
    private val mainScope = scope + Dispatchers.Main

    override val signals = MutableSharedFlow<Signal>(extraBufferCapacity = 8)

    private var manager: CLLocationManager? = null
    private var delegate: CLLocationManagerDelegateProtocol? = null

    init {
        mainScope.observeState(state, { it.enabled && it.paused }, inactive = false) { active ->
            if (active) tryRegister() else unregister()
        }
    }

    private suspend fun tryRegister() {
        if (manager != null) return
        val anchor = waitForAnchor() ?: run {
            Log.log("Region: no anchor available")
            return
        }
        if (anchor.latitude == null || anchor.longitude == null) return
        register(anchor.latitude, anchor.longitude, radius)
    }

    private suspend fun waitForAnchor(): Position? {
        val fresh = withTimeoutOrNull(WAIT_TIMEOUT) { incomingPositions.first() }
        return fresh ?: state.value.lastAcceptedLocation
    }

    @OptIn(ExperimentalForeignApi::class)
    private fun register(latitude: Double, longitude: Double, radius: Int) {
        val newDelegate = object : NSObject(), CLLocationManagerDelegateProtocol {
            override fun locationManager(manager: CLLocationManager, didExitRegion: CLRegion) {
                if (didExitRegion.identifier == REGION_ID) {
                    Log.log("Region exit")
                    scope.launch { signals.emit(Signal.StationaryExit) }
                }
            }
            override fun locationManager(manager: CLLocationManager, didFailWithError: NSError) {}
        }
        delegate = newDelegate

        val newManager = CLLocationManager().apply {
            this.delegate = newDelegate
            allowsBackgroundLocationUpdates = true
        }

        if (newManager.authorizationStatus != kCLAuthorizationStatusAuthorizedAlways) {
            Log.log("Region monitoring requires Always authorization")
            newManager.delegate = null
            delegate = null
            return
        }

        val region = CLCircularRegion(
            center = CLLocationCoordinate2DMake(latitude, longitude),
            radius = radius.toDouble(),
            identifier = REGION_ID,
        )
        region.notifyOnExit = true
        region.notifyOnEntry = false
        newManager.startMonitoringForRegion(region)
        Log.log("Region monitoring registered")
        manager = newManager
    }

    private fun unregister() {
        manager?.let { current ->
            current.monitoredRegions.forEach { region ->
                (region as? CLRegion)?.let { current.stopMonitoringForRegion(it) }
            }
            current.delegate = null
            Log.log("Region monitoring removed")
        }
        manager = null
        delegate = null
    }

    private companion object {
        const val REGION_ID = "trackify.stationary"
        val WAIT_TIMEOUT = 10.seconds
    }
}
