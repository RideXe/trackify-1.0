import { PermissionsAndroid, Platform } from 'react-native';
import TrackifyLocation from '../native/NativeTrackifyLocation';
import { toLocationFix } from '../native/location';
import { uploadLocation } from './upload';
import { addTrackerLog, type TrackerConfig } from './storage';

const { PERMISSIONS, RESULTS } = PermissionsAndroid;

export async function trackingStatus() {
  return TrackifyLocation.isRunning();
}

async function requestForegroundLocation() {
  const result = await PermissionsAndroid.requestMultiple([
    PERMISSIONS.ACCESS_FINE_LOCATION,
    PERMISSIONS.ACCESS_COARSE_LOCATION,
  ]);
  return (
    result[PERMISSIONS.ACCESS_FINE_LOCATION] === RESULTS.GRANTED ||
    result[PERMISSIONS.ACCESS_COARSE_LOCATION] === RESULTS.GRANTED
  );
}

async function requestBackgroundLocation() {
  // Android 10+ asks for "Allow all the time" separately from while-in-use access.
  if (Number(Platform.Version) < 29) return true;
  return (
    (await PermissionsAndroid.request(PERMISSIONS.ACCESS_BACKGROUND_LOCATION)) === RESULTS.GRANTED
  );
}

export async function startTracking(config: TrackerConfig) {
  if (!config.endpoint || !config.uniqueId || !config.credential)
    throw new Error('Complete tracker setup first');
  if (!(await requestForegroundLocation())) throw new Error('Location permission is required');
  if (!(await requestBackgroundLocation()))
    throw new Error('Allow background location in Settings');
  // Android 13+ hides the tracking notification without this; tracking itself still runs.
  if (Number(Platform.Version) >= 33)
    await PermissionsAndroid.request(PERMISSIONS.POST_NOTIFICATIONS);
  await TrackifyLocation.start({
    intervalMs: Math.max(15, Math.min(300, config.intervalSeconds || 30)) * 1000,
    accuracy: config.accuracy,
    notificationTitle: 'On shift · Trackify',
    notificationBody: 'Your location is shared with your fleet until you end the shift.',
  });
  await addTrackerLog('Background tracking started');
}

export async function stopTracking() {
  await TrackifyLocation.stop();
  await addTrackerLog('Background tracking stopped');
}

export async function sendCurrentPosition(config: TrackerConfig) {
  if (!(await requestForegroundLocation())) throw new Error('Location permission is required');
  const location = await TrackifyLocation.getCurrentPosition(config.accuracy);
  await uploadLocation(config, toLocationFix(location), await batteryPct());
}

/** Where the phone is right now, or undefined if no fix arrives in time (e.g. indoors). */
export async function quickPosition(config: TrackerConfig, timeoutMs = 8_000) {
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), timeoutMs),
  );
  try {
    const location = await Promise.race([
      TrackifyLocation.getCurrentPosition(config.accuracy),
      timeout,
    ]);
    return location && { latitude: location.latitude, longitude: location.longitude };
  } catch {
    return undefined;
  }
}

export async function batteryPct() {
  try {
    const health = await TrackifyLocation.deviceHealth();
    return health.batteryPct === undefined ? undefined : Math.round(health.batteryPct);
  } catch {
    return undefined;
  }
}

export function deviceHealth() {
  return TrackifyLocation.deviceHealth();
}

/** Both location permissions tracking needs, checked without asking the driver. */
export async function hasLocationPermission() {
  const foreground = await PermissionsAndroid.check(PERMISSIONS.ACCESS_FINE_LOCATION);
  const background =
    Number(Platform.Version) < 29 ||
    (await PermissionsAndroid.check(PERMISSIONS.ACCESS_BACKGROUND_LOCATION));
  return foreground && background;
}
