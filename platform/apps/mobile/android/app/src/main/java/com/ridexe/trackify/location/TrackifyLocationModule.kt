package com.ridexe.trackify.location

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.os.BatteryManager
import androidx.core.location.LocationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.CancellationTokenSource

/** JS entry point; see src/native/NativeTrackifyLocation.ts for the contract. */
@ReactModule(name = TrackifyLocationModule.NAME)
class TrackifyLocationModule(context: ReactApplicationContext) :
    NativeTrackifyLocationSpec(context) {

  override fun getName(): String = NAME

  override fun start(options: ReadableMap, promise: Promise) {
    val settings =
        TrackingSettings(
            intervalMs = options.getDouble("intervalMs").toLong(),
            accuracy = options.getString("accuracy") ?: "high",
            notificationTitle = options.getString("notificationTitle") ?: "",
            notificationBody = options.getString("notificationBody") ?: "",
        )
    try {
      TrackifyLocationService.start(reactApplicationContext, settings)
      promise.resolve(null)
    } catch (error: Exception) {
      TrackingSettings.clear(reactApplicationContext)
      promise.reject("E_TRACKING_START", "Unable to start location sharing", error)
    }
  }

  override fun stop(promise: Promise) {
    TrackifyLocationService.stop(reactApplicationContext)
    promise.resolve(null)
  }

  override fun isRunning(promise: Promise) {
    val settings = TrackingSettings.load(reactApplicationContext)
    // If tracking was left on but Android has since killed the service, bring it back now that
    // the app is open.
    if (settings != null && !TrackifyLocationService.isRunning) {
      try {
        TrackifyLocationService.start(reactApplicationContext, settings)
      } catch (error: Exception) {
        TrackingSettings.clear(reactApplicationContext)
        promise.resolve(false)
        return
      }
    }
    promise.resolve(settings != null)
  }

  @SuppressLint("MissingPermission") // JS requests location permission before calling this.
  override fun getCurrentPosition(accuracy: String, promise: Promise) {
    try {
      LocationServices.getFusedLocationProviderClient(reactApplicationContext)
          .getCurrentLocation(priorityFor(accuracy), CancellationTokenSource().token)
          .addOnSuccessListener { location ->
            if (location == null)
                promise.reject(
                    "E_LOCATION_UNAVAILABLE",
                    "Current location is unavailable. Make sure location is turned on.",
                )
            else promise.resolve(Arguments.fromBundle(location.toFixBundle()))
          }
          .addOnFailureListener { error ->
            promise.reject("E_LOCATION_UNAVAILABLE", "Current location is unavailable", error)
          }
    } catch (error: SecurityException) {
      promise.reject("E_LOCATION_PERMISSION", "Location permission is required", error)
    }
  }

  override fun deviceHealth(promise: Promise) {
    // A sticky broadcast: registering with a null receiver just reads the latest battery state.
    val battery =
        reactApplicationContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val locationManager =
        reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val health = Arguments.createMap()
    if (level >= 0 && scale > 0) health.putDouble("batteryPct", level * 100.0 / scale)
    health.putBoolean(
        "charging",
        status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL,
    )
    health.putBoolean("locationEnabled", LocationManagerCompat.isLocationEnabled(locationManager))
    promise.resolve(health)
  }

  companion object {
    const val NAME = "TrackifyLocation"
  }
}
