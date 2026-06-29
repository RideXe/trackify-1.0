package org.trackify.client

sealed interface Signal {
    object StationaryEnter : Signal
    object StationaryExit : Signal
    object HeartbeatTick : Signal
}
