/**
 * What drivers do in the phone app (shifts, pauses, SOS, reports) and what admins send back
 * (messages). Plain TypeScript with no runtime dependencies, so the phone and dashboard can
 * import it through '@trackify/domain/activity' without pulling in zod.
 */

export const pauseReasons = ['break', 'fuel', 'loading', 'personal'] as const;
export type PauseReason = (typeof pauseReasons)[number];

export const issueKinds = ['breakdown', 'flat-tyre', 'accident', 'traffic', 'other'] as const;
export type IssueKind = (typeof issueKinds)[number];

/** Problems the phone can detect on its own that stop tracking from working. */
export const warningKinds = [
  'battery-low',
  'gps-off',
  'permission-revoked',
  'tracking-stopped',
  'phone-left-vehicle',
] as const;
export type WarningKind = (typeof warningKinds)[number];

export const checkItems = ['tyres', 'lights', 'brakes', 'horn', 'mirrors', 'documents'] as const;
export type CheckItem = (typeof checkItems)[number];
export type CheckResult = 'ok' | 'issue';

/** Entries the phone may send. Messages are also entries, but only the dashboard creates them. */
export const driverActivityTypes = [
  'shift-start',
  'shift-end',
  'pause',
  'resume',
  'sos',
  'issue',
  'fuel',
  'check',
  'warning',
] as const;
export type DriverActivityType = (typeof driverActivityTypes)[number];
export type ActivityType = DriverActivityType | 'message';

export type DutyStatus = 'off' | 'on' | 'paused';

/**
 * How often a phone sends its filtered location to the server (it measures every second either
 * way). Offered in the dashboard; the phone accepts only these.
 */
export const trackerIntervals = [5, 10, 15, 30, 60, 120, 300] as const;
export const defaultTrackerIntervalSeconds = 30;

/** Subscription plans; each allows syncing no faster than its limit. */
export const subscriptionPlans = ['basic', 'standard', 'premium'] as const;
export type SubscriptionPlan = (typeof subscriptionPlans)[number];

export const planFastestIntervalSeconds: Record<SubscriptionPlan, number> = {
  basic: 30,
  standard: 15,
  premium: 5,
};

/** Fleets created before plans existed keep what they could already choose (15 s). */
export const defaultSubscriptionPlan: SubscriptionPlan = 'standard';

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === 'string' && (subscriptionPlans as readonly string[]).includes(value);
}

export function fastestIntervalFor(plan: unknown): number {
  return planFastestIntervalSeconds[isSubscriptionPlan(plan) ? plan : defaultSubscriptionPlan];
}

/**
 * The interval a vehicle actually uses: its own setting, else the fleet's default, else 30 s;
 * never faster than the plan allows, so a downgrade slows vehicles without editing each one.
 */
export function effectiveTrackerInterval(input: {
  vehicle?: number;
  fleet?: number;
  plan?: unknown;
}): number {
  const requested = input.vehicle ?? input.fleet ?? defaultTrackerIntervalSeconds;
  return Math.max(requested, fastestIntervalFor(input.plan));
}
export const pauseLimits = [15, 30, 45, 60, 90, 120] as const;
export const defaultPauseLimitMinutes = 30;

export interface ActivityEntry {
  entryId: string;
  deviceId: string;
  type: ActivityType;
  /** When it happened on the phone; can be earlier than receivedAt if it was queued offline. */
  at: number;
  receivedAt: number;
  latitude?: number;
  longitude?: number;
  batteryPct?: number;
  /** pause */
  reason?: PauseReason;
  /** pause: when tracking resumes by itself. */
  until?: number;
  /** resume: true when the pause limit ran out rather than the driver resuming. */
  auto?: boolean;
  /** issue or warning */
  kind?: IssueKind | WarningKind;
  note?: string;
  photoKey?: string;
  /** fuel */
  litres?: number;
  amount?: number;
  odometerKm?: number;
  /** check */
  items?: Partial<Record<CheckItem, CheckResult>>;
  /** message */
  text?: string;
  sentBy?: string;
}

export type AlertSeverity = 'critical' | 'high' | 'warning';

/** Which driver entries need an administrator's attention, and whether to email them too. */
export function alertFor(
  entry: Pick<ActivityEntry, 'type' | 'kind'>,
): { severity: AlertSeverity; email: boolean } | undefined {
  if (entry.type === 'sos') return { severity: 'critical', email: true };
  if (entry.type === 'issue') {
    const serious = entry.kind === 'accident' || entry.kind === 'breakdown';
    return { severity: serious ? 'high' : 'warning', email: serious };
  }
  if (entry.type === 'warning') return { severity: 'warning', email: false };
  return undefined;
}

/** The duty state a driver entry moves the vehicle to; undefined leaves it as it was. */
export function dutyAfter(type: ActivityType): DutyStatus | undefined {
  if (type === 'shift-start' || type === 'resume') return 'on';
  if (type === 'pause') return 'paused';
  if (type === 'shift-end') return 'off';
  return undefined;
}

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
