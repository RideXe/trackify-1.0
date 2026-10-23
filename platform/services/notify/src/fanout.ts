import type { FleetUser, PushToken } from '@trackify/data';
import type { NotificationChannel } from '@trackify/domain';
import { ChannelUnavailableError, StaleTokenError, type Channels } from './channels';
import type { Message } from './format';

export interface WebPublisher {
  publish(tenantId: string, userId: string, notification: Record<string, unknown>): Promise<void>;
}

export interface PushRegistry {
  pushTokens(tenantId: string, userId: string): Promise<PushToken[]>;
  forgetPushToken(tenantId: string, userId: string, tokenId: string): Promise<void>;
}

export interface Delivery {
  /** The alert rule or announcement this delivery is for. */
  source: string;
  channel: NotificationChannel;
  userId?: string;
  outcome: 'sent' | 'skipped' | 'failed';
  reason?: string;
}

export interface FanOut {
  tenantId: string;
  source: string;
  recipients: FleetUser[];
  channels: NotificationChannel[];
  message: Message;
  /** What web and push receivers get alongside the text. */
  notification: Record<string, string | number>;
}

/**
 * Sends one message to each recipient on each person-facing channel. A missing contact detail is
 * a skip, a provider error a failure; neither stops the other deliveries, and nothing throws.
 */
export function fanOut(
  deps: { channels: Channels; web?: WebPublisher; push: PushRegistry },
  request: FanOut,
): Promise<Delivery[]> {
  const { tenantId, source, message, notification } = request;
  const attempts: Array<Promise<Delivery>> = [];
  const attempt = (channel: NotificationChannel, userId: string, send: () => Promise<unknown>) =>
    attempts.push(
      send().then(
        (): Delivery => ({ source, channel, userId, outcome: 'sent' }),
        (error: unknown): Delivery => ({
          source,
          channel,
          userId,
          outcome: error instanceof ChannelUnavailableError ? 'skipped' : 'failed',
          reason: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
  const skip = (channel: NotificationChannel, userId: string, reason: string) =>
    attempts.push(Promise.resolve({ source, channel, userId, outcome: 'skipped', reason }));

  for (const channel of request.channels) {
    if (channel === 'command') continue;
    for (const user of request.recipients) {
      const { userId } = user;
      switch (channel) {
        case 'web':
          if (deps.web)
            attempt(channel, userId, () => deps.web!.publish(tenantId, userId, notification));
          else skip(channel, userId, 'realtime is not configured');
          break;
        case 'email':
          if (user.email) attempt(channel, userId, () => deps.channels.email(user.email!, message));
          else skip(channel, userId, 'no email address');
          break;
        case 'sms':
        case 'whatsapp':
          if (user.phone) {
            const phone = user.phone;
            attempt(channel, userId, () =>
              channel === 'sms'
                ? deps.channels.sms(phone, message)
                : deps.channels.whatsapp(phone, message),
            );
          } else skip(channel, userId, 'no phone number');
          break;
        case 'telegram':
          if (user.telegramChatId)
            attempt(channel, userId, () => deps.channels.telegram(user.telegramChatId!, message));
          else skip(channel, userId, 'no Telegram chat');
          break;
        case 'pushover':
          if (user.pushoverUserKey)
            attempt(channel, userId, () => deps.channels.pushover(user.pushoverUserKey!, message));
          else skip(channel, userId, 'no Pushover key');
          break;
        case 'push':
          attempt(channel, userId, () => push(deps, tenantId, userId, message, notification));
          break;
      }
    }
  }
  return Promise.all(attempts);
}

/** Sends to every registered phone and browser of the user; dead tokens are forgotten. */
async function push(
  deps: { channels: Channels; push: PushRegistry },
  tenantId: string,
  userId: string,
  message: Message,
  notification: Record<string, string | number>,
) {
  const tokens = await deps.push.pushTokens(tenantId, userId);
  if (!tokens.length) throw new ChannelUnavailableError('no registered devices');
  const data = Object.fromEntries(
    Object.entries(notification).map(([key, value]) => [key, String(value)]),
  );
  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        await deps.channels.push(token.token, message, data);
      } catch (error) {
        if (error instanceof StaleTokenError)
          await deps.push.forgetPushToken(tenantId, userId, token.tokenId);
        throw error;
      }
    }),
  );
  if (!results.some((result) => result.status === 'fulfilled'))
    throw new Error('push failed on every registered device');
}
