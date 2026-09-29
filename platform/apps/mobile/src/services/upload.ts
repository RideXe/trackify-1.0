import type { LocationFix } from '../native/location';
import {
  addTrackerLog,
  appendPendingPosition,
  readPendingPositions,
  removeFirstPendingPosition,
  type TrackerConfig,
} from './storage';

export function positionBody(config: TrackerConfig, location: LocationFix) {
  const c = location.coords;
  return JSON.stringify({
    id: config.uniqueId,
    lat: c.latitude,
    lon: c.longitude,
    altitude: c.altitude ?? undefined,
    speed: c.speed == null || c.speed < 0 ? undefined : c.speed * 1.94384,
    bearing: c.heading == null || c.heading < 0 ? undefined : c.heading,
    accuracy: c.accuracy == null || c.accuracy < 0 ? undefined : c.accuracy,
    timestamp: location.timestamp,
  });
}

let pending: Promise<unknown> = Promise.resolve();
export function uploadLocation(config: TrackerConfig, location: LocationFix): Promise<void> {
  const operation = pending.then(() => deliver(config, location));
  pending = operation.catch(() => undefined);
  return operation;
}

async function post(config: TrackerConfig, body: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(config.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.credential}` },
      body,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function deliver(config: TrackerConfig, location: LocationFix) {
  if (!config.credential || !config.endpoint || !config.deviceId)
    throw new Error('Complete tracker setup first');
  const body = positionBody(config, location);
  if (!config.buffer) {
    const response = await post(config, body);
    if (!response.ok) throw new Error(`Location upload failed: ${await rejectionReason(response)}`);
    await addTrackerLog('Location uploaded');
    return;
  }
  await appendPendingPosition({ deviceId: config.deviceId, endpoint: config.endpoint, body });
  let uploaded = 0;
  for (const item of await readPendingPositions()) {
    // Never replay one vehicle's fixes using another vehicle's credentials.
    if (item.deviceId !== config.deviceId || item.endpoint !== config.endpoint) {
      await removeFirstPendingPosition();
      continue;
    }
    let response: Response;
    try {
      response = await post(config, item.body);
    } catch {
      await addTrackerLog('Location saved on phone; retrying with the next GPS update');
      throw new Error('Location saved offline. Keep tracking enabled to retry automatically.');
    }
    if (response.status === 400) {
      // The server will never accept this reading, so drop it and record why.
      await removeFirstPendingPosition();
      const reason = await rejectionReason(response);
      if (typeof __DEV__ !== 'undefined' && __DEV__)
        console.warn(`Trackify: server rejected GPS reading (${reason}): ${item.body}`);
      await addTrackerLog(`GPS reading rejected: ${reason}`);
      continue;
    }
    if (!response.ok) {
      await addTrackerLog(`Upload pending (${response.status})`);
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Phone access is unavailable. Retry shortly or ask your administrator to reconnect this phone.'
          : `Location saved for retry (${response.status})`,
      );
    }
    await removeFirstPendingPosition();
    uploaded += 1;
  }
  if (uploaded)
    await addTrackerLog(uploaded === 1 ? 'Location uploaded' : `${uploaded} locations uploaded`);
}

/** The server explains rejections as `{ "message": "..." }`. */
async function rejectionReason(response: Response): Promise<string> {
  const value = (await response.json().catch(() => ({}))) as { message?: unknown };
  return typeof value.message === 'string' ? value.message : `HTTP ${response.status}`;
}
