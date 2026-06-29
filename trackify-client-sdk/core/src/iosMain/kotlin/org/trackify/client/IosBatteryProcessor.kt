package org.trackify.client

import platform.UIKit.UIDevice
import platform.UIKit.UIDeviceBatteryState

class IosBatteryProcessor : PositionProcessor {

    init {
        UIDevice.currentDevice.batteryMonitoringEnabled = true
    }

    override suspend fun process(position: Position): Position = position.copy(
        battery = position.battery ?: readBattery(),
        charging = position.charging ?: readCharging(),
    )

    private fun readBattery(): Int? {
        val level = UIDevice.currentDevice.batteryLevel
        return if (level >= 0f) (level * 100).toInt() else null
    }

    private fun readCharging(): Boolean? = when (UIDevice.currentDevice.batteryState) {
        UIDeviceBatteryState.UIDeviceBatteryStateCharging,
        UIDeviceBatteryState.UIDeviceBatteryStateFull -> true
        UIDeviceBatteryState.UIDeviceBatteryStateUnplugged -> false
        else -> null
    }
}
