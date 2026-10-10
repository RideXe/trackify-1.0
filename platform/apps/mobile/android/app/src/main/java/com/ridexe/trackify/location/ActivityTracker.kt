package com.ridexe.trackify.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * What Android's motion sensors say the phone is doing: "still", "vehicle", "foot" or
 * "bicycle". Used as an extra signal next to GPS speed: parked positions stay steady even when
 * GPS speed is missing indoors, sampling slows while parked, and a phone that is walking during a
 * shift has left the vehicle. Needs the optional "Physical activity" permission; without it the
 * state stays unknown and tracking works from GPS speed alone.
 */
internal object ActivityState {
  @Volatile
  var current: String? = null
    private set

  /** Monotonic time of the last change, milliseconds. */
  @Volatile
  var since: Long = 0L
    private set

  fun update(activity: String, atElapsedMs: Long) {
    if (activity == current) return
    current = activity
    since = atElapsedMs
  }

  fun clear() {
    current = null
    since = 0L
  }

  /** How long the current activity has lasted. */
  fun durationMs(): Long = if (current == null) 0L else SystemClock.elapsedRealtime() - since
}

internal object ActivityTracker {
  private const val TAG = "TrackifyActivity"
  private val watched =
      listOf(
          DetectedActivity.IN_VEHICLE,
          DetectedActivity.ON_BICYCLE,
          DetectedActivity.WALKING,
          DetectedActivity.RUNNING,
          DetectedActivity.STILL,
      )

  fun permitted(context: Context): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
          ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) ==
              PackageManager.PERMISSION_GRANTED

  /** Starts listening for activity changes; does nothing without the permission. */
  @SuppressLint("MissingPermission") // Checked by permitted().
  fun start(context: Context) {
    if (!permitted(context)) {
      ActivityState.clear()
      return
    }
    val request =
        ActivityTransitionRequest(
            watched.map {
              ActivityTransition.Builder()
                  .setActivityType(it)
                  .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                  .build()
            }
        )
    ActivityRecognition.getClient(context)
        .requestActivityTransitionUpdates(request, pendingIntent(context))
        .addOnFailureListener { error -> Log.w(TAG, "Activity updates unavailable", error) }
  }

  @SuppressLint("MissingPermission")
  fun stop(context: Context) {
    ActivityState.clear()
    if (!permitted(context)) return
    ActivityRecognition.getClient(context).removeActivityTransitionUpdates(pendingIntent(context))
  }

  private fun pendingIntent(context: Context): PendingIntent {
    // Android 12+ requires a mutable intent here: the system adds the transition result to it.
    val flags =
        PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
    return PendingIntent.getBroadcast(
        context.applicationContext,
        0,
        Intent(context.applicationContext, ActivityTransitionReceiver::class.java),
        flags,
    )
  }

  fun nameOf(type: Int): String? =
      when (type) {
        DetectedActivity.IN_VEHICLE -> "vehicle"
        DetectedActivity.ON_BICYCLE -> "bicycle"
        DetectedActivity.WALKING,
        DetectedActivity.RUNNING -> "foot"
        DetectedActivity.STILL -> "still"
        else -> null
      }
}

/** Receives activity changes from Google Play services (declared in the manifest). */
class ActivityTransitionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityTransitionResult.hasResult(intent)) return
    val result = ActivityTransitionResult.extractResult(intent) ?: return
    for (event in result.transitionEvents) {
      if (event.transitionType != ActivityTransition.ACTIVITY_TRANSITION_ENTER) continue
      val name = ActivityTracker.nameOf(event.activityType) ?: continue
      ActivityState.update(name, event.elapsedRealTimeNanos / 1_000_000L)
    }
    TrackifyLocationService.onActivityChanged()
  }
}
