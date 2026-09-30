import { beforeEach, describe, expect, it, vi } from 'vitest';

const { values } = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('./secure-store', () => ({
  getItemAsync: (key: string) => Promise.resolve(values.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    values.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    values.delete(key);
    return Promise.resolve();
  },
}));
// Native tracking is not available under Node; these tests cover the decisions around it.
vi.mock('./tracking', () => ({}));
vi.mock('../native/NativeTrackifyLocation', () => ({ default: {} }));

import { flushActivity, pendingActivityCount, sendActivity } from './activity-queue';
import { extractCode } from './connection';
import { pauseExpired, sharesLocation } from './duty';
import { parseDecimal } from './format';
import { problemsIn } from './health';
import { defaultTrackerConfig, loadTrackerConfig, type TrackerConfig } from './storage';
import { languages, stringTables, translate, type StringKey } from '../i18n';

const config: TrackerConfig = {
  ...defaultTrackerConfig,
  deviceId: 'car-1',
  uniqueId: 'phone-1',
  endpoint: 'https://api.example/phone/positions',
  credential: 'secret',
  duty: { status: 'on' },
};

beforeEach(() => {
  values.clear();
  vi.unstubAllGlobals();
});

describe('pauses', () => {
  it('shares location on shift, never while paused, and again once the limit passes', () => {
    const paused = { status: 'paused' as const, reason: 'break' as const, until: 1_000 };
    expect(sharesLocation({ status: 'on' }, 0)).toBe(true);
    expect(sharesLocation({ status: 'off' }, 0)).toBe(false);
    expect(sharesLocation(paused, 999)).toBe(false);
    expect(pauseExpired(paused, 1_000)).toBe(true);
    expect(sharesLocation(paused, 1_000)).toBe(true);
  });
});

describe('health warnings', () => {
  const healthy = {
    batteryPct: 80,
    charging: false,
    locationEnabled: true,
    permitted: true,
    running: true,
  };

  it('reports nothing off duty, whatever the phone state', () => {
    expect(
      problemsIn({ ...config, duty: { status: 'off' } }, { ...healthy, locationEnabled: false }),
    ).toEqual([]);
  });

  it('flags low battery only when not charging, and each tracking blocker', () => {
    expect(problemsIn(config, { ...healthy, batteryPct: 10 })).toEqual(['battery-low']);
    expect(problemsIn(config, { ...healthy, batteryPct: 10, charging: true })).toEqual([]);
    expect(
      problemsIn(config, { ...healthy, locationEnabled: false, permitted: false, running: false }),
    ).toEqual(['gps-off', 'permission-revoked', 'tracking-stopped']);
  });
});

describe('offline queue for driver actions', () => {
  it('sends in order and reports sent when the server accepts', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('{}', { status: 201 })));
    vi.stubGlobal('fetch', fetch);
    expect(await sendActivity(config, { type: 'shift-start', at: 1 })).toBe('sent');
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.example/phone/activity');
    expect(await pendingActivityCount()).toBe(0);
  });

  it('keeps an SOS on the phone without signal and sends it later, oldest first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    expect(await sendActivity(config, { type: 'pause', reason: 'break', at: 1 })).toBe('queued');
    expect(await sendActivity(config, { type: 'sos', at: 2 })).toBe('queued');
    expect(await pendingActivityCount()).toBe(2);

    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(new Response('{}', { status: 201 })));
    vi.stubGlobal('fetch', fetch);
    expect(await flushActivity(config)).toBe(true);
    expect(
      fetch.mock.calls.map(
        (call) => (JSON.parse(call[1]?.body as string) as { type: string }).type,
      ),
    ).toEqual(['pause', 'sos']);
  });

  it('drops an action the server refuses instead of retrying it forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response('{"message":"bad"}', { status: 400 })),
        ),
    );
    expect(await sendActivity(config, { type: 'issue', at: 1 })).toBe('sent');
    expect(await pendingActivityCount()).toBe(0);
  });

  it('stops with a disconnect when the administrator revoked the phone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    await expect(sendActivity(config, { type: 'sos', at: 1 })).rejects.toMatchObject({
      name: 'DisconnectedError',
    });
  });
});

describe('disconnects', () => {
  it('ignores a 401 in the first two minutes, while the server catches up with a new phone', async () => {
    const { DisconnectedError, isRevoked } = await import('./phone-api');
    const error = new DisconnectedError();
    expect(isRevoked(error, { connectedAt: 1_000 }, 60_000)).toBe(false);
    expect(isRevoked(error, { connectedAt: 1_000 }, 200_000)).toBe(true);
    expect(isRevoked(new Error('offline'), { connectedAt: 0 }, 200_000)).toBe(false);
  });
});

describe('stored settings', () => {
  it('treats a phone connected before shifts existed as on duty, so tracking carries on', async () => {
    values.set('tracker-config-v2', JSON.stringify({ credential: 'old', deviceId: 'car-1' }));
    expect((await loadTrackerConfig()).duty.status).toBe('on');
    values.set('tracker-config-v2', JSON.stringify({ deviceId: 'car-1' }));
    expect((await loadTrackerConfig()).duty.status).toBe('off');
  });
});

describe('setup codes and numbers', () => {
  it('reads a code typed with spaces or inside a setup link', () => {
    expect(extractCode(' ab7 mk9 ')).toBe('AB7MK9');
    expect(extractCode('https://dash.example/onboard/#AB7MK9')).toBe('AB7MK9');
    expect(extractCode('hello')).toBe('');
  });

  it('accepts a decimal comma and rejects nonsense', () => {
    expect(parseDecimal('30,5')).toBe(30.5);
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('abc')).toBeUndefined();
  });
});

describe('translations', () => {
  // Missing keys are a type error (every table is typed against English); placeholders are not.
  it('keeps the same {placeholders} as English in every language', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [code, table] of Object.entries(stringTables))
      for (const [key, text] of Object.entries(table))
        expect(placeholders(text), `${code}.${key}`).toEqual(
          placeholders(stringTables.en[key as StringKey]),
        );
  });

  it('fills placeholders in the chosen language', () => {
    expect(translate('hi', 'connectedTo', { organisation: 'Acme' })).toBe('Acme से जुड़ा है');
    expect(languages.map((language) => language.code)).toEqual(['en', 'kn', 'hi', 'ta']);
  });
});
