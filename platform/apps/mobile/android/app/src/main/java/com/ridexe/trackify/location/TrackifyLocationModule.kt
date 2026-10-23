package com.ridexe.trackify.location

import android.annotation.SuppressLint

import android.content.ComponentName
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
    health.putBoolean("batteryOptimized", batteryOptimized())
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
    promise.resolve(batteryOptimized())
  }

  private fun batteryOptimized(): Boolean {
    val power = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    return !power.isIgnoringBatteryOptimizations(reactApplicationContext.packageName)
  }

  /**
   * Shows Android's own "Let Trackify always run in the background? Allow / Deny" question: one tap
   * instead of finding Trackify in a settings list. Resolves once the question is shown; the app
   * checks the answer with isBatteryOptimized when it comes back to the front.
   */
  @SuppressLint("BatteryLife") // Continuous vehicle tracking is the app's purpose.
  override fun requestBatteryExemption(promise: Promise) {
    if (!batteryOptimized()) return promise.resolve(false)
    try {
      val intent =
          Intent(
                  Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                  android.net.Uri.fromParts("package", reactApplicationContext.packageName, null),
              )
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      // Some phones remove the question; fall back to the settings list.
      openBatterySettings(promise)
    }
  }

  /** The phone maker's own background-start screen, when this phone has one. */
  private fun vendorScreen(): Pair<String, Intent>? {
    val manager = reactApplicationContext.packageManager
    for ((brand, component) in VENDOR_SCREENS) {
      val intent =
          Intent().setComponent(ComponentName(component.first, component.second))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (intent.resolveActivity(manager) != null) return brand to intent
    }
    return null
  }

  /** "Xiaomi", "Oppo", … when the phone has its own auto-start switch; null otherwise. */
  override fun vendorPowerScreen(promise: Promise) {
    promise.resolve(vendorScreen()?.first)
  }

  override fun openVendorPowerScreen(promise: Promise) {
    val screen = vendorScreen() ?: return promise.reject("E_SETTINGS", "No maker screen")
    try {
      reactApplicationContext.startActivity(screen.second)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_SETTINGS", "Maker screen unavailable", error)
    }
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

    /**
     * Phone makers that add their own auto-start or background switch on top of Android's battery
     * setting; without it they close tracking apps anyway. Listed in the manifest's <queries>.
     */
    private val VENDOR_SCREENS =
        listOf(
            "Xiaomi" to
                ("com.miui.securitycenter" to
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            "Oppo" to
                ("com.coloros.safecenter" to
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            "Oppo" to
                ("com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity"),
            "Oppo" to
                ("com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity"),
            "Vivo" to
                ("com.vivo.permissionmanager" to
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            "Vivo" to
                ("com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
            "Huawei" to
                ("com.huawei.systemmanager" to
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            "Huawei" to
                ("com.huawei.systemmanager" to
                    "com.huawei.systemmanager.optimize.process.ProtectActivity"),
            "Samsung" to
                ("com.samsung.android.lool" to
                    "com.samsung.android.sm.battery.ui.BatteryActivity"),
            "OnePlus" to
                ("com.oneplus.security" to
                    "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
        )
  }
}
