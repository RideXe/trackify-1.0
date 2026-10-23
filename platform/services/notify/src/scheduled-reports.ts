import {
  createDocumentClient,
  DynamoActivityStore,
  DynamoAdminStore,
  DynamoFleetStore,
  DynamoReportStore,
  type FleetUser,
  type ScheduledReport,
} from '@trackify/data';
import {
  buildReport,
  isReportKind,
  localTime,
  nextReportRun,
  reportPeriod,
  type DailyStatsRecord,
  type EventRecord,
  type PositionRecord,
  type ReportSource,
  type TripRecord,
} from '@trackify/reports';
import { liveChannelsFromEnv, type Attachment } from './channels';
import type { Message } from './format';
import { DEFAULT_TIME_ZONE } from './notifier';

interface Vehicle {
  deviceId: string;
  name: string;
  groupId?: string;
}

/** What sending scheduled reports reads and writes. */
export interface ReportJobData {
  due(now: number): Promise<Array<{ tenantId: string; reportId: string }>>;
  report(tenantId: string, reportId: string): Promise<ScheduledReport | undefined>;
  markSent(report: ScheduledReport, sentAt: number, nextRunAt: number): Promise<void>;
  vehicles(tenantId: string): Promise<Vehicle[]>;
  users(tenantId: string): Promise<FleetUser[]>;
  timeZone(tenantId: string): Promise<string | undefined>;
  geofenceNames(tenantId: string): Promise<Map<string, string>>;
  source(tenantId: string): ReportSource;
}

export interface ReportMailer {
  emailWithAttachment(to: string, message: Message, attachment: Attachment): Promise<void>;
}

const KIND_TITLES: Record<string, string> = {
  trips: 'Trips',
  stops: 'Stops',
  summary: 'Summary',
  events: 'Events',
  geofenceVisits: 'Geofence visits',
};

/**
 * Sends every due report. Recipients limited to groups get a copy covering only their vehicles.
 * A failure on one report never stops the others; it is retried on the next run.
 */
export async function sendDueReports(data: ReportJobData, mailer: ReportMailer, now: number) {
  const outcomes: Array<{ reportId: string; sent: number; error?: string }> = [];
  for (const key of await data.due(now)) {
    try {
      const report = await data.report(key.tenantId, key.reportId);
      if (!report?.enabled || report.nextRunAt > now || !isReportKind(report.kind)) continue;
      const timeZone = (await data.timeZone(report.tenantId)) ?? DEFAULT_TIME_ZONE;
      const period = reportPeriod(report.schedule, report.nextRunAt, timeZone);
      const [vehicles, users, geofenceNames] = await Promise.all([
        data.vehicles(report.tenantId),
        data.users(report.tenantId),
        data.geofenceNames(report.tenantId),
      ]);
      const chosen = vehicles.filter(
        (vehicle) =>
          (!report.deviceIds.length && !report.groupIds.length) ||
          report.deviceIds.includes(vehicle.deviceId) ||
          (vehicle.groupId !== undefined && report.groupIds.includes(vehicle.groupId)),
      );
      // Chosen users, or every administrator; each copy then covers only what that user may see.
      const recipients = (
        report.userIds.length
          ? users.filter((user) => report.userIds.includes(user.userId))
          : users.filter((user) => user.role === 'admin')
      ).filter((user) => user.enabled && user.email);
      const copies = new Map<string, { vehicles: Vehicle[]; to: string[] }>();
      for (const user of recipients) {
        const visible = chosen.filter(
          (vehicle) =>
            user.role === 'admin' ||
            !user.groupIds.length ||
            (vehicle.groupId !== undefined && user.groupIds.includes(vehicle.groupId)),
        );
        const key = visible.map((vehicle) => vehicle.deviceId).join(',');
        const copy = copies.get(key) ?? { vehicles: visible, to: [] };
        if (!copy.to.includes(user.email!)) copy.to.push(user.email!);
        copies.set(key, copy);
      }
      let sent = 0;
      for (const copy of copies.values()) {
        const built = await buildReport(
          report.kind,
          copy.vehicles,
          period,
          data.source(report.tenantId),
          {
            timeZone,
            now,
            geofenceNames,
          },
        );
        const label = `${KIND_TITLES[report.kind] ?? report.kind}, ${localTime(period.from, timeZone)?.slice(0, 10)} to ${localTime(period.to - 1, timeZone)?.slice(0, 10)}`;
        const message: Message = {
          title: `${report.name}: ${label}`,
          text: `${report.name} for ${copy.vehicles.length} vehicles: ${built.rowCount} rows, attached as CSV.`,
          html: `<p>${escape(report.name)} for ${copy.vehicles.length} vehicles: ${built.rowCount} rows, attached as CSV.</p>`,
        };
        const attachment = {
          filename: `${report.kind}-${new Date(period.from).toISOString().slice(0, 10)}.csv`,
          contentType: 'text/csv; charset=utf-8',
          content: built.csv,
        };
        for (const to of copy.to) {
          await mailer.emailWithAttachment(to, message, attachment);
          sent += 1;
        }
      }
      // A run that fell far behind (an outage) skips ahead rather than sending a backlog.
      const nextRunAt = nextReportRun(report.schedule, Math.max(now, report.nextRunAt), timeZone);
      await data.markSent(report, now, nextRunAt);
      outcomes.push({ reportId: report.reportId, sent });
    } catch (error) {
      console.error('scheduled report failed', { ...key, error });
      outcomes.push({
        reportId: key.reportId,
        sent: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function dynamoReportJobData(): ReportJobData {
  const client = createDocumentClient();
  const core = requiredEnv('CORE_TABLE');
  const reports = new DynamoReportStore(client, core);
  const admin = new DynamoAdminStore(client, core);
  const activity = new DynamoActivityStore(client, core);
  const fleet = new DynamoFleetStore(
    client,
    core,
    requiredEnv('DEVICE_STATE_TABLE'),
    requiredEnv('POSITIONS_TABLE'),
    {
      events: requiredEnv('EVENTS_TABLE'),
      trips: requiredEnv('TRIPS_TABLE'),
      dailyStats: requiredEnv('DAILY_STATS_TABLE'),
      commands: '',
    },
  );
  const LIMIT = 5_000;
  const ascending = <T>(items: unknown[] | undefined, key: string) =>
    ((items ?? []) as Array<Record<string, unknown>>).sort(
      (a, b) => Number(a[key]) - Number(b[key]),
    ) as unknown as T[];
  return {
    due: (now) => reports.due(now),
    report: (tenantId, reportId) => reports.get(tenantId, reportId),
    async markSent(report, sentAt, nextRunAt) {
      await reports.update(report.tenantId, report.reportId, { lastRunAt: sentAt, nextRunAt });
    },
    vehicles: async (tenantId) =>
      (await fleet.listDevices(tenantId)).map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        groupId: device.groupId,
      })),
    users: (tenantId) => admin.listUsers(tenantId),
    timeZone: async (tenantId) => (await activity.organisation(tenantId))?.timeZone,
    geofenceNames: async (tenantId) =>
      new Map(
        (await admin.listGeofences(tenantId)).map((geofence) => [
          geofence.geofenceId,
          geofence.name,
        ]),
      ),
    source: (tenantId) => ({
      trips: async (deviceId, from, to) =>
        ascending<TripRecord>(await fleet.trips(tenantId, deviceId, from, to, LIMIT), 'startTime'),
      events: async (deviceId, from, to) =>
        ascending<EventRecord>(
          await fleet.events(tenantId, deviceId, from, to, LIMIT),
          'eventTime',
        ),
      dailyStats: async (deviceId, fromDay, toDay) =>
        ((await fleet.dailyStats(tenantId, deviceId, fromDay, toDay)) ??
          []) as unknown as DailyStatsRecord[],
      positions: async (deviceId, from, to) =>
        ascending<PositionRecord>(
          await fleet.positions(tenantId, deviceId, from, to, LIMIT),
          'fixTime',
        ),
    }),
  };
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export const handler = async () => {
  const outcomes = await sendDueReports(dynamoReportJobData(), liveChannelsFromEnv(), Date.now());
  if (outcomes.length) console.info('scheduled reports', { outcomes });
  return outcomes;
};
