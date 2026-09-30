import TrackifyLocation from '../native/NativeTrackifyLocation';
import { fetchPhoneSettings, type PhoneSettings } from './phone-api';
import * as SecureStore from './secure-store';
import {
  clearTrackerConfig,
  defaultTrackerConfig,
  saveTrackerConfig,
  updateTrackerConfig,
  type TrackerConfig,
} from './storage';

const redeemUrl = (code: string) =>
  `https://f128plufw8.execute-api.ap-south-1.amazonaws.com/onboard/${encodeURIComponent(code)}/redeem`;

/** The 6-character code on its own, or inside a pasted setup link; '' when there is none. */
export function extractCode(raw: string) {
  const direct = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (/^[A-HJ-NP-Z2-9]{6}$/.test(direct)) return direct;
  return raw.toUpperCase().match(/(?:ONBOARD[/#?=]+)([A-HJ-NP-Z2-9]{6})(?:$|[^A-Z0-9])/)?.[1] ?? '';
}

/** Redeems a one-time setup code. The code is spent the moment this succeeds. */
export async function connectWithCode(code: string): Promise<TrackerConfig> {
  const response = await fetch(redeemUrl(code), { method: 'POST' });
  const value = (await response.json().catch(() => ({}))) as Partial<TrackerConfig> & {
    message?: string;
  };
  if (!response.ok) throw new Error(value.message || `Setup failed (${response.status})`);
  if (!value.deviceId || !value.uniqueId || !value.name || !value.endpoint || !value.credential)
    throw new Error('Trackify returned incomplete setup information');
  const connected: TrackerConfig = {
    ...defaultTrackerConfig,
    deviceId: value.deviceId,
    uniqueId: value.uniqueId,
    name: value.name,
    endpoint: value.endpoint,
    credential: value.credential,
  };
  // Save before anything else can fail: the code cannot be redeemed a second time.
  await saveTrackerConfig(connected);
  try {
    return await applySettings(await fetchPhoneSettings(connected));
  } catch {
    return connected;
  }
}

/** What the administrator set in the dashboard, copied onto the phone. */
export function applySettings(settings: PhoneSettings) {
  return updateTrackerConfig((current) => ({
    ...current,
    name: settings.vehicleName,
    organisation: settings.organisation,
    dispatcherPhone: settings.dispatcherPhone,
    driverName: settings.driverName,
    intervalSeconds: settings.trackerIntervalSeconds,
    pauseLimitMinutes: settings.pauseLimitMinutes,
  }));
}

/** After the administrator revokes this phone: stop tracking and forget the vehicle. */
export async function forgetConnection() {
  await TrackifyLocation.stop().catch(() => undefined);
  await clearTrackerConfig();
  await SecureStore.deleteItemAsync('activity-queue-v1');
}
