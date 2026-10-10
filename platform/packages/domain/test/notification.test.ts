import { describe, expect, it } from 'vitest';
import { calendarActive, isTimeZone, ruleMatches, type AlertRule } from '../src/index';

// 2026-10-12 is a Monday. Asia/Kolkata is UTC+05:30 all year.
const ist = (day: number, time: string) =>
  Date.parse(`2026-10-${String(12 + day).padStart(2, '0')}T${time}:00+05:30`);

describe('calendars', () => {
  const office = {
    timeZone: 'Asia/Kolkata',
    windows: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }],
  };

  it('follows the calendar’s own time zone, not UTC', () => {
    expect(calendarActive(office, ist(0, '09:00'))).toBe(true);
    expect(calendarActive(office, ist(0, '17:59'))).toBe(true);
    expect(calendarActive(office, ist(0, '18:00'))).toBe(false);
    expect(calendarActive(office, ist(0, '08:59'))).toBe(false);
    expect(calendarActive(office, ist(5, '10:00'))).toBe(false); // Saturday
  });

  it('runs overnight windows into the next morning', () => {
    const night = {
      timeZone: 'Asia/Kolkata',
      windows: [{ days: [5], start: '22:00', end: '06:00' }],
    };
    expect(calendarActive(night, ist(4, '23:30'))).toBe(true); // Friday night
    expect(calendarActive(night, ist(5, '05:59'))).toBe(true); // Saturday early
    expect(calendarActive(night, ist(5, '06:00'))).toBe(false);
    expect(calendarActive(night, ist(3, '23:30'))).toBe(false); // Thursday
  });

  it('treats equal start and end as the whole day', () => {
    const sunday = {
      timeZone: 'Asia/Kolkata',
      windows: [{ days: [0], start: '00:00', end: '00:00' }],
    };
    expect(calendarActive(sunday, ist(6, '13:00'))).toBe(true);
    expect(calendarActive(sunday, ist(0, '13:00'))).toBe(false);
  });

  it('recognises real time zones only', () => {
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('alert rules', () => {
  const rule: AlertRule = {
    tenantId: 't',
    ruleId: 'r',
    name: 'SOS',
    enabled: true,
    eventTypes: ['alarm', 'geofenceEnter'],
    alarms: ['sos'],
    deviceIds: [],
    groupIds: [],
    channels: ['web'],
    userIds: [],
  };

  it('matches event types and, for alarms, the chosen alarms', () => {
    expect(ruleMatches(rule, { type: 'alarm', alarm: 'sos', deviceId: 'd' })).toBe(true);
    expect(ruleMatches(rule, { type: 'alarm', alarm: 'lowBattery', deviceId: 'd' })).toBe(false);
    expect(ruleMatches(rule, { type: 'geofenceEnter', deviceId: 'd' })).toBe(true);
    expect(ruleMatches(rule, { type: 'ignitionOn', deviceId: 'd' })).toBe(false);
    expect(ruleMatches({ ...rule, enabled: false }, { type: 'geofenceEnter', deviceId: 'd' })).toBe(
      false,
    );
  });

  it('limits to chosen vehicles or groups when any are set', () => {
    const scoped = { ...rule, deviceIds: ['van'], groupIds: ['north'] };
    expect(ruleMatches(scoped, { type: 'geofenceEnter', deviceId: 'van' })).toBe(true);
    expect(ruleMatches(scoped, { type: 'geofenceEnter', deviceId: 'bus', groupId: 'north' })).toBe(
      true,
    );
    expect(ruleMatches(scoped, { type: 'geofenceEnter', deviceId: 'bus', groupId: 'south' })).toBe(
      false,
    );
  });
});
