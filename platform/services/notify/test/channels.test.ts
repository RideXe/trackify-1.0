import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { SESv2Client } from '@aws-sdk/client-sesv2';
import type { SNSClient } from '@aws-sdk/client-sns';
import { ChannelUnavailableError, LiveChannels, signJwt, StaleTokenError } from '../src/channels';

const message = { title: 'Van: alarm!', text: 'Van alarm: SOS', html: '<p>Van</p>' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function live(secret: object | undefined, fetcher = vi.fn(), now = () => 1_000_000) {
  const ses = { send: vi.fn().mockResolvedValue({}) };
  const sns = { send: vi.fn().mockResolvedValue({}) };
  const secrets = {
    send: vi.fn().mockResolvedValue({ SecretString: JSON.stringify(secret ?? {}) }),
  };
  const channels = new LiveChannels({
    ses: ses as unknown as SESv2Client,
    sns: sns as unknown as SNSClient,
    secrets: secrets as unknown as SecretsManagerClient,
    secretId: secret ? 'secret' : undefined,
    emailSender: 'alerts@example.com',
    fetcher: fetcher,
    now,
  });
  return { channels, ses, sns, secrets, fetcher };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('channels', () => {
  it('emails text and HTML from the configured sender', async () => {
    const { channels, ses } = live(undefined);
    await channels.email('asha@example.com', message);
    const input = (ses.send.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({
      FromEmailAddress: 'alerts@example.com',
      Destination: { ToAddresses: ['asha@example.com'] },
    });
  });

  it('sends SMS as transactional so it is not filtered as marketing', async () => {
    const { channels, sns } = live(undefined);
    await channels.sms('+919876543210', message);
    const input = (sns.send.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ PhoneNumber: '+919876543210', Message: 'Van alarm: SOS' });
  });

  it('skips third-party channels whose credentials are missing', async () => {
    const { channels } = live({});
    await expect(channels.telegram('1', message)).rejects.toBeInstanceOf(ChannelUnavailableError);
    await expect(channels.push('t', message, {})).rejects.toBeInstanceOf(ChannelUnavailableError);
  });

  it('signs a verifiable RS256 service-account JWT', () => {
    const token = signJwt({ iss: 'svc@example.iam' }, pem);
    const [header, claims, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const verifier = createVerify('RSA-SHA256').update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, signature!, 'base64url')).toBe(true);
  });

  it('authenticates to FCM once and reuses the access token', async () => {
    const fetcher = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('oauth2')
          ? json({ access_token: 'access', expires_in: 3600 })
          : json({ name: 'projects/p/messages/1' }),
      ),
    );
    const fcm = { projectId: 'p', clientEmail: 'svc@example.iam', privateKey: pem };
    const { channels } = live({ fcm }, fetcher);
    await channels.push('token-1', message, { eventId: 'e1' });
    await channels.push('token-2', message, { eventId: 'e2' });
    const urls = fetcher.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url.includes('oauth2'))).toHaveLength(1);
    const send = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(send[0]).toBe('https://fcm.googleapis.com/v1/projects/p/messages:send');
    expect((send[1].headers as Record<string, string>).authorization).toBe('Bearer access');
    expect(JSON.parse(send[1].body as string)).toMatchObject({
      message: { token: 'token-1', notification: { title: 'Van: alarm!' } },
    });
  });

  it('marks tokens FCM reports as unregistered as stale', async () => {
    const fetcher = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('oauth2')
          ? json({ access_token: 'access', expires_in: 3600 })
          : json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, 404),
      ),
    );
    const fcm = { projectId: 'p', clientEmail: 'svc@example.iam', privateKey: pem };
    const { channels } = live({ fcm }, fetcher);
    await expect(channels.push('old', message, {})).rejects.toBeInstanceOf(StaleTokenError);
  });

  it('posts Telegram, WhatsApp template and Pushover messages', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true }));
    const { channels } = live(
      {
        telegram: { botToken: 'bot' },
        whatsapp: { token: 'wa', phoneNumberId: '123', templateName: 'alert' },
        pushover: { appToken: 'app' },
      },
      fetcher,
    );
    await channels.telegram('42', message);
    await channels.whatsapp('+919876543210', message);
    await channels.pushover('u'.repeat(30), message);
    const calls = fetcher.mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe('https://api.telegram.org/botbot/sendMessage');
    expect(JSON.parse(calls[1]?.[1].body as string)).toMatchObject({
      to: '919876543210',
      type: 'template',
      template: { name: 'alert', language: { code: 'en' } },
    });
    expect(String(calls[2]?.[1].body as URLSearchParams)).toContain('user=uuuuu');
  });

  it('reads credentials once per five minutes', async () => {
    let now = 0;
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true }));
    const { channels, secrets } = live({ telegram: { botToken: 'bot' } }, fetcher, () => now);
    await channels.telegram('1', message);
    await channels.telegram('1', message);
    now = 5 * 60_000 + 1;
    await channels.telegram('1', message);
    expect(secrets.send).toHaveBeenCalledTimes(2);
  });
});
