import type { ActivityEntry, DutyStatus, PauseReason } from '@trackify/api-client';
import type { TrackerConfig } from './storage';

/** The administrator revoked this phone or removed its vehicle; it must be set up again. */
export class DisconnectedError extends Error {
  constructor(message = 'This phone was disconnected by your fleet administrator.') {
    super(message);
    this.name = 'DisconnectedError';
  }
}

/**
 * Whether a 401 really means the administrator disconnected this phone. Just after setup the
 * server's credential index can lag a few seconds behind, so a brand-new phone briefly gets 401s
 * that must not wipe its connection.
 */
export function isRevoked(
  error: unknown,
  config: Pick<TrackerConfig, 'connectedAt'>,
  now = Date.now(),
) {
  return error instanceof DisconnectedError && now - config.connectedAt > 120_000;
}

export interface PhoneSettings {
  organisation?: string;
  dispatcherPhone?: string;
  vehicleName: string;
  driverName?: string;
  trackerIntervalSeconds: number;
  pauseLimitMinutes: number;
  dutyStatus: DutyStatus;
  dutySince?: number;
  pauseReason?: PauseReason;
  pauseUntil?: number;
}

export interface TodaySummary {
  trips: number;
  distanceM: number;
  drivingMs: number;
}

/** The setup response gives the positions URL; every phone route sits beside it. */
export function apiBase(endpoint: string) {
  return endpoint.replace(/\/phone\/positions\/?$/, '');
}

export async function phoneRequest<T>(
  config: Pick<TrackerConfig, 'endpoint' | 'credential'>,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${apiBase(config.endpoint)}${path}`, {
      method: init.method ?? 'GET',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.credential}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const value = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (response.status === 401) throw new DisconnectedError();
    if (!response.ok)
      throw new RejectedError(value.message ?? `HTTP ${response.status}`, response.status);
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/** The server answered and refused; unlike a network failure, retrying will not help. */
export class RejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RejectedError';
  }
}

export function fetchPhoneSettings(config: TrackerConfig) {
  return phoneRequest<PhoneSettings>(config, '/phone/config');
}

export async function fetchMessages(config: TrackerConfig, since: number) {
  const result = await phoneRequest<{ items: ActivityEntry[] }>(
    config,
    `/phone/messages?since=${Math.max(0, Math.floor(since))}`,
  );
  return result.items;
}

export function fetchToday(config: TrackerConfig, from: number) {
  return phoneRequest<TodaySummary>(config, `/phone/today?from=${Math.floor(from)}`);
}

/** Uploads a photo taken with the camera and returns the key to attach to a report. */
export async function uploadPhoto(config: TrackerConfig, uri: string): Promise<string> {
  const { photoKey, uploadUrl } = await phoneRequest<{ photoKey: string; uploadUrl: string }>(
    config,
    '/phone/photos',
    { method: 'POST' },
  );
  const photo = await (await fetch(uri)).blob();
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: photo,
  });
  if (!response.ok) throw new Error(`Photo upload failed (${response.status})`);
  return photoKey;
}
