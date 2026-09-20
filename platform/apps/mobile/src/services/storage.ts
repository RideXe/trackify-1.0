import * as SecureStore from 'expo-secure-store';

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
  distanceMeters: 25,
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
