import { afterEach, describe, expect, it, vi } from 'vitest';
import { CognitoPasswordClient, SessionExpiredError, TrackifyClient, tokenExpired } from '../src';

describe('token expiry', () => {
  it('treats malformed tokens as expired', () => expect(tokenExpired('invalid')).toBe(true));
});

describe('Cognito password authentication', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns tokens from a successful username and password sign-in', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          AuthenticationResult: {
            AccessToken: 'access',
            IdToken: 'identity',
            RefreshToken: 'refresh',
            ExpiresIn: 3600,
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    const result = await new CognitoPasswordClient({
      awsRegion: 'ap-south-1',
      clientId: 'client-id',
    }).signIn('driver@example.com', 'Password123');

    expect(result).toEqual({
      status: 'authenticated',
      tokens: {
        access_token: 'access',
        id_token: 'identity',
        refresh_token: 'refresh',
        expires_in: 3600,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://cognito-idp.ap-south-1.amazonaws.com/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns the first-login password challenge', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'session' }),
          ),
        ),
    );

    await expect(
      new CognitoPasswordClient({ awsRegion: 'ap-south-1', clientId: 'client-id' }).signIn(
        'driver@example.com',
        'Temporary123',
      ),
    ).resolves.toEqual({
      status: 'new-password-required',
      username: 'driver@example.com',
      session: 'session',
    });
  });
});

describe('session renewal', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renews tokens with the refresh token and keeps it when Cognito does not rotate it', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ AuthenticationResult: { AccessToken: 'new-access' } })),
      );
    vi.stubGlobal('fetch', fetch);

    const tokens = await new CognitoPasswordClient({
      awsRegion: 'ap-south-1',
      clientId: 'client-id',
    }).refresh('refresh-token');

    expect(tokens).toEqual(
      expect.objectContaining({ access_token: 'new-access', refresh_token: 'refresh-token' }),
    );
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: 'client-id',
      AuthParameters: { REFRESH_TOKEN: 'refresh-token' },
    });
  });
});

const apiConfig = {
  apiUrl: 'https://api.example.com',
  awsRegion: 'ap-south-1',
  clientId: 'client-id',
  realtimeDns: 'realtime.example.com',
};

function bearer(call: Parameters<typeof globalThis.fetch> | undefined) {
  return (call?.[1]?.headers as Record<string, string> | undefined)?.authorization;
}

describe('expired sign-in', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renews once after a 401 and retries with the new token', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    vi.stubGlobal('fetch', fetch);
    const renew = vi.fn().mockResolvedValue('fresh-token');

    await expect(
      new TrackifyClient(apiConfig, () => 'old-token', renew).devices(),
    ).resolves.toEqual({ items: [] });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(bearer)).toEqual(['Bearer old-token', 'Bearer fresh-token']);
  });

  it('reports an expired session when renewal fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const client = new TrackifyClient(
      apiConfig,
      () => 'old-token',
      () => Promise.reject(new Error('refresh token revoked')),
    );
    await expect(client.devices()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('shares one renewal between requests that expire together', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          (init?.headers as Record<string, string>).authorization === 'Bearer fresh-token'
            ? new Response(JSON.stringify({ items: [] }))
            : new Response('{}', { status: 401 }),
        ),
      ),
    );
    const renew = vi.fn(() => Promise.resolve('fresh-token'));
    const client = new TrackifyClient(apiConfig, () => 'old-token', renew);
    await Promise.all([client.devices(), client.devices(), client.me()]);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('keeps 403 as a permission error without renewing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    const renew = vi.fn();
    await expect(new TrackifyClient(apiConfig, () => 'token', renew).devices()).rejects.toThrow(
      'Access denied',
    );
    expect(renew).not.toHaveBeenCalled();
  });
});

describe('fleet client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a device with the signed-in administrator token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          deviceId: 'device-1',
          name: 'Delivery Van 1',
          uniqueId: '123456789012345',
          protocol: 'gt06',
          groupId: 'UNGROUPED',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const client = new TrackifyClient(
      {
        apiUrl: 'https://api.example.com',
        awsRegion: 'ap-south-1',
        clientId: 'client-id',
        realtimeDns: 'realtime.example.com',
      },
      () => 'access-token',
    );

    await client.createDevice({
      name: 'Delivery Van 1',
      uniqueId: '123456789012345',
      protocol: 'gt06',
    });

    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.example.com/devices');
    expect(fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer access-token',
          'content-type': 'application/json',
        },
      }),
    );
  });

  it('changes a vehicle type with PATCH', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ deviceId: 'device-1', vehicleType: 'bus' })),
      );
    vi.stubGlobal('fetch', fetch);
    await new TrackifyClient(apiConfig, () => 'access-token').updateDevice('device 1', {
      vehicleType: 'bus',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.example.com/devices/device%201');
    expect(fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ vehicleType: 'bus' }) }),
    );
  });

  it('removes a vehicle with DELETE and does not choke on the empty 204 body', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      new TrackifyClient(apiConfig, () => 'access-token').deleteDevice('device 1'),
    ).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.example.com/devices/device%201');
    expect(fetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('drivers client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds, edits and removes drivers on the drivers routes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ driverId: 'd 1', name: 'Ramesh' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ driverId: 'd 1', name: 'Ramesh' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const client = new TrackifyClient(apiConfig, () => 'access-token');

    await client.createDriver({ name: 'Ramesh' });
    await client.updateDriver('d 1', { phone: null });
    await expect(client.deleteDriver('d 1')).resolves.toBeUndefined();

    expect(fetch.mock.calls.map((call) => [call[0], call[1]?.method, call[1]?.body])).toEqual([
      ['https://api.example.com/drivers', 'POST', JSON.stringify({ name: 'Ramesh' })],
      ['https://api.example.com/drivers/d%201', 'PATCH', JSON.stringify({ phone: null })],
      ['https://api.example.com/drivers/d%201', 'DELETE', undefined],
    ]);
  });

  it('sends null to unassign a driver, so the field is cleared rather than skipped', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ deviceId: 'device-1' })));
    vi.stubGlobal('fetch', fetch);
    await new TrackifyClient(apiConfig, () => 'access-token').updateDevice('device-1', {
      driverId: null,
    });
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ driverId: null }));
  });
});

describe('alerts and driver activity client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('acknowledges alerts and sends messages on their routes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    const client = new TrackifyClient(apiConfig, () => 'access-token');
    await client.acknowledgeAlert('01JALERT');
    await client.sendMessage('device 1', 'Go to depot');
    await client.activity('device 1', 5, 10);
    expect(fetch.mock.calls.map((call) => [call[0], call[1]?.method, call[1]?.body])).toEqual([
      [
        'https://api.example.com/alerts/01JALERT',
        'PATCH',
        JSON.stringify({ status: 'acknowledged' }),
      ],
      [
        'https://api.example.com/devices/device%201/messages',
        'POST',
        JSON.stringify({ text: 'Go to depot' }),
      ],
      ['https://api.example.com/devices/device%201/activity?from=5&to=10', undefined, undefined],
    ]);
  });
});
