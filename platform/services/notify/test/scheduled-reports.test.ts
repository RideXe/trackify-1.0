import { describe, expect, it, vi } from 'vitest';
import type { FleetUser, ScheduledReport } from '@trackify/data';
import { mimeMessage } from '../src/channels';
import { sendDueReports, type ReportJobData, type ReportMailer } from '../src/scheduled-reports';

const RUN = Date.parse('2026-10-12T06:00:00+05:30');

const report: ScheduledReport = {
  tenantId: 't',
  reportId: 'r1',
  name: 'Morning trips',
  kind: 'summary',
  schedule: 'daily',
  enabled: true,
  deviceIds: [],
  groupIds: [],
  userIds: [],
  nextRunAt: RUN,
};

const user = (userId: string, extra: Partial<FleetUser> = {}): FleetUser => ({
  tenantId: 't',
  userId,
  role: 'admin',
  enabled: true,
  groupIds: [],
  email: `${userId}@example.com`,
  ...extra,
});

function data(overrides: Partial<ReportJobData> = {}) {
  const dailyStats = vi
    .fn()
    .mockResolvedValue([{ sk: '2026-10-11', distanceM: 5_000, tripCount: 1 }]);
  return {
    due: vi.fn().mockResolvedValue([{ tenantId: 't', reportId: 'r1' }]),
    report: vi.fn().mockResolvedValue(report),
    markSent: vi.fn().mockResolvedValue(undefined),
    vehicles: vi.fn().mockResolvedValue([
      { deviceId: 'van', name: 'Van', groupId: 'north' },
      { deviceId: 'bus', name: 'Bus', groupId: 'south' },
    ]),
    users: vi.fn().mockResolvedValue([user('asha'), user('off', { enabled: false })]),
    timeZone: vi.fn().mockResolvedValue('Asia/Kolkata'),
    geofenceNames: vi.fn().mockResolvedValue(new Map()),
    source: vi.fn().mockReturnValue({
      trips: vi.fn().mockResolvedValue([]),
      events: vi.fn().mockResolvedValue([]),
      dailyStats,
      positions: vi.fn().mockResolvedValue([]),
    }),
    ...overrides,
  } satisfies ReportJobData;
}

describe('scheduled reports', () => {
  it('emails yesterday’s report to administrators and schedules tomorrow', async () => {
    const jobs = data();
    const mailer = { emailWithAttachment: vi.fn().mockResolvedValue(undefined) };
    const outcomes = await sendDueReports(jobs, mailer, RUN + 60_000);
    expect(outcomes).toEqual([{ reportId: 'r1', sent: 1 }]);
    const [to, message, attachment] = mailer.emailWithAttachment.mock.calls[0] as [
      string,
      { title: string },
      { filename: string; content: string },
    ];
    expect(to).toBe('asha@example.com');
    expect(message.title).toBe('Morning trips: Summary, 2026-10-11 to 2026-10-11');
    expect(attachment.filename).toBe('summary-2026-10-10.csv');
    expect(attachment.content).toContain('Van,1,5,1,0,0');
    expect(jobs.markSent).toHaveBeenCalledWith(
      report,
      RUN + 60_000,
      Date.parse('2026-10-13T06:00:00+05:30'),
    );
  });

  it('gives a group-limited recipient a copy with only their vehicles', async () => {
    const jobs = data({
      report: vi.fn().mockResolvedValue({ ...report, userIds: ['asha', 'nina'] }),
      users: vi
        .fn()
        .mockResolvedValue([user('asha'), user('nina', { role: 'viewer', groupIds: ['north'] })]),
    });
    const mailer = {
      emailWithAttachment: vi
        .fn<ReportMailer['emailWithAttachment']>()
        .mockResolvedValue(undefined),
    };
    await sendDueReports(jobs, mailer, RUN);
    const byRecipient = Object.fromEntries(
      mailer.emailWithAttachment.mock.calls.map(([to, , attachment]) => [to, attachment.content]),
    );
    expect(byRecipient['asha@example.com']).toContain('Bus');
    expect(byRecipient['nina@example.com']).toContain('Van');
    expect(byRecipient['nina@example.com']).not.toContain('Bus');
  });

  it('skips ahead after an outage instead of sending a backlog', async () => {
    const markSent = vi.fn<ReportJobData['markSent']>().mockResolvedValue(undefined);
    const jobs = data({
      report: vi.fn().mockResolvedValue({ ...report, nextRunAt: RUN - 5 * 86_400_000 }),
      markSent,
    });
    await sendDueReports(
      jobs,
      { emailWithAttachment: vi.fn().mockResolvedValue(undefined) },
      RUN + 1,
    );
    expect(markSent.mock.calls[0]?.[2]).toBe(Date.parse('2026-10-13T06:00:00+05:30'));
  });

  it('keeps going when one report fails, and retries it next time', async () => {
    const jobs = data({
      due: vi.fn().mockResolvedValue([
        { tenantId: 't', reportId: 'broken' },
        { tenantId: 't', reportId: 'r1' },
      ]),
      report: vi.fn((_t: string, id: string) =>
        id === 'broken' ? Promise.reject(new Error('throttled')) : Promise.resolve(report),
      ),
    });
    const outcomes = await sendDueReports(
      jobs,
      { emailWithAttachment: vi.fn().mockResolvedValue(undefined) },
      RUN,
    );
    expect(outcomes.map((outcome) => [outcome.reportId, outcome.error])).toEqual([
      ['broken', 'throttled'],
      ['r1', undefined],
    ]);
    expect(jobs.markSent).toHaveBeenCalledTimes(1);
  });
});

describe('MIME', () => {
  it('builds a multipart email with an encoded subject and a CSV attachment', () => {
    const mime = mimeMessage(
      'alerts@example.com',
      'asha@example.com',
      { title: 'Trips – Ölwagen', text: 'hello', html: '<p>hello</p>' },
      { filename: 'trips 1.csv', contentType: 'text/csv; charset=utf-8', content: 'a,b\r\n' },
    );
    expect(mime).toContain(
      `Subject: =?UTF-8?B?${Buffer.from('Trips – Ölwagen').toString('base64')}?=`,
    );
    expect(mime).toContain('Content-Disposition: attachment; filename="trips_1.csv"');
    expect(mime).toContain(Buffer.from('a,b\r\n').toString('base64'));
    expect(mime.endsWith('--\r\n')).toBe(true);
  });
});
