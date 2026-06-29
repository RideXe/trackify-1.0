package org.trackify.client

import android.content.Context
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import org.koin.core.module.Module
import org.koin.dsl.module
import org.trackify.client.db.Database

internal actual fun platformModule(): Module = module {
    single<Context> { applicationContext }
    single<SqlDriver> { AndroidSqliteDriver(Database.Schema, get(), "tracker.db") }
    single { HttpClient(Android) }
    single<NetworkMonitor> { AndroidNetworkMonitor(get()) }
    single<PositionProcessor> { AndroidBatteryProcessor(get()) }

    single<LocationSource> {
        val context = get<Context>()
        val config = get<Config>()
        val playServicesAvailable = GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
        val useFused = !config.preferPlatformProviders && playServicesAvailable
        Log.log("Using ${if (useFused) "Fused" else "Android"}LocationSource")
        if (useFused) {
            FusedLocationSource(get(), get(), get(), get())
        } else {
            AndroidLocationSource(get(), get(), get(), get())
        }
    }

    single { ActivityRecognitionDetector(get(), get(), get(), get()) }
    single { GeofenceDetector(get(), get(), get(), get(), get()) }
    single { WakeLockHolder(get(), get(), get()) }
    single { AlarmHeartbeatTrigger(get(), get(), get(), get()) }
    single { ForegroundServiceHolder(get(), get(), get()) }

    single<List<SignalSource>> {
        val config = get<Config>()
        buildList {
            if (config.location.stopDetection) {
                add(get<ActivityRecognitionDetector>())
                add(get<GeofenceDetector>())
                if (config.location.heartbeatIntervalSeconds > 0) {
                    add(get<AlarmHeartbeatTrigger>())
                }
            }
            if (config.wakeLock) {
                add(get<WakeLockHolder>())
            }
            add(get<ForegroundServiceHolder>())
        }
    }
}
