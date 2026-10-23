import { createSign } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { Message } from './format';

/**
 * Third-party credentials, kept in one Secrets Manager secret as JSON. Every section is optional;
 * a channel without its section is skipped with a log line rather than failing the event.
 */
export interface ChannelCredentials {
  fcm?: { projectId: string; clientEmail: string; privateKey: string };
  telegram?: { botToken: string };
  whatsapp?: {
    token: string;
    phoneNumberId: string;
    templateName: string;
    templateLanguage?: string;
  };
  pushover?: { appToken: string };
}

export class ChannelUnavailableError extends Error {}

/** Thrown when a push token is no longer valid, so the caller can forget it. */
export class StaleTokenError extends Error {}

export interface Attachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface Channels {
  email(to: string, message: Message): Promise<void>;
  sms(phone: string, message: Message): Promise<void>;
  push(token: string, message: Message, data: Record<string, string>): Promise<void>;
  telegram(chatId: string, message: Message): Promise<void>;
  whatsapp(phone: string, message: Message): Promise<void>;
  pushover(userKey: string, message: Message): Promise<void>;
}

const CREDENTIAL_TTL_MS = 5 * 60_000;

export class LiveChannels implements Channels {
  private credentials?: { value: ChannelCredentials; expires: number };
  private fcmToken?: { value: string; expires: number };

  constructor(
    private readonly options: {
      ses: SESv2Client;
      sns: SNSClient;
      secrets: SecretsManagerClient;
      secretId?: string;
      emailSender?: string;
      fetcher?: typeof fetch;
      now?: () => number;
    },
  ) {}

  async email(to: string, message: Message) {
    if (!this.options.emailSender) throw new ChannelUnavailableError('no email sender configured');
    await this.options.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.options.emailSender,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: message.title, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              Html: { Data: message.html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
  }

  /** Raw MIME, the only way SES sends attachments. */
  async emailWithAttachment(to: string, message: Message, attachment: Attachment) {
    if (!this.options.emailSender) throw new ChannelUnavailableError('no email sender configured');
    await this.options.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.options.emailSender,
        Destination: { ToAddresses: [to] },
        Content: {
          Raw: {
            Data: Buffer.from(mimeMessage(this.options.emailSender, to, message, attachment)),
          },
        },
      }),
    );
  }

  async sms(phone: string, message: Message) {
    await this.options.sns.send(
      new PublishCommand({
        PhoneNumber: phone,
        Message: message.text.slice(0, 1_000),
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
        },
      }),
    );
  }

  async push(token: string, message: Message, data: Record<string, string>) {
    const fcm = (await this.loadCredentials()).fcm;
    if (!fcm) throw new ChannelUnavailableError('FCM credentials are not configured');
    const result = await this.fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.fcmAccessToken(fcm)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: { token, notification: { title: message.title, body: message.text }, data },
        }),
      },
    );
    if (result.status === 404 || result.status === 410) throw new StaleTokenError('token expired');
    if (!result.ok) {
      const body = await result.text();
      if (body.includes('UNREGISTERED') || body.includes('INVALID_ARGUMENT'))
        throw new StaleTokenError('token rejected');
      throw new Error(`FCM send failed: ${result.status}`);
    }
  }

  async telegram(chatId: string, message: Message) {
    const telegram = (await this.loadCredentials()).telegram;
    if (!telegram) throw new ChannelUnavailableError('Telegram bot token is not configured');
    await this.ok(
      this.fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message.text }),
      }),
      'Telegram',
    );
  }

  /** WhatsApp only allows business-initiated messages through an approved template. */
  async whatsapp(phone: string, message: Message) {
    const whatsapp = (await this.loadCredentials()).whatsapp;
    if (!whatsapp) throw new ChannelUnavailableError('WhatsApp credentials are not configured');
    await this.ok(
      this.fetch(
        `https://graph.facebook.com/v22.0/${encodeURIComponent(whatsapp.phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${whatsapp.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone.replace(/^\+/, ''),
            type: 'template',
            template: {
              name: whatsapp.templateName,
              language: { code: whatsapp.templateLanguage ?? 'en' },
              components: [{ type: 'body', parameters: [{ type: 'text', text: message.text }] }],
            },
          }),
        },
      ),
      'WhatsApp',
    );
  }

  async pushover(userKey: string, message: Message) {
    const pushover = (await this.loadCredentials()).pushover;
    if (!pushover) throw new ChannelUnavailableError('Pushover app token is not configured');
    await this.ok(
      this.fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        body: new URLSearchParams({
          token: pushover.appToken,
          user: userKey,
          title: message.title,
          message: message.text,
        }),
      }),
      'Pushover',
    );
  }

  private async loadCredentials(): Promise<ChannelCredentials> {
    const now = this.now();
    if (this.credentials && this.credentials.expires > now) return this.credentials.value;
    if (!this.options.secretId) return {};
    const result = await this.options.secrets.send(
      new GetSecretValueCommand({ SecretId: this.options.secretId }),
    );
    const value = JSON.parse(result.SecretString ?? '{}') as ChannelCredentials;
    this.credentials = { value, expires: now + CREDENTIAL_TTL_MS };
    return value;
  }

  /** Service-account OAuth: a signed JWT exchanged for a one-hour access token. */
  private async fcmAccessToken(fcm: NonNullable<ChannelCredentials['fcm']>) {
    const now = this.now();
    if (this.fcmToken && this.fcmToken.expires > now) return this.fcmToken.value;
    const issuedAt = Math.floor(now / 1000);
    const assertion = signJwt(
      {
        iss: fcm.clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: issuedAt,
        exp: issuedAt + 3_600,
      },
      fcm.privateKey,
    );
    const result = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!result.ok) throw new Error(`FCM authentication failed: ${result.status}`);
    const body = (await result.json()) as { access_token: string; expires_in: number };
    this.fcmToken = { value: body.access_token, expires: now + (body.expires_in - 60) * 1000 };
    return body.access_token;
  }

  private fetch(url: string, init: RequestInit) {
    return (this.options.fetcher ?? fetch)(url, init);
  }

  private async ok(request: Promise<Response>, service: string) {
    const result = await request;
    if (!result.ok) throw new Error(`${service} send failed: ${result.status}`);
  }

  private now() {
    return (this.options.now ?? Date.now)();
  }
}

export function signJwt(claims: Record<string, unknown>, privateKey: string) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

export function liveChannelsFromEnv() {
  return new LiveChannels({
    ses: new SESv2Client({}),
    sns: new SNSClient({}),
    secrets: new SecretsManagerClient({}),
    secretId: process.env.CHANNEL_SECRET_ID,
    emailSender: process.env.EMAIL_SENDER || undefined,
  });
}

export function mimeMessage(from: string, to: string, message: Message, attachment: Attachment) {
  const boundary = `trackify-${Math.random().toString(36).slice(2)}`;
  const base64 = (value: string) =>
    Buffer.from(value, 'utf8')
      .toString('base64')
      .replace(/.{76}(?=.)/g, '$&\r\n');
  const header = (value: string) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  const filename = attachment.filename.replace(/[^\w.-]/g, '_');
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${header(message.title)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: multipart/alternative; boundary="' + boundary + '-alt"',
    '',
    `--${boundary}-alt`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(message.text),
    `--${boundary}-alt`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(message.html),
    `--${boundary}-alt--`,
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64(attachment.content),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
