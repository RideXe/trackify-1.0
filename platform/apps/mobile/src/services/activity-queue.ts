import type { DriverActivityType } from '@trackify/api-client';
import { DisconnectedError, phoneRequest, RejectedError } from './phone-api';
import * as SecureStore from './secure-store';
import { addTrackerLog, type TrackerConfig } from './storage';

/** What the phone sends for one driver action; see parseActivity in services/api/src/phone.ts. */
export type ActivityFields = { type: DriverActivityType } & Record<string, unknown>;
export type ActivityInput = ActivityFields & { at: number };

interface Queued {
  deviceId: string;
  activity: ActivityInput;
}

const queueKey = 'activity-queue-v1';
/** Driver actions are rare; 200 covers days without signal while staying a small value. */
const maxQueued = 200;

async function read(): Promise<Queued[]> {
  const value = await SecureStore.getItemAsync(queueKey);
  if (!value) return [];
  try {
    return JSON.parse(value) as Queued[];
  } catch {
    return [];
  }
}

async function write(items: Queued[]) {
  await SecureStore.setItemAsync(queueKey, JSON.stringify(items.slice(-maxQueued)));
}

let flushing: Promise<boolean> | undefined;

/**
 * Sends queued actions in the order they happened. Stops at the first network failure and keeps
 * the rest for next time; drops an action the server refuses, since resending cannot fix it.
 * Resolves true when nothing is left waiting.
 */
export function flushActivity(config: TrackerConfig): Promise<boolean> {
  flushing ??= (async () => {
    try {
      let items = await read();
      while (items.length) {
        const [next] = items;
        if (next.deviceId === config.deviceId) {
          try {
            await phoneRequest(config, '/phone/activity', { method: 'POST', body: next.activity });
          } catch (error) {
            if (error instanceof DisconnectedError) throw error;
            if (!(error instanceof RejectedError)) return false;
            await addTrackerLog(`Action not accepted: ${error.message}`);
          }
        }
        // Re-read: something may have been queued while this one was sending.
        items = (await read()).slice(1);
        await write(items);
      }
      return true;
    } finally {
      flushing = undefined;
    }
  })();
  return flushing;
}

/** Records a driver action and tries to send it now. Resolves 'queued' when offline. */
export async function sendActivity(
  config: TrackerConfig,
  activity: ActivityInput,
): Promise<'sent' | 'queued'> {
  // A flush already running would only send what was queued before this; wait for it first.
  await flushing?.catch(() => undefined);
  await write([...(await read()), { deviceId: config.deviceId, activity }]);
  return (await flushActivity(config)) ? 'sent' : 'queued';
}

export async function pendingActivityCount() {
  return (await read()).length;
}
