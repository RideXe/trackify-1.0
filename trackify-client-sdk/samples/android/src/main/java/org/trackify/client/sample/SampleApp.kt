package org.trackify.client.sample

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.trackify.client.Config
import org.trackify.client.Tracker
import org.trackify.client.sharedTracker
import org.trackify.client.startTracking

private const val DEFAULT_SERVER_URL = "https://demo.trackify.org/"
private const val DEFAULT_DEVICE_ID = "123456"

class SampleApplication : Application() {

    lateinit var tracker: Tracker
        private set

    override fun onCreate() {
        super.onCreate()
        tracker = runBlocking {
            sharedTracker(Config(DEFAULT_SERVER_URL, DEFAULT_DEVICE_ID))
        }
    }
}

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val tracker = (application as SampleApplication).tracker
        setContent {
            MaterialTheme {
                ContentView(tracker)
            }
        }
    }
}

@Composable
private fun ContentView(initialTracker: Tracker) {
    val activity = LocalActivity.current as ComponentActivity
    val scope = rememberCoroutineScope()
    var tracker by remember { mutableStateOf(initialTracker) }
    var serverUrl by remember { mutableStateOf(initialTracker.config.serverUrl) }
    var deviceId by remember { mutableStateOf(initialTracker.config.deviceId) }

    val state by tracker.state.collectAsState()
    val isTracking = state.enabled

    Scaffold { paddingValues ->
        Column(
            modifier = Modifier
                .padding(paddingValues)
                .padding(16.dp)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TextField(
                value = serverUrl,
                onValueChange = { serverUrl = it },
                label = { Text("Server URL") },
                modifier = Modifier.fillMaxWidth(),
            )
            TextField(
                value = deviceId,
                onValueChange = { deviceId = it },
                label = { Text("Device ID") },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    scope.launch {
                        tracker = tracker.updateConfig(Config(serverUrl, deviceId))
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Apply config")
            }
            Button(
                onClick = {
                    scope.launch {
                        if (isTracking) {
                            tracker.stop()
                        } else {
                            try {
                                tracker.startTracking(activity)
                            } catch (_: IllegalStateException) {
                            }
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (isTracking) "Stop" else "Start")
            }
        }
    }
}
