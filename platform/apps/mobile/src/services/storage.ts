import {
  defaultPauseLimitMinutes,
  defaultTrackerIntervalSeconds,
  type DutyStatus,
  type PauseReason,
  type WarningKind,
} from '@trackify/api-client';
import * as SecureStore from './secure-store';

export interface Duty {
  status: DutyStatus;
  since?: number;
  reason?: PauseReason;
  /** While paused: when tracking resumes by itself. */
  until?: number;
}

export interface TrackerConfig {
  deviceId: string;
  uniqueId: string;
  /** The vehicle's name. */
  name: string;
  endpoint: string;
  credential: string;
  accuracy: 'balanced' | 'high' | 'highest';
  distanceMeters: number;
  /** Set by the administrator in the dashboard, never on the phone. */
  intervalSeconds: number;
  pauseLimitMinutes: number;
  heartbeatSeconds: number;
  buffer: boolean;
  organisation?: string;
  dispatcherPhone?: string;
  driverName?: string;
  duty: Duty;
  /** Warnings already sent for a problem that is still going on, so each is sent once. */
  sentWarnings: Partial<Record<WarningKind, boolean>>;
  lastReadMessageAt: number;
}

export const defaultTrackerConfig: TrackerConfig = {
  deviceId: '',
  uniqueId: '',
  name: 'My phone',
  endpoint: '',
  credential: '',
  accuracy: 'high',
  distanceMeters: 0,
  intervalSeconds: defaultTrackerIntervalSeconds,
  pauseLimitMinutes: defaultPauseLimitMinutes,
  heartbeatSeconds: 300,
  buffer: true,
  duty: { status: 'off' },
  sentWarnings: {},
  lastReadMessageAt: 0,
};

const configKey = 'tracker-config-v2';
const logsKey = 'tracker-logs-v2';

export async function loadTrackerConfig(): Promise<TrackerConfig> {
  const value = await SecureStore.getItemAsync(configKey);
  if (!value) return defaultTrackerConfig;
  try {
    const saved = JSON.parse(value) as Partial<TrackerConfig>;
    // Phones connected before shifts existed tracked whenever connected: that was "on duty".
    const duty: Duty = saved.duty ?? { status: saved.credential ? 'on' : 'off' };
    return { ...defaultTrackerConfig, ...saved, duty };
  } catch {
    return defaultTrackerConfig;
  }
}

/** Read-modify-write, so a change from the UI and one from the background task do not clash. */
export async function updateTrackerConfig(change: (config: TrackerConfig) => TrackerConfig) {
  const next = change(await loadTrackerConfig());
  await saveTrackerConfig(next);
  return next;
}

export async function clearTrackerConfig() {
  await SecureStore.deleteItemAsync(configKey);
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
