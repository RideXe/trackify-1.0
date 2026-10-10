package com.ridexe.trackify.location

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.annotation.SuppressLint
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.ridexe.trackify.R

/**
 * Foreground service that samples location (once a second by default) while the app is in the
 * background. Fixes are collected here and handed to JS as one window per interval through
 * [TrackifyLocationTaskService], where they are filtered and uploaded: JS wakes once per window,
 * not once per fix.
 */
class TrackifyLocationService : Service() {
  private lateinit var client: FusedLocationProviderClient
  private val window = ArrayList<Location>()
  private var windowStart = 0L
  private var windowMs = 30_000L

  private val callback =
      object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
          // Android may batch many fixes into one result (setMaxUpdateDelayMillis).
          synchronized(window) {
            window.addAll(result.locations)
            // A runaway buffer (JS not draining) must not grow without bound.
            while (window.size > MAX_WINDOW_FIXES) window.removeAt(0)
            if (SystemClock.elapsedRealtime() - windowStart >= windowMs) flush(final = false)
          }
        }
      }

  /** Hands the collected fixes to JS. Call with [window] locked. */
  private fun flush(final: Boolean) {
    windowStart = SystemClock.elapsedRealtime()
    if (window.isEmpty() && !final) return
    TrackifyLocationTaskService.deliverWindow(applicationContext, ArrayList(window), final)
    window.clear()
  }

  override fun onCreate() {
    super.onCreate()
    client = LocationServices.getFusedLocationProviderClient(this)
    instance = this
  }

  private var settings: TrackingSettings? = null
  /** Sampling slowed because the phone has been still for a while. */
  private var parked = false
  private val handler by lazy { Handler(Looper.getMainLooper()) }
  private val parkCheck = Runnable { updateSampling() }

  /** (Re)requests updates for these settings; the window length is the sync interval. */
  internal fun applySettings(settings: TrackingSettings) {
    this.settings = settings
    synchronized(window) {
      windowMs = settings.intervalMs
      windowStart = SystemClock.elapsedRealtime()
    }
    requestUpdates(settings, if (parked) PARKED_SAMPLING_MS else settings.samplingMs)
    ActivityTracker.start(this)
  }

  /**
   * After [PARKED_AFTER_MS] of "still" from the motion sensors, sample every 10 s to save
   * battery; back to every second as soon as the phone moves.
   */
  private fun updateSampling() {
    val settings = settings ?: return
    val shouldPark =
        ActivityState.current == "still" && ActivityState.durationMs() >= PARKED_AFTER_MS
    if (shouldPark == parked) return
    parked = shouldPark
    requestUpdates(settings, if (parked) PARKED_SAMPLING_MS else settings.samplingMs)
  }

  internal fun onActivity() {
    handler.removeCallbacks(parkCheck)
    if (ActivityState.current == "still") handler.postDelayed(parkCheck, PARKED_AFTER_MS)
    updateSampling()
  }

  @SuppressLint("MissingPermission") // Callers run only after location permission was granted.
  private fun requestUpdates(settings: TrackingSettings, samplingMs: Long) {
    client.removeLocationUpdates(callback)
    client.requestLocationUpdates(
        LocationRequest.Builder(settings.priority, samplingMs)
            .setMinUpdateIntervalMillis(samplingMs)
            // Let Android deliver the window's fixes together, waking the phone once.
            .setMaxUpdateDelayMillis(settings.intervalMs)
            // Skip the first coarse fixes after start if an accurate one is about to arrive.
            .setWaitForAccurateLocation(true)
            // Distance 0 keeps parked vehicles reporting.
            .setMinUpdateDistanceMeters(0f)
            .build(),
        callback,
        Looper.getMainLooper(),
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A null intent means Android restarted us after killing the process; settings say whether
    // tracking is still meant to be on.
    val settings = TrackingSettings.load(this)
    if (settings == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      ServiceCompat.startForeground(
          this,
          NOTIFICATION_ID,
          notification(settings),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
      )
      applySettings(settings)
    } catch (error: Exception) {
      // Permission revoked, or Android refused a foreground start from the background.
      Log.w(TAG, "Location sharing could not start", error)
      TrackingSettings.clear(this)
      stopSelf()
      return START_NOT_STICKY
    }
    isRunning = true
    return START_STICKY
  }

  override fun onDestroy() {
    client.removeLocationUpdates(callback)
    handler.removeCallbacks(parkCheck)
    ActivityTracker.stop(this)
    // Deliver what was collected so the end of a shift is not lost.
    synchronized(window) { flush(final = true) }
    if (instance === this) instance = null
    isRunning = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun notification(settings: TrackingSettings): Notification {
    NotificationManagerCompat.from(this)
        .createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName(getString(R.string.tracking_channel_name))
                .build()
        )
    val openApp =
        packageManager.getLaunchIntentForPackage(packageName)?.let {
          PendingIntent.getActivity(
              this,
              0,
              it,
              PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
          )
        }
    return NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_tracking)
        .setColor(ContextCompat.getColor(this, R.color.tracking_accent))
        .setContentTitle(settings.notificationTitle)
        .setContentText(settings.notificationBody)
        .setContentIntent(openApp)
        .setOngoing(true)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .build()
  }

  companion object {
    private const val TAG = "TrackifyLocation"
    private const val CHANNEL_ID = "trackify-location"
    private const val NOTIFICATION_ID = 7201
    /** Ten minutes at one fix per second. */
    private const val MAX_WINDOW_FIXES = 600
    private const val PARKED_AFTER_MS = 5 * 60_000L
    private const val PARKED_SAMPLING_MS = 10_000L

    /** Called by [ActivityTransitionReceiver] on the main thread. */
    internal fun onActivityChanged() {
      instance?.onActivity()
    }

    @Volatile
    var isRunning = false
      private set

    /** The running service, for changing its interval in place (same process as JS). */
    @Volatile private var instance: TrackifyLocationService? = null

    /**
     * New sync interval from the dashboard: saved for restarts, and applied to the running
     * service at once. No restart is needed (or allowed from the background on Android 12+).
     */
    internal fun reconfigure(context: Context, intervalMs: Long) {
      val settings = TrackingSettings.load(context) ?: return
      val updated = settings.copy(intervalMs = intervalMs)
      updated.save(context)
      instance?.let { service -> Handler(Looper.getMainLooper()).post { service.applySettings(updated) } }
    }

    /** Must be called while the app is in the foreground (Android 12+ foreground-start rules). */
    internal fun start(context: Context, settings: TrackingSettings) {
      settings.save(context)
      ContextCompat.startForegroundService(
          context,
          Intent(context, TrackifyLocationService::class.java),
      )
    }

    fun stop(context: Context) {
      TrackingSettings.clear(context)
      context.stopService(Intent(context, TrackifyLocationService::class.java))
      isRunning = false
    }
  }
}
