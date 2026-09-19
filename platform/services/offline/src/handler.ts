import { createDocumentClient, DynamoCommandStore, DynamoOfflineStore } from '@trackify/data';

interface OfflineStore {
  markStale(cutoff: number, limit?: number): Promise<number>;
}

interface CommandStore {
  expirePending(now: number, limit?: number): Promise<number>;
}

export function createHandler(store: OfflineStore, commands: CommandStore, now = Date.now) {
  return async () => {
    const currentTime = now();
    const cutoff = currentTime - numberEnv('OFFLINE_AFTER_MS', 300_000);
    const updated = await store.markStale(cutoff, 1_000);
    const expiredCommands = await commands.expirePending(currentTime, 1_000);
    return { cutoff, updated, expiredCommands };
  };
}

function numberEnv(key: string, fallback: number) {
  const value = process.env[key];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 60_000) throw new Error(`${key} is invalid`);
  return parsed;
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

const client = createDocumentClient();
export const handler = createHandler(
  new DynamoOfflineStore(client, requiredEnv('DEVICE_STATE_TABLE'), requiredEnv('EVENTS_TABLE')),
  new DynamoCommandStore(client, requiredEnv('COMMANDS_TABLE')),
);
