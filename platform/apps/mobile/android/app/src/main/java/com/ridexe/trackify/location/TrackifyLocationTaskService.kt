package com.ridexe.trackify.location

import android.content.Context
import android.content.Intent
import android.location.Location
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the JS task registered in index.js for each location fix, starting React Native first if
 * the app UI is closed. The upload queue and retry logic stay in JS (src/services/upload.ts).
 */
class TrackifyLocationTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val fix = intent?.extras ?: return null
    return HeadlessJsTaskConfig(
        TASK_KEY,
        Arguments.fromBundle(fix),
        TASK_TIMEOUT_MS,
        true, // also run while the app is open, so there is one delivery path
    )
  }

  companion object {
    /** Must match LOCATION_TASK in src/tasks/location-task.ts. */
    const val TASK_KEY = "TrackifyLocation"
    // Each upload attempt aborts after 15 s; this only bounds a drained offline backlog.
    private const val TASK_TIMEOUT_MS = 5 * 60_000L

    fun deliver(context: Context, location: Location) {
      acquireWakeLockNow(context)
      context.startService(
          Intent(context, TrackifyLocationTaskService::class.java).putExtras(location.toFixBundle())
      )
    }
  }
}
