import type { CleanPoint, FilterReport } from '@trackify/geo';
import {
  addTrackerLog,
  appendPendingPosition,
  noteSync,
  readPendingPositions,
  removeFirstPendingPosition,
  type SyncProblem,
  type TrackerConfig,
} from './storage';

/**
 * One filtered window as a batch (format v2 of POST /phone/positions). Speeds are m/s. `filter`
 * says what the phone dropped and why, so the server can log it for support. `int` is the sync
 * interval, so the server allows for it before showing the phone as offline. A batch without
 * points is a check-in: the phone is alive but had no usable position to send.
 */
export function batchBody(
  config: TrackerConfig,
  points: CleanPoint[],
  report?: FilterReport,
  batteryPct?: number,
) {
  return JSON.stringify({
    v: 2,
    id: config.uniqueId,
    batt: batteryPct,
    int: config.intervalSeconds,
    points,
    ...(report
      ? {
          filter: {
            raw: report.raw,
            kept: report.kept,
            uploaded: report.uploaded,
            rejected: report.rejected,
            relocations: report.relocations,
            distanceM: Math.round(report.distanceM),
            samples: report.samples,
          },
        }
      : {}),
  });
}

/** Why a window had nothing to upload. */
export type CheckInReason = 'no-gps' | 'paused';

let pending: Promise<unknown> = Promise.resolve();
function serialized(operation: () => Promise<void>): Promise<void> {
  const next = pending.then(operation);
  pending = next.catch(() => undefined);
  return next;
}

/** Uploads one filtered window; with buffering on it is queued first and survives going offline. */
export function uploadBatch(
  config: TrackerConfig,
  points: CleanPoint[],
  report: FilterReport,
  batteryPct?: number,
): Promise<void> {
  return serialized(() =>
    deliver(config, batchBody(config, points, report, batteryPct), points.length),
  );
}

/**
 * A window with nothing to upload (indoors, weak GPS, or paused). Tells the server the phone is
 * still working, so the dashboard does not show it as offline, and retries positions saved
 * while offline. A check-in is only useful now, so it is never queued itself.
 */
export function checkIn(
  config: TrackerConfig,
  reason: CheckInReason,
  report?: FilterReport,
  batteryPct?: number,
): Promise<void> {
  return serialized(async () => {
    requireSetup(config);
    if (config.buffer) await flushPending(config);
    await postOnce(config, batchBody(config, [], report, batteryPct), 0, reason);
  });
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

function requireSetup(config: TrackerConfig) {
  if (!config.credential || !config.endpoint || !config.deviceId)
    throw new Error('Complete tracker setup first');
}

function problemFor(status: number): SyncProblem {
  return status === 401 || status === 403 ? 'access' : 'server';
}

/** Records what reached the server, for the home screen. */
async function accepted(pointCount: number, reason?: CheckInReason) {
  const now = Date.now();
  await noteSync(
    pointCount
      ? { contactAt: now, positionsAt: now, problem: undefined }
      : { contactAt: now, problem: reason === 'no-gps' ? 'no-gps' : undefined },
  );
}

/** One request, not saved for retry. */
async function postOnce(
  config: TrackerConfig,
  body: string,
  pointCount: number,
  reason?: CheckInReason,
) {
  const what = pointCount ? 'Location upload' : 'Check-in';
  let response: Response;
  try {
    response = await post(config, body);
  } catch {
    await noteSync({ problem: 'offline' });
    throw new Error(`${what} failed: no internet`);
  }
  if (!response.ok) {
    await noteSync({ problem: problemFor(response.status) });
    throw new Error(`${what} failed: ${await rejectionReason(response)}`);
  }
  await accepted(pointCount, reason);
  if (pointCount)
    await addTrackerLog(`${pointCount} location${pointCount === 1 ? '' : 's'} uploaded`);
}

async function deliver(config: TrackerConfig, body: string, pointCount: number) {
  requireSetup(config);
  if (!config.buffer) return postOnce(config, body, pointCount);
  await appendPendingPosition({ deviceId: config.deviceId, endpoint: config.endpoint, body });
  await flushPending(config);
}

/** Sends positions saved on the phone, oldest first; stops at the first failure. */
async function flushPending(config: TrackerConfig) {
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
      await noteSync({ problem: 'offline' });
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
      await noteSync({ problem: problemFor(response.status) });
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
  if (uploaded) {
    await accepted(uploaded);
    await addTrackerLog(
      uploaded === 1 ? 'Locations uploaded' : `${uploaded} location batches uploaded`,
    );
  }
}

/** The server explains rejections as `{ "message": "..." }`. */
async function rejectionReason(response: Response): Promise<string> {
  const value = (await response.json().catch(() => ({}))) as { message?: unknown };
  return typeof value.message === 'string' ? value.message : `HTTP ${response.status}`;
}
