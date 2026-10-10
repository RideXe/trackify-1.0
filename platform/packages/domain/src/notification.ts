import type { EventType } from './event';
import type { AlarmType } from './position';

/** How a matched event reaches people (or, for `command`, the vehicle itself). */
export const notificationChannels = [
  'web',
  'email',
  'push',
  'sms',
  'telegram',
  'whatsapp',
  'pushover',
  'command',
] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && (notificationChannels as readonly string[]).includes(value);
}

/** A weekly window in the calendar's time zone. `end` before `start` runs past midnight. */
export interface CalendarWindow {
  /** 0 = Sunday … 6 = Saturday; the day the window starts on. */
  days: number[];
  /** HH:MM, 24-hour. */
  start: string;
  end: string;
}

/** When something applies: business hours, night shifts, weekends. */
export interface Calendar {
  tenantId: string;
  calendarId: string;
  name: string;
  /** IANA zone such as Asia/Kolkata. */
  timeZone: string;
  windows: CalendarWindow[];
}

export interface AlertRule {
  tenantId: string;
  ruleId: string;
  name: string;
  enabled: boolean;
  eventTypes: EventType[];
  /** For alarm events: which alarms. Empty means every alarm. */
  alarms: AlarmType[];
  /** Which vehicles. Both empty means the whole fleet. */
  deviceIds: string[];
  groupIds: string[];
  channels: NotificationChannel[];
  /** Who is told. Empty means every active administrator. */
  userIds: string[];
  /** Only while this calendar is active. */
  calendarId?: string;
  /** Sent to the vehicle when the `command` channel is chosen, e.g. engine cut on SOS. */
  command?: { type: string; payload: Record<string, unknown> };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && TIME.test(value);
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Whether the calendar is active at this moment. */
export function calendarActive(calendar: Pick<Calendar, 'timeZone' | 'windows'>, at: number) {
  const { day, minute } = localDayAndMinute(at, calendar.timeZone);
  return calendar.windows.some((window) => {
    const start = minutes(window.start);
    const end = minutes(window.end);
    if (start === end) return window.days.includes(day);
    if (start < end) return window.days.includes(day) && minute >= start && minute < end;
    // Overnight: the part after start belongs to today, the part before end to yesterday's window.
    return (
      (window.days.includes(day) && minute >= start) ||
      (window.days.includes((day + 6) % 7) && minute < end)
    );
  });
}

export interface RuleTarget {
  type: EventType;
  alarm?: string;
  deviceId: string;
  groupId?: string;
}

/** Whether a rule wants this event, leaving calendars to the caller (they need a lookup). */
export function ruleMatches(rule: AlertRule, event: RuleTarget) {
  if (!rule.enabled || !rule.eventTypes.includes(event.type)) return false;
  if (
    event.type === 'alarm' &&
    rule.alarms.length &&
    !rule.alarms.includes(event.alarm as AlarmType)
  )
    return false;
  if (!rule.deviceIds.length && !rule.groupIds.length) return true;
  return (
    rule.deviceIds.includes(event.deviceId) ||
    (event.groupId !== undefined && rule.groupIds.includes(event.groupId))
  );
}

function minutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localDayAndMinute(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return {
    day: WEEKDAYS.indexOf(part('weekday')),
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}
