import type { ActivityItem, Device, Driver } from '@trackify/api-client';
import { notReporting } from './driver-activity-data';

/** What a driver is doing right now, from the vehicles they are assigned to. */
export type DriverState = 'unreachable' | 'on-shift' | 'break' | 'off-duty' | 'no-vehicle';

export const driverStateLabels: Record<DriverState, string> = {
  unreachable: 'Not reachable',
  'on-shift': 'On shift',
  break: 'On a break',
  'off-duty': 'Off duty',
  'no-vehicle': 'No vehicle',
};

export interface DriverNow {
  state: DriverState;
  /** The vehicle they are on shift in, or else the first one assigned. */
  vehicle?: Device;
  vehicles: Device[];
  /** When the shift or break began. */
  since?: number;
}

export function driverNow(driver: Driver, devices: Device[], now = Date.now()): DriverNow {
  const vehicles = devices.filter((device) => device.driverId === driver.driverId);
  if (!vehicles.length) return { state: 'no-vehicle', vehicles };
  const silent = vehicles.find((device) => notReporting(device, now));
  if (silent) return { state: 'unreachable', vehicle: silent, vehicles, since: silent.dutySince };
  const onShift = vehicles.find((device) => device.dutyStatus === 'on');
  if (onShift) return { state: 'on-shift', vehicle: onShift, vehicles, since: onShift.dutySince };
  const paused = vehicles.find((device) => device.dutyStatus === 'paused');
  if (paused) return { state: 'break', vehicle: paused, vehicles, since: paused.dutySince };
  return { state: 'off-duty', vehicle: vehicles[0], vehicles };
}

const stateRank: Record<DriverState, number> = {
  unreachable: 0,
  'on-shift': 1,
  break: 2,
  'off-duty': 3,
  'no-vehicle': 4,
};

export const driverFilters = {
  all: 'Total',
  'on-shift': 'On shift',
  'off-duty': 'Off duty',
  'no-vehicle': 'No vehicle',
  attention: 'Alerts',
} as const;
export type DriverFilter = keyof typeof driverFilters;

function matches(filter: DriverFilter, state: DriverState) {
  if (filter === 'all') return true;
  if (filter === 'attention') return state === 'unreachable';
  // Unreachable drivers are still on shift; they also show under Alerts.
  if (filter === 'on-shift')
    return state === 'on-shift' || state === 'break' || state === 'unreachable';
  return state === filter;
}

/** Drivers for the list: filtered and searched, not-reachable first, then on shift, then by name. */
export function listDrivers(
  drivers: Driver[],
  devices: Device[],
  filter: DriverFilter,
  query: string,
  now = Date.now(),
): Array<{ driver: Driver; now: DriverNow }> {
  const needle = query.trim().toLowerCase();
  return drivers
    .map((driver) => ({ driver, now: driverNow(driver, devices, now) }))
    .filter(
      ({ driver, now: current }) =>
        matches(filter, current.state) &&
        (!needle ||
          [driver.name, driver.phone, driver.licenceNumber].some((value) =>
            value?.toLowerCase().includes(needle),
          )),
    )
    .sort(
      (a, b) =>
        stateRank[a.now.state] - stateRank[b.now.state] ||
        a.driver.name.localeCompare(b.driver.name),
    );
}

export function driverCounts(
  drivers: Driver[],
  devices: Device[],
  now = Date.now(),
): Record<DriverFilter, number> {
  const counts = { all: 0, 'on-shift': 0, 'off-duty': 0, 'no-vehicle': 0, attention: 0 };
  for (const filter of Object.keys(counts) as DriverFilter[])
    counts[filter] = listDrivers(drivers, devices, filter, '', now).length;
  return counts;
}

export interface WeekStats {
  shifts: number;
  shiftMs: number;
  breakMs: number;
  /** Shifts with a vehicle check done during them. */
  checkedShifts: number;
  sos: number;
  issues: number;
  fuel: number;
  /** Phone stopped tracking, permission removed, or left the vehicle. */
  phoneProblems: number;
  /** Breaks that ran past the pause limit and were ended by the app. */
  lateBreaks: number;
  speeding: number;
}

const phoneProblemKinds = new Set(['tracking-stopped', 'permission-revoked', 'phone-left-vehicle']);

/**
 * A driver's week from their own entries (any vehicle) and speeding episodes. A shift still open
 * counts up to `now`; one whose start is before the window counts from its end only if paired.
 */
export function weekStats(entries: ActivityItem[], speeding: number, now = Date.now()): WeekStats {
  const stats: WeekStats = {
    shifts: 0,
    shiftMs: 0,
    breakMs: 0,
    checkedShifts: 0,
    sos: 0,
    issues: 0,
    fuel: 0,
    phoneProblems: 0,
    lateBreaks: 0,
    speeding,
  };
  // Oldest first, per vehicle, so starts pair with their ends.
  const byVehicle = new Map<string, ActivityItem[]>();
  for (const entry of [...entries].sort((a, b) => a.at - b.at))
    byVehicle.set(entry.deviceId, [...(byVehicle.get(entry.deviceId) ?? []), entry]);
  for (const list of byVehicle.values()) {
    let shiftStart: number | undefined;
    let checked = false;
    let pauseStart: number | undefined;
    for (const entry of list) {
      switch (entry.type) {
        case 'shift-start':
          shiftStart = entry.at;
          checked = false;
          stats.shifts += 1;
          break;
        case 'shift-end':
          if (shiftStart !== undefined) {
            stats.shiftMs += entry.at - shiftStart;
            if (checked) stats.checkedShifts += 1;
          } else if (entry.shiftStartedAt !== undefined && entry.shiftStartedAt < entry.at) {
            // Its start is missing from this driver's entries (they were assigned mid-shift, or
            // it began before the week): the server noted when it began.
            stats.shifts += 1;
            stats.shiftMs += entry.at - entry.shiftStartedAt;
          }
          shiftStart = undefined;
          pauseStart = undefined;
          break;
        case 'pause':
          pauseStart = entry.at;
          break;
        case 'resume':
          if (pauseStart !== undefined) stats.breakMs += entry.at - pauseStart;
          if (entry.auto) stats.lateBreaks += 1;
          pauseStart = undefined;
          break;
        case 'check':
          checked = true;
          break;
        case 'sos':
          stats.sos += 1;
          break;
        case 'issue':
          stats.issues += 1;
          break;
        case 'fuel':
          stats.fuel += 1;
          break;
        case 'warning':
          if (entry.kind && phoneProblemKinds.has(entry.kind)) stats.phoneProblems += 1;
          break;
        default:
          break;
      }
    }
    // Still on shift: counts so far.
    if (shiftStart !== undefined) {
      stats.shiftMs += now - shiftStart;
      if (checked) stats.checkedShifts += 1;
    }
  }
  return stats;
}

export interface DriverScore {
  value: number;
  label: 'Good' | 'Fair' | 'Needs coaching';
  /** Why points were lost, in plain words; empty for a perfect week. */
  reasons: Array<{ points: number; text: string }>;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * A simple, explainable score out of 100 for the week. Undefined without a shift: there is
 * nothing fair to judge. Each kind of problem has a cap so one bad day does not dominate.
 */
export function driverScore(stats: WeekStats): DriverScore | undefined {
  if (!stats.shifts) return undefined;
  const reasons: DriverScore['reasons'] = [];
  const take = (count: number, each: number, cap: number, text: string) => {
    if (count > 0) reasons.push({ points: Math.min(cap, count * each), text });
  };
  take(stats.speeding, 5, 30, `${plural(stats.speeding, 'speeding incident')}`);
  const unchecked = stats.shifts - stats.checkedShifts;
  take(unchecked, 10, 20, `${plural(unchecked, 'shift')} without a vehicle check`);
  take(stats.phoneProblems, 5, 20, `${plural(stats.phoneProblems, 'phone problem')} during shifts`);
  take(stats.lateBreaks, 5, 15, `${plural(stats.lateBreaks, 'break')} longer than allowed`);
  const value = Math.max(0, 100 - reasons.reduce((sum, reason) => sum + reason.points, 0));
  return {
    value,
    label: value >= 85 ? 'Good' : value >= 65 ? 'Fair' : 'Needs coaching',
    reasons,
  };
}

/**
 * A driver's own entries, plus the "Started shift" of any shift they ended: a driver is often
 * assigned to the vehicle after the shift began, so that start carries no driver, or the
 * previous one.
 */
export function entriesFor(all: ActivityItem[], driverId: string): ActivityItem[] {
  const own = all.filter((entry) => entry.driverId === driverId);
  const borrowed: ActivityItem[] = [];
  for (const end of own) {
    if (end.type !== 'shift-end' || end.shiftStartedAt !== undefined) continue;
    // The same vehicle's latest start before this end, if no other end came in between.
    const before = all
      .filter((entry) => entry.deviceId === end.deviceId && entry.at < end.at)
      .sort((a, b) => b.at - a.at);
    const start = before.find(
      (entry) => entry.type === 'shift-start' || entry.type === 'shift-end',
    );
    if (start?.type === 'shift-start' && start.driverId !== driverId) borrowed.push(start);
  }
  return [...own, ...borrowed];
}

/** Speeding episodes this driver started, from raw vehicle events. */
export function speedingCount(events: Array<Record<string, unknown>>, driverId: string) {
  return events.filter((event) => {
    const attributes = event.attributes as { driverId?: unknown } | undefined;
    return event.type === 'deviceOverspeed' && attributes?.driverId === driverId;
  }).length;
}

export function hoursLabel(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}
