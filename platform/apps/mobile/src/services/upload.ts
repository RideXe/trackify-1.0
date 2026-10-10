import type { CleanPoint, FilterReport } from '@trackify/geo';
import {
  addTrackerLog,
  appendPendingPosition,
  readPendingPositions,
  removeFirstPendingPosition,
  type TrackerConfig,
} from './storage';

/**
 * One filtered window as a batch (format v2 of POST /phone/positions). Speeds are m/s. `filter`
 * says what the phone dropped and why, so the server can log it for support.
 */
export function batchBody(
  config: TrackerConfig,
  points: CleanPoint[],
  report: FilterReport,
  batteryPct?: number,
) {
  return JSON.stringify({
    v: 2,
    id: config.uniqueId,
    batt: batteryPct,
    points,
    filter: {
      raw: report.raw,
      kept: report.kept,
      uploaded: report.uploaded,
      rejected: report.rejected,
      relocations: report.relocations,
      distanceM: Math.round(report.distanceM),
      samples: report.samples,
    },
  });
}

let pending: Promise<unknown> = Promise.resolve();
/** Uploads one filtered window; with buffering on it is queued first and survives going offline. */
export function uploadBatch(
  config: TrackerConfig,
  points: CleanPoint[],
  report: FilterReport,
  batteryPct?: number,
): Promise<void> {
  const operation = pending.then(() =>
    deliver(config, batchBody(config, points, report, batteryPct), points.length),
  );
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

async function deliver(config: TrackerConfig, body: string, pointCount: number) {
  if (!config.credential || !config.endpoint || !config.deviceId)
    throw new Error('Complete tracker setup first');
  if (!config.buffer) {
    const response = await post(config, body);
    if (!response.ok) throw new Error(`Location upload failed: ${await rejectionReason(response)}`);
    await addTrackerLog(`${pointCount} location${pointCount === 1 ? '' : 's'} uploaded`);
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
      await addTrackerLog('Locations saved on phone; retrying with the next GPS update');
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
    await addTrackerLog(
      uploaded === 1 ? 'Locations uploaded' : `${uploaded} location batches uploaded`,
    );
}

/** The server explains rejections as `{ "message": "..." }`. */
async function rejectionReason(response: Response): Promise<string> {
  const value = (await response.json().catch(() => ({}))) as { message?: unknown };
  return typeof value.message === 'string' ? value.message : `HTTP ${response.status}`;
}
