import { describe, expect, it } from 'vitest';
import { nextReportRun, reportPeriod, zonedTime } from '../src/index';

const IST = 'Asia/Kolkata';
const at = (iso: string) => Date.parse(iso);

describe('report schedule', () => {
  it('turns wall-clock times into instants, across daylight saving too', () => {
    expect(zonedTime(2026, 10, 12, 6, IST)).toBe(at('2026-10-12T06:00:00+05:30'));
    expect(zonedTime(2026, 7, 1, 6, 'Europe/London')).toBe(at('2026-07-01T06:00:00+01:00'));
    expect(zonedTime(2026, 1, 15, 6, 'Europe/London')).toBe(at('2026-01-15T06:00:00Z'));
  });

  it('runs daily at 06:00 local, weekly on Mondays and monthly on the 1st', () => {
    const saturdayNoon = at('2026-10-10T12:00:00+05:30');
    expect(nextReportRun('daily', saturdayNoon, IST)).toBe(at('2026-10-11T06:00:00+05:30'));
    expect(nextReportRun('weekly', saturdayNoon, IST)).toBe(at('2026-10-12T06:00:00+05:30'));
    expect(nextReportRun('monthly', saturdayNoon, IST)).toBe(at('2026-11-01T06:00:00+05:30'));
    const justSent = at('2026-10-12T06:00:00+05:30');
    expect(nextReportRun('daily', justSent, IST)).toBe(at('2026-10-13T06:00:00+05:30'));
  });

  it('covers the day, Monday-to-Sunday week, or month that just ended', () => {
    const mondayRun = at('2026-10-12T06:00:00+05:30');
    expect(reportPeriod('daily', mondayRun, IST)).toEqual({
      from: at('2026-10-11T00:00:00+05:30'),
      to: at('2026-10-12T00:00:00+05:30'),
    });
    expect(reportPeriod('weekly', mondayRun, IST)).toEqual({
      from: at('2026-10-05T00:00:00+05:30'),
      to: at('2026-10-12T00:00:00+05:30'),
    });
    expect(reportPeriod('monthly', at('2026-01-01T06:00:00+05:30'), IST)).toEqual({
      from: at('2025-12-01T00:00:00+05:30'),
      to: at('2026-01-01T00:00:00+05:30'),
    });
  });
});
