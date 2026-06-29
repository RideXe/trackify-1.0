package org.trackify.client

import kotlinx.serialization.Serializable

@Serializable
data class State(
    val enabled: Boolean = false,
    val paused: Boolean = false,
    val lastAcceptedLocation: Position? = null,
)
