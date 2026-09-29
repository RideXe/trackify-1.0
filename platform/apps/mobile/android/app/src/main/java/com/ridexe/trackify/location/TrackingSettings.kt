package com.ridexe.trackify.location

import android.content.Context
import android.location.Location
import android.os.Bundle
import com.google.android.gms.location.Priority

/**
 * What the user asked the tracker to do. Persisted so the service can resume after Android
 * restarts it, and so "is tracking on?" survives the app being closed.
 */
internal data class TrackingSettings(
    val intervalMs: Long,
    val accuracy: String,
    val notificationTitle: String,
    val notificationBody: String,
) {
  val priority: Int
    get() = priorityFor(accuracy)

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
      putDouble("timestamp", time.toDouble())
    }
