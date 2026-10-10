import TrackifyLocation from '../native/NativeTrackifyLocation';
import { flushActivity } from '../services/activity-queue';
import { applySettings, forgetConnection } from '../services/connection';
import { pauseExpired, resume, sharesLocation } from '../services/duty';
import { checkHealth } from '../services/health';
import { fetchPhoneSettings, isRevoked } from '../services/phone-api';
import {
  addTrackerLog,
  loadTrackerConfig,
  updateTrackerConfig,
  type TrackerConfig,
} from '../services/storage';
import {
  describeWindow,
  filterGpsWindow,
  parseWindow,
  resetGpsFilter,
} from '../services/gps-window';
import { applySyncInterval, batteryPct } from '../services/tracking';
import { uploadBatch } from '../services/upload';

/** Registered in index.js; must match TASK_KEY in TrackifyLocationTaskService.kt. */
export const LOCATION_TASK = 'TrackifyLocation';

/** What TrackifyLocationTaskService.deliverWindow sends: a JSON array of raw fixes. */
export interface LocationWindow {
  fixes?: string;
  final?: boolean;
}

/**
 * Runs once per window of fixes (30 s by default) from the Android location service, even when
 * the app UI is closed. The window is filtered here (spikes, Wi-Fi/cell fallbacks, parked drift)
 * and uploaded as one batch. Pauses are enforced here too: a window taken while paused is
 * dropped, and the first window after the pause limit resumes sharing, so a pause ends on time
 * even if the app is never opened.
 */
export async function handleLocationTask(window: LocationWindow) {
  let config = await loadTrackerConfig();
  if (!config.endpoint || !config.uniqueId || !config.credential) return;
  try {
    if (config.duty.status === 'off') {
      // Off duty nothing is shared; the tracker should not be running at all.
      await TrackifyLocation.stop();
      return;
    }
    if (pauseExpired(config.duty)) {
      await resume(true);
      config = await loadTrackerConfig();
    }
    config = await refreshSettings(config);
    if (!sharesLocation(config.duty)) {
      // The next shared window must not be judged against where the vehicle was before.
      await resetGpsFilter();
      return;
    }
    const { points, report } = await filterGpsWindow(
      parseWindow(window.fixes),
      window.final === true,
    );
    const summary = describeWindow(report);
    if (summary) await addTrackerLog(summary);
    if (points.length) await uploadBatch(config, points, report, await batteryPct());
    await flushActivity(config);
    await checkHealth(config, false);
  } catch (reason) {
    if (isRevoked(reason, config)) {
      await forgetConnection();
      return;
    }
    await addTrackerLog(reason instanceof Error ? reason.message : 'Location upload unavailable');
  }
}

const SETTINGS_REFRESH_MS = 5 * 60_000;

/**
 * Checks the server for a new sync interval every few minutes, so a change in the dashboard (or a
 * plan change) reaches phones whose app stays in the background all shift.
 */
async function refreshSettings(config: TrackerConfig): Promise<TrackerConfig> {
  if (Date.now() - config.settingsCheckedAt < SETTINGS_REFRESH_MS) return config;
  try {
    const settings = await fetchPhoneSettings(config);
    const updated = await applySettings(settings);
    if (settings.trackerIntervalSeconds !== config.intervalSeconds) {
      await applySyncInterval(settings.trackerIntervalSeconds);
      await addTrackerLog(`Sync interval changed to ${settings.trackerIntervalSeconds} s`);
    }
    return await updateTrackerConfig((current) => ({
      ...current,
      ...updated,
      settingsCheckedAt: Date.now(),
    }));
  } catch (reason) {
    // Offline or unreachable: keep the current interval and try again next time.
    if (isRevoked(reason, config)) throw reason;
    return config;
  }
}
