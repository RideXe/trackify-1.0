import { toLocationFix } from '../native/location';
import type { NativeLocation } from '../native/NativeTrackifyLocation';
import { uploadLocation } from '../services/upload';
import { addTrackerLog, loadTrackerConfig } from '../services/storage';

/** Registered in index.js; must match TASK_KEY in TrackifyLocationTaskService.kt. */
export const LOCATION_TASK = 'TrackifyLocation';

/** Runs once per fix from the Android location service, even when the app UI is closed. */
export async function handleLocationTask(location: NativeLocation) {
  const config = await loadTrackerConfig();
  if (!config.endpoint || !config.uniqueId || !config.credential) return;
  try {
    await uploadLocation(config, toLocationFix(location));
  } catch (reason) {
    await addTrackerLog(reason instanceof Error ? reason.message : 'Location upload unavailable');
  }
}
