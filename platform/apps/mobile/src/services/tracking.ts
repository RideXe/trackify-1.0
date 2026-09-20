import * as Location from 'expo-location';
import { LOCATION_TASK } from '../tasks/location-task';
import { addTrackerLog, type TrackerConfig } from './storage';

const accuracy = {
  balanced: Location.Accuracy.Balanced,
  high: Location.Accuracy.High,
  highest: Location.Accuracy.Highest,
};

export async function trackingStatus() {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

export async function startTracking(config: TrackerConfig) {
  if (!config.endpoint || !config.uniqueId || !config.credential)
    throw new Error('Complete tracker setup first');
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED)
    throw new Error('Location permission is required');
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== Location.PermissionStatus.GRANTED)
    throw new Error('Allow background location in Settings');
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: accuracy[config.accuracy],
    distanceInterval: config.distanceMeters,
    timeInterval: config.intervalSeconds * 1000,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Trackify is tracking this phone',
      notificationBody: 'Location sharing is active for your fleet.',
      notificationColor: '#155EEF',
    },
  });
  await addTrackerLog('Background tracking started');
}

export async function stopTracking() {
  if (await trackingStatus()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await addTrackerLog('Background tracking stopped');
}

export async function sendCurrentPosition(config: TrackerConfig) {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED)
    throw new Error('Location permission is required');
  const location = await Location.getCurrentPositionAsync({ accuracy: accuracy[config.accuracy] });
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.credential}`,
    },
    body: JSON.stringify({
      id: config.uniqueId,
      lat: location.coords.latitude,
      lon: location.coords.longitude,
      altitude: location.coords.altitude,
      speed: location.coords.speed == null ? undefined : location.coords.speed * 1.94384,
      bearing: location.coords.heading,
      accuracy: location.coords.accuracy,
      timestamp: location.timestamp,
    }),
  });
  if (!response.ok) throw new Error(`Location upload failed (${response.status})`);
  await addTrackerLog('Current location uploaded');
}
