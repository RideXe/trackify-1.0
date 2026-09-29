import type { NativeLocation } from './NativeTrackifyLocation';

/** A position fix as the upload code consumes it; values the device did not report are null. */
export interface LocationFix {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    speed: number | null;
    heading: number | null;
    accuracy: number | null;
  };
}

export function toLocationFix(location: NativeLocation): LocationFix {
  return {
    timestamp: location.timestamp,
    coords: {
      latitude: location.latitude,
      longitude: location.longitude,
      altitude: location.altitude ?? null,
      speed: location.speed ?? null,
      heading: location.heading ?? null,
      accuracy: location.accuracy ?? null,
    },
  };
}
