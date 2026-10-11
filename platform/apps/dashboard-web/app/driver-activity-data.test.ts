import type { ActivityEntry, Device } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import {
  alertTitle,
  describeActivity,
  driverOf,
  dutyLabel,
  inTab,
  intervalLabel,
  mapLink,
  notReporting,
  presence,
} from './driver-activity-data';

const now = 1_800_000_000_000;
const vehicle = (extra: Partial<Device>): Device => ({
  deviceId: 'd',
  name: 'Van',
  uniqueId: 'u',
  protocol: 'osmand',
  groupId: 'UNGROUPED',
  ...extra,
});
const entry = (extra: Partial<ActivityEntry>): ActivityEntry => ({
  entryId: 'e',
  deviceId: 'd',
  type: 'sos',
  at: now,
  receivedAt: now,
  ...extra,
});

describe('duty on the dashboard', () => {
  it('says nothing for a vehicle whose driver never used the app', () => {
    expect(dutyLabel(vehicle({}))).toBeUndefined();
    expect(dutyLabel(vehicle({ dutyStatus: 'on' }))).toBe('On shift');
    expect(dutyLabel(vehicle({ dutyStatus: 'paused', pauseReason: 'fuel' }))).toBe(
      'Paused · Fuel stop',
    );
  });

  it('flags a driver on shift whose phone went quiet, but not one on a pause', () => {
    const quiet = { lastSeenAt: now - 600_000 };
    expect(notReporting(vehicle({ dutyStatus: 'on', state: quiet }), now)).toBe(true);
    expect(notReporting(vehicle({ dutyStatus: 'paused', state: quiet }), now)).toBe(false);
    expect(notReporting(vehicle({ dutyStatus: 'on', state: { lastSeenAt: now } }), now)).toBe(
      false,
    );
  });
});

describe('driver and vehicle activity tabs', () => {
  const types = (tab: 'driver' | 'vehicle') =>
    (
      [
        'shift-start',
        'shift-end',
        'pause',
        'resume',
        'driver-change',
        'sos',
        'issue',
        'fuel',
        'check',
        'warning',
        'message',
      ] as const
    ).filter((type) => inTab({ type }, tab));

  it('keeps shifts in driver activity and reports in vehicle activity', () => {
    expect(types('driver')).toEqual([
      'shift-start',
      'shift-end',
      'pause',
      'resume',
      'driver-change',
    ]);
    expect(types('vehicle')).toEqual(['driver-change', 'sos', 'issue', 'fuel', 'check', 'warning']);
  });

  it('shows alerts sent to the driver in neither tab: they live in Send alert', () => {
    expect(inTab({ type: 'message' }, 'driver')).toBe(false);
    expect(inTab({ type: 'message' }, 'vehicle')).toBe(false);
  });

  it('names the driver on every entry, or says there was none', () => {
    expect(driverOf(entry({ type: 'issue', driverName: 'Ravi' }))).toBe('Ravi');
    expect(driverOf(entry({ type: 'issue' }))).toBe('No driver assigned');
  });

  it('describes a driver change from whom to whom, and who made it', () => {
    expect(
      describeActivity(
        entry({
          type: 'driver-change',
          previousDriverName: 'Suresh',
          driverName: 'Ravi',
          sentBy: 'admin@fleet.in',
        }),
      ),
    ).toEqual({
      title: 'Driver changed',
      detail: 'Suresh → Ravi · by admin@fleet.in',
      tone: 'info',
    });
    expect(describeActivity(entry({ type: 'driver-change' })).detail).toBe('No driver → No driver');
  });
});

describe('one status per vehicle', () => {
  const hours = (n: number) => n * 3_600_000;
  const at = { latitude: 12.97, longitude: 77.59 };
  const heard = (msAgo: number, fixAgo = msAgo) => ({
    ...at,
    status: 'online',
    lastSeenAt: now - msAgo,
    fixTime: now - fixAgo,
  });

  it('raises a silent shift as an alarm only for the first 12 hours', () => {
    const silent = (ms: number) => vehicle({ dutyStatus: 'on', state: heard(ms) });
    expect(presence(silent(hours(1)), now)).toEqual({
      label: 'Not reachable · on shift',
      tone: 'critical',
    });
    // The screenshot case: last heard 23 h ago, shift never ended.
    expect(notReporting(silent(hours(23)), now)).toBe(false);
    expect(presence(silent(hours(23)), now)).toEqual({
      label: 'Offline · shift not ended',
      tone: 'muted',
    });
  });

  it('counts a shift started recently but never reported as not reachable', () => {
    const fresh = vehicle({ dutyStatus: 'on', dutySince: now - hours(1) });
    expect(presence(fresh, now).tone).toBe('critical');
  });

  it('never pairs "Offline" with "On shift", and names the duty when online', () => {
    expect(presence(vehicle({ dutyStatus: 'off', state: heard(hours(2)) }), now).label).toBe(
      'Offline · off duty',
    );
    expect(presence(vehicle({ dutyStatus: 'on', state: heard(60_000) }), now).label).toBe(
      'Parked · on shift',
    );
    expect(
      presence(
        vehicle({ dutyStatus: 'on', state: { ...heard(60_000), motion: true, speedKmh: 40 } }),
        now,
      ).label,
    ).toBe('Moving · on shift');
    expect(presence(vehicle({ state: heard(60_000) }), now).label).toBe('Parked');
  });

  it('shows a phone that checks in without GPS as online with no signal', () => {
    const indoors = vehicle({ dutyStatus: 'on', state: heard(30_000, hours(1)) });
    expect(presence(indoors, now)).toEqual({ label: 'Online · no GPS signal', tone: 'warning' });
  });
});

describe('driver activity timeline', () => {
  it('marks SOS and accidents critical, and lists what failed a vehicle check', () => {
    expect(describeActivity(entry({ type: 'sos' })).tone).toBe('critical');
    expect(describeActivity(entry({ type: 'issue', kind: 'accident' })).tone).toBe('critical');
    expect(describeActivity(entry({ type: 'issue', kind: 'traffic' })).tone).toBe('warning');
    const check = describeActivity(
      entry({ type: 'check', items: { tyres: 'ok', brakes: 'issue' } }),
    );
    expect(check.title).toBe('Vehicle check · problems found');
    expect(check.detail).toBe('Problem: brakes');
  });

  it('shows only the fuel details that were entered', () => {
    expect(describeActivity(entry({ type: 'fuel', litres: 30 }))).toEqual({
      title: 'Fuel: 30 L',
      detail: undefined,
      tone: 'info',
    });
    expect(describeActivity(entry({ type: 'fuel', litres: 30, amount: 3200 })).detail).toBe(
      '₹3,200',
    );
  });

  it('tells an automatic resume apart from the driver coming back', () => {
    expect(describeActivity(entry({ type: 'resume', auto: true })).tone).toBe('warning');
    expect(describeActivity(entry({ type: 'resume' })).title).toBe('Back in the vehicle');
  });
});

describe('labels', () => {
  it('names alerts, intervals and map links', () => {
    expect(alertTitle({ type: 'warning', kind: 'gps-off' })).toBe(
      'Location turned off on the phone',
    );
    expect(intervalLabel(30)).toBe('30 seconds');
    expect(intervalLabel(120)).toBe('2 min');
    expect(mapLink(12.9, 77.5)).toBe('https://maps.google.com/?q=12.9,77.5');
    expect(mapLink(undefined, 77.5)).toBeUndefined();
  });
});
