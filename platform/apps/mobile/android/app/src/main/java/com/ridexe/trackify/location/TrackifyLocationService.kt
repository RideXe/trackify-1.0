package com.ridexe.trackify.location

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.Looper
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
 * Foreground service that keeps receiving fused location updates while the app is in the
 * background and hands each fix to JS through [TrackifyLocationTaskService].
 */
class TrackifyLocationService : Service() {
  private lateinit var client: FusedLocationProviderClient

  private val callback =
      object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
          for (location in result.locations) {
            TrackifyLocationTaskService.deliver(applicationContext, location)
          }
        }
      }

  override fun onCreate() {
    super.onCreate()
    client = LocationServices.getFusedLocationProviderClient(this)
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
      client.removeLocationUpdates(callback)
      client.requestLocationUpdates(
          LocationRequest.Builder(settings.priority, settings.intervalMs)
              // Without this Android may deliver fixes several times faster than the chosen
              // interval, costing battery and data. Distance 0 keeps parked vehicles reporting.
              .setMinUpdateIntervalMillis(settings.intervalMs)
              .setMinUpdateDistanceMeters(0f)
              .build(),
          callback,
          Looper.getMainLooper(),
      )
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

    @Volatile
    var isRunning = false
      private set

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
