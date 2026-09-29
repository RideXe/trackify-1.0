import * as SecureStore from './secure-store';

export interface TrackerConfig {
  deviceId: string;
  uniqueId: string;
  name: string;
  endpoint: string;
  credential: string;
  accuracy: 'balanced' | 'high' | 'highest';
  distanceMeters: number;
  intervalSeconds: number;
  heartbeatSeconds: number;
  buffer: boolean;
}

export const defaultTrackerConfig: TrackerConfig = {
  deviceId: '',
  uniqueId: '',
  name: 'My phone',
  endpoint: '',
  credential: '',
  accuracy: 'high',
  distanceMeters: 0,
  intervalSeconds: 30,
  heartbeatSeconds: 300,
  buffer: true,
};

const configKey = 'tracker-config-v2';
const logsKey = 'tracker-logs-v2';

export async function loadTrackerConfig() {
  const value = await SecureStore.getItemAsync(configKey);
  if (!value) return defaultTrackerConfig;
  try {
    return { ...defaultTrackerConfig, ...(JSON.parse(value) as Partial<TrackerConfig>) };
  } catch {
    return defaultTrackerConfig;
  }
}

export async function saveTrackerConfig(config: TrackerConfig) {
  await SecureStore.setItemAsync(configKey, JSON.stringify(config));
}

export async function readTrackerLogs() {
  const value = await SecureStore.getItemAsync(logsKey);
  return value ? (JSON.parse(value) as string[]) : [];
}

export async function addTrackerLog(message: string) {
  const current = await readTrackerLogs().catch(() => []);
  const next = [`${new Date().toLocaleString()}  ${message}`, ...current].slice(0, 100);
  await SecureStore.setItemAsync(logsKey, JSON.stringify(next));
}

export async function clearTrackerLogs() {
  await SecureStore.deleteItemAsync(logsKey);
}

// Keep each encrypted entry small; SecureStore is intended for small values.
// A bounded ring retains the newest 120 fixes across app restarts.
export interface PendingPosition {
  endpoint: string;
  deviceId: string;
  body: string;
}
const queueKey = 'tracker-upload-queue-v1';
export async function readPendingPositions(): Promise<PendingPosition[]> {
  const head = Number((await SecureStore.getItemAsync(queueKey)) ?? 0);
  const items: PendingPosition[] = [];
  for (let i = Math.max(0, head - 120); i < head; i += 1) {
    const raw = await SecureStore.getItemAsync(`${queueKey}-${i % 120}`);
    if (raw) items.push(JSON.parse(raw) as PendingPosition);
  }
  return items;
}
export async function appendPendingPosition(item: PendingPosition) {
  const head = Number((await SecureStore.getItemAsync(queueKey)) ?? 0);
  await SecureStore.setItemAsync(`${queueKey}-${head % 120}`, JSON.stringify(item));
  await SecureStore.setItemAsync(queueKey, String(head + 1));
}
export async function removeFirstPendingPosition() {
  const head = Number((await SecureStore.getItemAsync(queueKey)) ?? 0);
  for (let i = Math.max(0, head - 120); i < head; i += 1) {
    const key = `${queueKey}-${i % 120}`;
    if (await SecureStore.getItemAsync(key)) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
  }
}
