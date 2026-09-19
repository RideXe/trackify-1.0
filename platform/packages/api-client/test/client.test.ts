import { afterEach, describe, expect, it, vi } from 'vitest';
import { CognitoPasswordClient, TrackifyClient, tokenExpired } from '../src';

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
});
