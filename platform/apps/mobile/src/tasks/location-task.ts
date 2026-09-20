import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { addTrackerLog, loadTrackerConfig } from '../services/storage';

export const LOCATION_TASK = 'trackify-background-location';

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    await addTrackerLog(`Background location error: ${error.message}`);
    return;
  }
  const locations =
    (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  const config = await loadTrackerConfig();
  if (!config.endpoint || !config.uniqueId || !config.credential) return;
  for (const location of locations) {
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.credential}`,
        },
        body: JSON.stringify({
          id: config.uniqueId,
          lat: location.coords.latitude,
          lon: location.coords.longitude,
          altitude: location.coords.altitude,
          speed: location.coords.speed == null ? undefined : location.coords.speed * 1.94384,
          bearing: location.coords.heading,
          accuracy: location.coords.accuracy,
          timestamp: location.timestamp,
        }),
      });
      await addTrackerLog(response.ok ? 'Location uploaded' : `Upload failed (${response.status})`);
    } catch {
      await addTrackerLog('Location buffered; network unavailable');
    }
  }
});
