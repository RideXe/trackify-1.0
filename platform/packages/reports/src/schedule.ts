export const reportSchedules = ['daily', 'weekly', 'monthly'] as const;
export type ReportSchedule = (typeof reportSchedules)[number];

/** Reports go out at this local hour, covering the period that just ended. */
export const REPORT_HOUR = 6;

interface LocalDate {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

/**
 * The next send time strictly after `after`: 06:00 local every day, every Monday, or on the 1st.
 */
export function nextReportRun(schedule: ReportSchedule, after: number, timeZone: string): number {
  let date = localDate(after, timeZone);
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const candidate = zonedTime(date.year, date.month, date.day, REPORT_HOUR, timeZone);
    const due =
      schedule === 'daily' ||
      (schedule === 'weekly' && date.weekday === 1) ||
      (schedule === 'monthly' && date.day === 1);
    if (due && candidate > after) return candidate;
    date = addDays(date, 1);
  }
  throw new Error('no report run found within a year');
}

/** The local day, week (Monday–Sunday) or month that ended at the run's local midnight. */
export function reportPeriod(schedule: ReportSchedule, runAt: number, timeZone: string) {
  const today = localDate(runAt, timeZone);
  const to = zonedTime(today.year, today.month, today.day, 0, timeZone);
  let start: LocalDate;
  if (schedule === 'daily') start = addDays(today, -1);
  else if (schedule === 'weekly') start = addDays(today, -(((today.weekday + 6) % 7) + 7));
  else {
    const year = today.month === 1 ? today.year - 1 : today.year;
    const month = today.month === 1 ? 12 : today.month - 1;
    start = { year, month, day: 1, weekday: 0 };
  }
  return { from: zonedTime(start.year, start.month, start.day, 0, timeZone), to };
}

/** The instant a wall-clock time happens in a zone, DST included. */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
) {
  const wall = Date.UTC(year, month - 1, day, hour);
  let instant = wall - offset(wall, timeZone);
  instant = wall - offset(instant, timeZone);
  return instant;
}

/** How far the zone's wall clock is ahead of UTC at an instant, in milliseconds. */
function offset(at: number, timeZone: string) {
  const local = localParts(at, timeZone);
  const wholeSecond = at - (at % 1000);
  return (
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
    wholeSecond
  );
}

function localDate(at: number, timeZone: string): LocalDate {
  const parts = localParts(at, timeZone);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    weekday: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay(),
  };
}

function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function localParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}
