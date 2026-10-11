import type { ActivityItem, Device, Driver } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import {
  driverCounts,
  driverNow,
  driverScore,
  entriesFor,
  hoursLabel,
  listDrivers,
  speedingCount,
  weekStats,
} from './driver-insights';

const now = 1_800_000_000_000;
const hour = 3_600_000;
const driver = (id: string, name: string, extra: Partial<Driver> = {}): Driver => ({
  driverId: id,
  name,
  ...extra,
});
const car = (id: string, extra: Partial<Device> = {}): Device => ({
  deviceId: id,
  name: `Car ${id}`,
  uniqueId: `gps-${id}`,
  protocol: 'osmand',
  groupId: 'UNGROUPED',
  ...extra,
});
const heard = (msAgo: number) => ({
  latitude: 12.97,
  longitude: 77.59,
  status: 'online',
  lastSeenAt: now - msAgo,
  fixTime: now - msAgo,
});
let next = 0;
const entry = (type: ActivityItem['type'], at: number, extra: Partial<ActivityItem> = {}) =>
  ({ entryId: `e${next++}`, deviceId: 'c1', type, at, receivedAt: at, ...extra }) as ActivityItem;

describe('what a driver is doing now', () => {
  const drivers = [
    driver('d1', 'Asha'),
    driver('d2', 'Bala', { phone: '98450 11111' }),
    driver('d3', 'Chitra'),
    driver('d4', 'Dev', { licenceNumber: 'KA01-2020' }),
  ];
  const devices = [
    car('c1', {
      driverId: 'd1',
      dutyStatus: 'on',
      dutySince: now - 2 * hour,
      state: heard(60_000),
    }),
    // On shift, silent for 20 minutes.
    car('c2', { driverId: 'd2', dutyStatus: 'on', state: heard(20 * 60_000) }),
    car('c3', { driverId: 'd3', dutyStatus: 'off', state: heard(hour) }),
  ];

  it('works out each state, with an unreachable phone first', () => {
    expect(driverNow(drivers[0]!, devices, now)).toMatchObject({
      state: 'on-shift',
      since: now - 2 * hour,
    });
    expect(driverNow(drivers[3]!, devices, now).state).toBe('no-vehicle');
    expect(listDrivers(drivers, devices, 'all', '', now).map((row) => row.driver.name)).toEqual([
      'Bala',
      'Asha',
      'Chitra',
      'Dev',
    ]);
  });

  it('counts the tiles and searches name, phone and licence', () => {
    expect(driverCounts(drivers, devices, now)).toEqual({
      all: 4,
      'on-shift': 2,
      'off-duty': 1,
      'no-vehicle': 1,
      attention: 1,
    });
    const search = (query: string) =>
      listDrivers(drivers, devices, 'all', query, now).map((row) => row.driver.name);
    expect(search('98450')).toEqual(['Bala']);
    expect(search('ka01')).toEqual(['Dev']);
  });
});

describe('a driver week', () => {
  const week = [
    entry('shift-start', now - 10 * hour),
    entry('check', now - 10 * hour + 60_000, { items: { tyres: 'ok' } }),
    entry('pause', now - 8 * hour),
    entry('resume', now - 7.5 * hour, { auto: true }),
    entry('shift-end', now - 2 * hour),
    entry('warning', now - 3 * hour, { kind: 'tracking-stopped' }),
    entry('warning', now - 3 * hour, { kind: 'battery-low' }),
    // Second vehicle, still on shift, no check.
    entry('shift-start', now - hour, { deviceId: 'c2' }),
    entry('issue', now - 30 * 60_000, { deviceId: 'c2', kind: 'flat-tyre' }),
  ];

  it('adds up shifts, breaks and reports across vehicles', () => {
    expect(weekStats(week, 2, now)).toEqual({
      shifts: 2,
      shiftMs: 9 * hour,
      breakMs: 0.5 * hour,
      checkedShifts: 1,
      sos: 0,
      issues: 1,
      fuel: 0,
      phoneProblems: 1,
      lateBreaks: 1,
      speeding: 2,
    });
  });

  it('scores the week with a reason for every lost point', () => {
    expect(driverScore(weekStats(week, 2, now))).toEqual({
      value: 70,
      label: 'Fair',
      reasons: [
        { points: 10, text: '2 speeding incidents' },
        { points: 10, text: '1 shift without a vehicle check' },
        { points: 5, text: '1 phone problem during shifts' },
        { points: 5, text: '1 break longer than allowed' },
      ],
    });
  });

  it('caps each kind of problem and gives no score without a shift', () => {
    const speedy = weekStats([entry('shift-start', now - hour), entry('check', now)], 20, now);
    expect(driverScore(speedy)).toMatchObject({ value: 70, label: 'Fair' });
    expect(driverScore(weekStats([], 0, now))).toBeUndefined();
  });

  it('counts a shift for the driver who ended it, when they were assigned mid-shift', () => {
    // Started at 6:53 with no driver on the vehicle; santhosh assigned later and ended it.
    const log = [
      entry('shift-start', now - 4 * hour),
      entry('shift-end', now, { driverId: 'd1', driverName: 'santhosh' }),
    ];
    expect(weekStats(entriesFor(log, 'd1'), 0, now)).toMatchObject({
      shifts: 1,
      shiftMs: 4 * hour,
    });
  });

  it("uses the start the server noted, and never borrows across another driver's shift", () => {
    const noted = [entry('shift-end', now, { driverId: 'd1', shiftStartedAt: now - 2 * hour })];
    expect(weekStats(entriesFor(noted, 'd1'), 0, now)).toMatchObject({
      shifts: 1,
      shiftMs: 2 * hour,
    });
    // Driver 2 had the vehicle earlier; driver 1's end has no start of its own after that shift.
    const handover = [
      entry('shift-start', now - 6 * hour, { driverId: 'd2' }),
      entry('shift-end', now - 4 * hour, { driverId: 'd2' }),
      entry('shift-end', now, { driverId: 'd1' }),
    ];
    expect(weekStats(entriesFor(handover, 'd1'), 0, now).shifts).toBe(0);
    expect(weekStats(entriesFor(handover, 'd2'), 0, now)).toMatchObject({
      shifts: 1,
      shiftMs: 2 * hour,
    });
  });

  it('counts only the speeding this driver started', () => {
    const events = [
      { type: 'deviceOverspeed', attributes: { driverId: 'd1' } },
      { type: 'deviceOverspeed', attributes: { driverId: 'd2' } },
      { type: 'overspeedEnded', attributes: { driverId: 'd1' } },
    ];
    expect(speedingCount(events, 'd1')).toBe(1);
  });

  it('writes durations in hours and minutes', () => {
    expect(hoursLabel(45 * 60_000)).toBe('45 min');
    expect(hoursLabel(9 * hour)).toBe('9 h');
    expect(hoursLabel(2.5 * hour)).toBe('2 h 30 min');
  });
});
