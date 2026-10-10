import { PermissionsAndroid, Platform } from 'react-native';
import { translateCurrent } from '../i18n';
import TrackifyLocation, { type NativeLocation } from '../native/NativeTrackifyLocation';
import { filterGpsWindow, resetGpsFilter } from './gps-window';
import { uploadBatch } from './upload';
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

/**
 * Optional "Physical activity" access (Android 10+): steadier parked positions and less battery
 * while parked. A refusal changes nothing else; Android stops asking after the second refusal.
 */
export async function requestActivityRecognition() {
  if (Number(Platform.Version) < 29) return true;
  const permission = PERMISSIONS.ACTIVITY_RECOGNITION;
  if (await PermissionsAndroid.check(permission)) return true;
  const result = await PermissionsAndroid.request(permission, {
    title: translateCurrent('activityRationaleTitle'),
    message: translateCurrent('activityRationale'),
    buttonPositive: translateCurrent('ok'),
  });
  return result === RESULTS.GRANTED;
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
  const motion = await requestActivityRecognition().catch(() => false);
  await resetGpsFilter();
  await TrackifyLocation.start({
    intervalMs: syncIntervalMs(config.intervalSeconds),
    accuracy: config.accuracy,
    notificationTitle: 'On shift · Trackify',
    notificationBody: 'Your location is shared with your fleet until you end the shift.',
  });
  await addTrackerLog(
    motion
      ? 'Background tracking started'
      : 'Background tracking started (motion detection not allowed: using GPS speed only)',
  );
}

/** The server's sync interval in milliseconds, kept within what the phone supports. */
export function syncIntervalMs(seconds: number) {
  return Math.max(5, Math.min(300, seconds || 30)) * 1000;
}

/** Applies a new sync interval to running tracking, foreground or background. */
export async function applySyncInterval(seconds: number) {
  if (await TrackifyLocation.isRunning())
    await TrackifyLocation.setInterval(syncIntervalMs(seconds));
}

export async function stopTracking() {
  await TrackifyLocation.stop();
  await addTrackerLog('Background tracking stopped');
}

export async function sendCurrentPosition(config: TrackerConfig) {
  if (!(await requestForegroundLocation())) throw new Error('Location permission is required');
  const location = await TrackifyLocation.getCurrentPosition(config.accuracy);
  // A one-off position goes through the same filter, flushed straight away.
  const { points, report } = await filterGpsWindow([toRawFix(location)], true);
  if (!points.length) throw new Error('Location is not accurate enough yet. Try again outdoors.');
  await uploadBatch(config, points, report, await batteryPct());
}

export function toRawFix(location: NativeLocation) {
  return {
    t: location.timestamp,
    e: location.elapsedMs,
    lat: location.latitude,
    lon: location.longitude,
    acc: location.accuracy,
    spd: location.speed,
    spdAcc: location.speedAccuracy,
    brg: location.heading,
    brgAcc: location.bearingAccuracy,
    alt: location.altitude,
    provider: location.provider,
    mock: location.mock,
    sats: location.satellites,
  };
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
