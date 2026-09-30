import { toLocationFix } from '../native/location';
import TrackifyLocation, { type NativeLocation } from '../native/NativeTrackifyLocation';
import { flushActivity } from '../services/activity-queue';
import { forgetConnection } from '../services/connection';
import { pauseExpired, resume, sharesLocation } from '../services/duty';
import { checkHealth } from '../services/health';
import { isRevoked } from '../services/phone-api';
import { addTrackerLog, loadTrackerConfig } from '../services/storage';
import { batteryPct } from '../services/tracking';
import { uploadLocation } from '../services/upload';

/** Registered in index.js; must match TASK_KEY in TrackifyLocationTaskService.kt. */
export const LOCATION_TASK = 'TrackifyLocation';

/**
 * Runs once per fix from the Android location service, even when the app UI is closed. This is
 * where pauses are enforced: a fix taken while paused is dropped, and the first fix after the
 * pause limit resumes sharing, so a pause ends on time even if the app is never opened.
 */
export async function handleLocationTask(location: NativeLocation) {
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
    if (!sharesLocation(config.duty)) return;
    await uploadLocation(config, toLocationFix(location), await batteryPct());
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
