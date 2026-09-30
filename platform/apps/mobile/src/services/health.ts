import type { WarningKind } from '@trackify/api-client';
import { sendActivity } from './activity-queue';
import { updateTrackerConfig, type TrackerConfig } from './storage';
import { deviceHealth, hasLocationPermission, trackingStatus } from './tracking';

export const LOW_BATTERY_PCT = 15;

export interface HealthReading {
  batteryPct?: number;
  charging: boolean;
  locationEnabled: boolean;
  /** Only known when checked from the app; the background task skips permission checks. */
  permitted?: boolean;
  /** Only known when checked from the app. */
  running?: boolean;
}

/** The problems a reading shows. Only on shift: off duty nothing is meant to be tracked. */
export function problemsIn(config: TrackerConfig, reading: HealthReading): WarningKind[] {
  if (config.duty.status === 'off') return [];
  const problems: WarningKind[] = [];
  if (reading.batteryPct !== undefined && reading.batteryPct < LOW_BATTERY_PCT && !reading.charging)
    problems.push('battery-low');
  if (!reading.locationEnabled) problems.push('gps-off');
  if (reading.permitted === false) problems.push('permission-revoked');
  if (reading.running === false) problems.push('tracking-stopped');
  return problems;
}

/**
 * Tells the administrator about each new problem once, and forgets a problem once it is fixed so
 * it is reported again if it comes back. Returns the problems for the app to show the driver.
 */
export async function checkHealth(config: TrackerConfig, fromApp: boolean): Promise<WarningKind[]> {
  let reading: HealthReading;
  try {
    const health = await deviceHealth();
    reading = { ...health };
  } catch {
    return [];
  }
  if (fromApp) {
    reading.permitted = await hasLocationPermission().catch(() => undefined);
    // Also restarts the tracker if Android stopped it but it is meant to be on.
    if (config.duty.status !== 'off')
      reading.running = await trackingStatus().catch(() => undefined);
  }
  const problems = problemsIn(config, reading);
  const checked: WarningKind[] = fromApp
    ? ['battery-low', 'gps-off', 'permission-revoked', 'tracking-stopped']
    : ['battery-low', 'gps-off'];
  const fresh = problems.filter((kind) => !config.sentWarnings[kind]);
  const resolved = checked.filter((kind) => config.sentWarnings[kind] && !problems.includes(kind));
  if (!fresh.length && !resolved.length) return problems;
  const next = await updateTrackerConfig((current) => {
    const sentWarnings = { ...current.sentWarnings };
    for (const kind of fresh) sentWarnings[kind] = true;
    for (const kind of resolved) delete sentWarnings[kind];
    return { ...current, sentWarnings };
  });
  for (const kind of fresh)
    await sendActivity(next, {
      type: 'warning',
      kind,
      at: Date.now(),
      batteryPct: reading.batteryPct === undefined ? undefined : Math.round(reading.batteryPct),
    });
  return problems;
}
