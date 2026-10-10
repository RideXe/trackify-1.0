import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { Announcement, ShareLink } from '@trackify/data';
import { describe, expect, it, vi } from 'vitest';
import { createExtraRoutes, type ExtrasData, type ShareStore } from '../src/extras';
import { InputError } from '../src/http';

process.env.CORE_TABLE = 'core';
process.env.DEVICE_STATE_TABLE = 'state';
const { createSharedHandler } = await import('../src/shared');

const NOW = 1_760_000_000_000;

function request(
  method: string,
  rawPath: string,
  body?: unknown,
  query: Record<string, string> = {},
) {
  return {
    rawPath,
    body: body === undefined ? undefined : JSON.stringify(body),
    queryStringParameters: query,
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const member = (role: 'admin' | 'dispatcher' | 'viewer' = 'admin', groupIds: string[] = []) => ({
  tenantId: 't',
  userId: 'u',
  email: 'asha@example.com',
  role,
  groupIds,
});

function data(): ExtrasData {
  return {
    getDevice: vi.fn((_t: string, id: string) =>
      Promise.resolve(id === 'van' ? { deviceId: 'van', groupId: 'north' } : undefined),
    ),
    listDevices: vi
      .fn()
      .mockResolvedValue([
        { deviceId: 'van', state: { status: 'online' } },
        { deviceId: 'bus', state: { status: 'offline' } },
        { deviceId: 'car' },
      ]),
    listUsers: vi.fn().mockResolvedValue([{ enabled: true }, { enabled: false }]),
    tenantEvents: vi.fn().mockResolvedValue([{}, {}, {}]),
    openAlerts: vi.fn().mockResolvedValue(2),
  };
}

function shares() {
  return {
    create: vi.fn((input: object) =>
      Promise.resolve({
        ...input,
        shareId: 'a'.repeat(32),
        createdAt: NOW,
        token: 'T'.repeat(32),
      } as ShareLink & { token: string }),
    ),
    list: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue(true),
  } satisfies ShareStore;
}

async function call(
  routes: ReturnType<typeof createExtraRoutes>,
  ...args: Parameters<typeof routes>
) {
  try {
    return await routes(...args);
  } catch (error) {
    if (error instanceof InputError) return { statusCode: 400, body: error.message, headers: {} };
    throw error;
  }
}

describe('share links', () => {
  it('creates an expiring link and shows the token only inside the URL', async () => {
    const store = shares();
    const routes = createExtraRoutes(
      data(),
      { shares: store, shareBaseUrl: 'https://fleet.example/' },
      () => NOW,
    );
    const result = await call(
      routes,
      request('POST', '/devices/van/shares', { expiresInHours: 48 }),
      member('dispatcher'),
    );
    expect(result?.statusCode).toBe(201);
    const body = JSON.parse(result!.body) as Record<string, unknown>;
    expect(body.url).toBe(`https://fleet.example/shared/#${'T'.repeat(32)}`);
    expect(body).not.toHaveProperty('token');
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'van', expiresAtMs: NOW + 48 * 3_600_000 }),
    );
  });

  it('refuses viewers, other groups’ vehicles and links longer than a week', async () => {
    const routes = createExtraRoutes(
      data(),
      { shares: shares(), shareBaseUrl: 'https://x' },
      () => NOW,
    );
    expect(
      (await call(routes, request('POST', '/devices/van/shares'), member('viewer')))?.statusCode,
    ).toBe(403);
    expect(
      (await call(routes, request('POST', '/devices/van/shares'), member('dispatcher', ['south'])))
        ?.statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          routes,
          request('POST', '/devices/van/shares', { expiresInHours: 500 }),
          member(),
        )
      )?.statusCode,
    ).toBe(400);
  });

  it('revokes a link', async () => {
    const store = shares();
    const routes = createExtraRoutes(data(), { shares: store, shareBaseUrl: 'https://x' });
    const result = await call(
      routes,
      request('DELETE', `/devices/van/shares/${'a'.repeat(32)}`),
      member(),
    );
    expect(result?.statusCode).toBe(204);
    expect(store.revoke).toHaveBeenCalledWith('t', 'van', 'a'.repeat(32));
  });
});

describe('public shared location', () => {
  const handler = (resolve: (token: string) => Promise<ShareLink | undefined>) =>
    createSharedHandler({
      resolve,
      device: vi.fn().mockResolvedValue({ name: 'Van' }),
      state: vi.fn().mockResolvedValue({
        latitude: 12.97,
        longitude: 77.59,
        speedKmh: 30,
        fixTime: NOW,
        tenantId: 't',
      }),
    });
  const get = (path: string) => ({ rawPath: path }) as APIGatewayProxyEventV2;

  it('returns only the vehicle name and live position', async () => {
    const result = await handler(
      vi.fn().mockResolvedValue({ tenantId: 't', deviceId: 'van', expiresAtMs: NOW + 1 }),
    )(get(`/shared/${'T'.repeat(32)}`));
    expect(JSON.parse(result.body)).toEqual({
      name: 'Van',
      expiresAt: NOW + 1,
      position: { latitude: 12.97, longitude: 77.59, speedKmh: 30, courseDeg: 0, fixTime: NOW },
    });
  });

  it('answers the same for malformed, unknown or expired links', async () => {
    const missing = handler(vi.fn().mockResolvedValue(undefined));
    for (const path of ['/shared/short', `/shared/${'T'.repeat(32)}`])
      expect((await missing(get(path))).statusCode).toBe(404);
  });
});

describe('audit, statistics and announcements', () => {
  it('lists the audit log for administrators, within a year', async () => {
    const audit = { list: vi.fn().mockResolvedValue([]) };
    const routes = createExtraRoutes(data(), { audit, shareBaseUrl: 'x' }, () => NOW);
    expect((await call(routes, request('GET', '/audit'), member()))?.statusCode).toBe(200);
    expect(audit.list).toHaveBeenCalledWith('t', NOW - 7 * 86_400_000, NOW, 500);
    expect((await call(routes, request('GET', '/audit'), member('dispatcher')))?.statusCode).toBe(
      403,
    );
  });

  it('summarises the fleet', async () => {
    const result = await call(
      createExtraRoutes(data(), { shareBaseUrl: 'x' }),
      request('GET', '/statistics'),
      member(),
    );
    expect(JSON.parse(result!.body)).toEqual({
      vehicles: 3,
      online: 1,
      offline: 2,
      users: 2,
      activeUsers: 1,
      eventsLast24h: 3,
      eventsLast24hCapped: false,
      openAlerts: 2,
    });
  });

  it('stores an announcement and hands it on for delivery', async () => {
    const announcements = {
      create: vi.fn((input: object) =>
        Promise.resolve({ ...input, announcementId: 'a1' } as Announcement),
      ),
      active: vi.fn().mockResolvedValue([]),
    };
    const queue = { publish: vi.fn().mockResolvedValue(undefined) };
    const routes = createExtraRoutes(
      data(),
      { announcements, announcementQueue: queue, shareBaseUrl: 'x' },
      () => NOW,
    );
    const result = await call(
      routes,
      request('POST', '/announcements', {
        title: ' Holiday ',
        message: 'Depot closed',
        channels: ['web', 'email'],
      }),
      member(),
    );
    expect(result?.statusCode).toBe(201);
    expect(announcements.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Holiday',
        channels: ['web', 'email'],
        expiresAtMs: NOW + 7 * 86_400_000,
      }),
    );
    expect(queue.publish).toHaveBeenCalledWith('t', 'a1');
    expect(
      (
        await call(
          routes,
          request('POST', '/announcements', { title: 'x', message: 'y', channels: ['command'] }),
          member(),
        )
      )?.statusCode,
    ).toBe(400);
    expect(
      (await call(routes, request('GET', '/announcements'), member('viewer')))?.statusCode,
    ).toBe(200);
  });
});
