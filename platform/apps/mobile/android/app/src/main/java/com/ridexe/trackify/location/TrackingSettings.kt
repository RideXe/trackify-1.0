package com.ridexe.trackify.location

import android.content.Context
import android.location.Location
import android.os.Build
import android.os.Bundle
import com.google.android.gms.location.Priority
import org.json.JSONObject

/**
 * What the user asked the tracker to do. Persisted so the service can resume after Android
 * restarts it, and so "is tracking on?" survives the app being closed.
 */
internal data class TrackingSettings(
    /** How often fixes are handed to JS as one window (filtered there, then uploaded). */
    val intervalMs: Long,
    val accuracy: String,
    val notificationTitle: String,
    val notificationBody: String,
) {
  val priority: Int
    get() = priorityFor(accuracy)

  /**
   * One fix per second lets the filter see a spike and the fix after it; "balanced" trades that
   * for battery.
   */
  val samplingMs: Long
    get() = if (accuracy == "balanced") 5_000L else 1_000L

  fun save(context: Context) {
    prefs(context)
        .edit()
        .putBoolean(KEY_ENABLED, true)
        .putLong(KEY_INTERVAL, intervalMs)
        .putString(KEY_ACCURACY, accuracy)
        .putString(KEY_TITLE, notificationTitle)
        .putString(KEY_BODY, notificationBody)
        .apply()
  }

  companion object {
    private const val PREFS = "trackify-location"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_INTERVAL = "intervalMs"
    private const val KEY_ACCURACY = "accuracy"
    private const val KEY_TITLE = "notificationTitle"
    private const val KEY_BODY = "notificationBody"

    fun load(context: Context): TrackingSettings? {
      val prefs = prefs(context)
      if (!prefs.getBoolean(KEY_ENABLED, false)) return null
      return TrackingSettings(
          intervalMs = prefs.getLong(KEY_INTERVAL, 30_000L),
          accuracy = prefs.getString(KEY_ACCURACY, null) ?: "high",
          notificationTitle = prefs.getString(KEY_TITLE, null) ?: "",
          notificationBody = prefs.getString(KEY_BODY, null) ?: "",
      )
    }

    fun clear(context: Context) {
      prefs(context).edit().clear().apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  }
}

/** "high" and "highest" both mean GPS-level accuracy on Android. */
internal fun priorityFor(accuracy: String): Int =
    if (accuracy == "balanced") Priority.PRIORITY_BALANCED_POWER_ACCURACY
    else Priority.PRIORITY_HIGH_ACCURACY

/** The shape JS reads as NativeLocation; fields the fix lacks are left out rather than zeroed. */
internal fun Location.toFixBundle(): Bundle =
    Bundle().apply {
      putDouble("latitude", latitude)
      putDouble("longitude", longitude)
      if (hasAltitude()) putDouble("altitude", altitude)
      if (hasSpeed()) putDouble("speed", speed.toDouble())
      if (hasBearing()) putDouble("heading", bearing.toDouble())
      if (hasAccuracy()) putDouble("accuracy", accuracy.toDouble())
      speedAccuracy()?.let { putDouble("speedAccuracy", it) }
      bearingAccuracy()?.let { putDouble("bearingAccuracy", it) }
      putDouble("elapsedMs", elapsedRealtimeNanos / 1_000_000.0)
      putBoolean("mock", isMockFix())
      provider?.let { putString("provider", it) }
      satellites()?.let { putInt("satellites", it) }
      putDouble("timestamp", time.toDouble())
    }

/**
 * Compact fix for a window (see RawFix in packages/geo/src/track-filter.ts). Includes what the
 * filter needs to judge quality: accuracy, Doppler speed and its accuracy, monotonic time, mock.
 */
internal fun Location.toFixJson(): JSONObject =
    JSONObject().apply {
      put("t", time)
      put("e", elapsedRealtimeNanos / 1_000_000L)
      put("lat", latitude)
      put("lon", longitude)
      if (hasAccuracy()) put("acc", accuracy.toDouble())
      if (hasSpeed()) put("spd", speed.toDouble())
      speedAccuracy()?.let { put("spdAcc", it) }
      if (hasBearing()) put("brg", bearing.toDouble())
      bearingAccuracy()?.let { put("brgAcc", it) }
      if (hasAltitude()) put("alt", altitude)
      provider?.let { put("provider", it) }
      if (isMockFix()) put("mock", true)
      satellites()?.let { put("sats", it) }
      // What the motion sensors say at this moment, when the permission allows it.
      ActivityState.current?.let { put("act", it) }
    }

private fun Location.speedAccuracy(): Double? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hasSpeedAccuracy())
        speedAccuracyMetersPerSecond.toDouble()
    else null

private fun Location.bearingAccuracy(): Double? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hasBearingAccuracy())
        bearingAccuracyDegrees.toDouble()
    else null

/** A location from a mock provider ("fake GPS" apps). */
@Suppress("DEPRECATION")
private fun Location.isMockFix(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else isFromMockProvider

/** Satellites used, when the provider reports it (GPS does; fused often does not). */
private fun Location.satellites(): Int? =
    extras?.getInt("satellites", -1)?.takeIf { it >= 0 }
