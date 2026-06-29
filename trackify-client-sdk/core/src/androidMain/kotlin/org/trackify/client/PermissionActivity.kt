package org.trackify.client

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.CompletableDeferred

class PermissionActivity : ComponentActivity() {

    private val requestForeground = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        if (result.values.any { !it }) finishWith(false) else maybeRequestBackground()
    }

    private val requestBackground = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        finishWith(granted)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) return
        requestForeground.launch(foregroundPermissions().toTypedArray())
    }

    private fun maybeRequestBackground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            !hasPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        ) {
            requestBackground.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        } else {
            finishWith(true)
        }
    }

    private fun finishWith(granted: Boolean) {
        pending?.complete(granted)
        pending = null
        finish()
    }

    companion object {
        @Volatile
        var pending: CompletableDeferred<Boolean>? = null
    }
}
