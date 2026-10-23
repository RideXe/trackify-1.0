export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | undefined | null;
}

/**
 * RFC 4180 CSV with a BOM so Excel reads UTF-8 names correctly. Text that a spreadsheet would run
 * as a formula (=, +, -, @, tab, CR) is prefixed with a quote: vehicle and driver names are typed
 * by users and must never execute when an export is opened.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [
    columns.map((column) => cell(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => cell(column.value(row))).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function cell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** ISO-like local time for spreadsheets: 2026-10-12 10:00:00 in the fleet's zone. */
export function localTime(at: number | undefined, timeZone: string): string | undefined {
  if (at === undefined) return undefined;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
