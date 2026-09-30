import type { ActivityEntry, Device } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import {
  alertTitle,
  describeActivity,
  dutyLabel,
  intervalLabel,
  mapLink,
  notReporting,
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
