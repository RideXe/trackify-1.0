package org.trackify.client

import android.content.Context
import android.os.BatteryManager
import androidx.core.content.getSystemService

class AndroidBatteryProcessor(context: Context) : PositionProcessor {

    private val batteryManager: BatteryManager? = context.applicationContext.getSystemService()

    override suspend fun process(position: Position): Position = position.copy(
        battery = position.battery ?: batteryLevel(),
        charging = position.charging ?: batteryManager?.isCharging,
    )

    private fun batteryLevel(): Int? {
        val level = batteryManager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: return null
        return if (level in 0..100) level else null
    }
}
