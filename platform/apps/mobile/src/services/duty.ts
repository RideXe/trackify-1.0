import type { PauseReason } from '@trackify/api-client';
import { queueActivity, sendActivity, type ActivityFields } from './activity-queue';
import { addTrackerLog, updateTrackerConfig, type Duty, type TrackerConfig } from './storage';
import {
  batteryPct,
  quickPosition,
  sendCurrentPosition,
  startTracking,
  stopTracking,
} from './tracking';

/**
 * Shifts and pauses. Location is shared only on shift and never while paused; a pause ends by
 * itself at the administrator's limit, so it cannot be used to switch tracking off for the day.
 */

export function pauseExpired(duty: Duty, now = Date.now()) {
  return duty.status === 'paused' && duty.until !== undefined && now >= duty.until;
}

/** Whether a GPS fix taken now should be shared. */
export function sharesLocation(duty: Duty, now = Date.now()) {
  return duty.status === 'on' || pauseExpired(duty, now);
}

async function record(config: TrackerConfig, activity: ActivityFields) {
  return sendActivity(config, { ...activity, at: Date.now(), batteryPct: await batteryPct() });
}

/** Shift changes: saved and the screen updated at once; the server hears in the background. */
async function note(config: TrackerConfig, activity: ActivityFields) {
  await queueActivity(config, { ...activity, at: Date.now(), batteryPct: await batteryPct() });
}

export async function startShift(config: TrackerConfig) {
  await startTracking(config);
  const next = await updateTrackerConfig((current) => ({
    ...current,
    duty: { status: 'on', since: Date.now() },
    sentWarnings: {},
  }));
  await addTrackerLog('Shift started');
  await note(next, { type: 'shift-start' });
  // The first position goes up in the background; the dashboard shows it within seconds.
  void sendCurrentPosition(next).catch(() => undefined);
}

export async function endShift() {
  await stopTracking();
  const next = await updateTrackerConfig((current) => ({
    ...current,
    duty: { status: 'off', since: Date.now() },
  }));
  await addTrackerLog('Shift ended');
  await note(next, { type: 'shift-end' });
}

/** Tracking keeps running underneath; fixes are simply not shared until the pause ends. */
export async function pause(reason: PauseReason) {
  const now = Date.now();
  const next = await updateTrackerConfig((current) => ({
    ...current,
    duty: { status: 'paused', since: now, reason, until: now + current.pauseLimitMinutes * 60_000 },
  }));
  await addTrackerLog(`Paused: ${reason}`);
  await note(next, { type: 'pause', reason });
}

export async function resume(auto = false) {
  const next = await updateTrackerConfig((current) => ({
    ...current,
    duty: { status: 'on', since: Date.now() },
  }));
  await addTrackerLog(auto ? 'Pause limit reached; sharing resumed' : 'Resumed');
  await note(next, { type: 'resume', auto });
}

/** SOS with wherever the phone can find itself in a few seconds; sent even with no fix. */
export async function sendSos(config: TrackerConfig) {
  const position = await quickPosition(config);
  await addTrackerLog('SOS sent');
  return record(config, { type: 'sos', ...position });
}
