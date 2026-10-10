package com.ridexe.trackify.location

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.os.BatteryManager
import android.os.PowerManager
import android.provider.Settings
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

  override fun setInterval(intervalMs: Double, promise: Promise) {
    TrackifyLocationService.reconfigure(reactApplicationContext, intervalMs.toLong())
    promise.resolve(null)
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
        // Kept: still meant to be on. The app shows "tracking stopped" and tries again.
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
    ActivityState.current?.let {
      health.putString("activity", it)
      health.putDouble("activityForMs", ActivityState.durationMs().toDouble())
    }
    promise.resolve(health)
  }

  /**
   * Whether Android may stop the app in the background to save battery. Many phones (Xiaomi,
   * Oppo, Vivo, Realme) stop tracking during a shift unless Trackify is excluded.
   */
  override fun isBatteryOptimized(promise: Promise) {
    val power = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    promise.resolve(!power.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
  }

  /**
   * Opens Android's battery optimisation list, where the driver picks "Don't optimise" for
   * Trackify. Needs no permission, unlike asking for the exemption directly.
   */
  override fun openBatterySettings(promise: Promise) {
    val intents =
        listOf(
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.fromParts("package", reactApplicationContext.packageName, null),
            ),
        )
    for (intent in intents) {
      try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
        promise.resolve(null)
        return
      } catch (error: Exception) {
        // Some phones lack the first screen; try the app's own settings page.
      }
    }
    promise.reject("E_SETTINGS", "Battery settings unavailable")
  }

  companion object {
    const val NAME = "TrackifyLocation"
  }
}
