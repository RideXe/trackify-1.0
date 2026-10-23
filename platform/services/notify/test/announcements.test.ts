import type { SNSEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import type { Channels } from '../src/channels';

process.env.CORE_TABLE = 'core';
const { createAnnouncementHandler } = await import('../src/announcements');

const channels = () =>
  ({
    email: vi.fn().mockResolvedValue(undefined),
    sms: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    telegram: vi.fn().mockResolvedValue(undefined),
    whatsapp: vi.fn().mockResolvedValue(undefined),
    pushover: vi.fn().mockResolvedValue(undefined),
  }) satisfies Channels;

const event = {
  Records: [{ Sns: { Message: JSON.stringify({ tenantId: 't', announcementId: 'a1' }) } }],
} as SNSEvent;

describe('announcements', () => {
  it('reaches every active user, whatever their role or groups', async () => {
    const send = channels();
    const web = { publish: vi.fn().mockResolvedValue(undefined) };
    const deliveries = await createAnnouncementHandler(
      {
        announcement: vi.fn().mockResolvedValue({
          tenantId: 't',
          announcementId: 'a1',
          title: 'Diwali holiday',
          message: 'Depot closed <Monday>',
          channels: ['web', 'email'],
        }),
        users: vi.fn().mockResolvedValue([
          { userId: 'a', role: 'admin', enabled: true, groupIds: [], email: 'a@x.in' },
          { userId: 'v', role: 'viewer', enabled: true, groupIds: ['north'], email: 'v@x.in' },
          { userId: 'off', role: 'viewer', enabled: false, groupIds: [], email: 'off@x.in' },
        ]),
        pushTokens: vi.fn().mockResolvedValue([]),
        forgetPushToken: vi.fn(),
      },
      send,
      web,
    )(event);
    expect(deliveries.filter((delivery) => delivery.outcome === 'sent')).toHaveLength(4);
    expect(send.email.mock.calls.map(([to]) => String(to))).toEqual(['a@x.in', 'v@x.in']);
    expect((send.email.mock.calls[0]?.[1] as { html: string }).html).toContain('&#60;Monday&#62;');
    expect(web.publish).toHaveBeenCalledWith(
      't',
      'v',
      expect.objectContaining({ kind: 'announcement' }),
    );
  });
});
