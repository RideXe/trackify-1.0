package org.trackify.client

import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.edit
import androidx.core.content.getSystemService

private const val PREFERENCES_NAME = "trackify-client-sdk"
private const val BATTERY_PROMPTED_KEY = "battery-prompted"

suspend fun Tracker.startTracking(context: Context) {
    TrackerService.ensureNotificationChannel(context)
    if (!ensurePermissions(context)) {
        Log.log("Permissions denied")
        throw IllegalStateException("Location permission denied")
    }
    promptBatteryOptimization(context)
    start()
}

private fun promptBatteryOptimization(context: Context) {
    val powerManager = context.getSystemService<PowerManager>() ?: return
    if (powerManager.isIgnoringBatteryOptimizations(context.packageName)) return
    val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    if (preferences.getBoolean(BATTERY_PROMPTED_KEY, false)) return
    context.startActivity(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    preferences.edit { putBoolean(BATTERY_PROMPTED_KEY, true) }
}
