package com.ridexe.trackify.location

import android.content.Context
import android.content.Intent
import android.location.Location
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import org.json.JSONArray

/**
 * Runs the JS task registered in index.js for each window of location fixes, starting React
 * Native first if the app UI is closed. Filtering, the upload queue and retries stay in JS
 * (src/tasks/location-task.ts).
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

    /**
     * The window goes as a JSON string: one extra instead of hundreds of nested bundles, and the
     * exact shape JS parses. `final` marks the last window of a session (shift ended, stopped).
     */
    fun deliverWindow(context: Context, fixes: List<Location>, final: Boolean) {
      val json = JSONArray()
      for (location in fixes) json.put(location.toFixJson())
      acquireWakeLockNow(context)
      context.startService(
          Intent(context, TrackifyLocationTaskService::class.java)
              .putExtra("fixes", json.toString())
              .putExtra("final", final)
      )
    }
  }
}
