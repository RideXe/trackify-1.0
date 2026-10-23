import {
  filterWindow,
  initialFilterState,
  type CleanPoint,
  type FilterReport,
  type FilterState,
  type RawFix,
} from '@trackify/geo';
import * as SecureStore from './secure-store';

const stateKey = 'gps-filter-state-v1';

export interface FilteredWindow {
  points: CleanPoint[];
  report: FilterReport;
}

async function loadState(): Promise<FilterState> {
  const saved = await SecureStore.getItemAsync(stateKey).catch(() => null);
  if (!saved) return initialFilterState();
  try {
    const state = JSON.parse(saved) as FilterState;
    return state.version === 1 ? state : initialFilterState();
  } catch {
    return initialFilterState();
  }
}

/** Starts the next shift (or a resumed one) without judging fixes against an old position. */
export async function resetGpsFilter() {
  await SecureStore.deleteItemAsync(stateKey).catch(() => undefined);
}

/**
 * Cleans one window of raw fixes from the native location service (see filterWindow in
 * @trackify/geo). The filter's memory (last position, held-back fix, parking) is saved between
 * windows, so a spike at a window edge is still caught.
 */
export async function filterGpsWindow(fixes: RawFix[], final: boolean): Promise<FilteredWindow> {
  const result = filterWindow(fixes, await loadState(), {}, final);
  await SecureStore.setItemAsync(stateKey, JSON.stringify(result.state));
  return { points: result.points, report: result.report };
}

/** Raw fixes as sent by TrackifyLocationTaskService; malformed entries are dropped. */
export function parseWindow(json: string | undefined): RawFix[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (fix): fix is RawFix =>
        typeof fix === 'object' &&
        fix !== null &&
        typeof (fix as RawFix).t === 'number' &&
        typeof (fix as RawFix).lat === 'number' &&
        typeof (fix as RawFix).lon === 'number',
    );
  } catch {
    return [];
  }
}

/**
 * One line for the tracker log, written when the filter dropped something, so a driver or
 * support can see why the map shows what it shows. Example:
 * "GPS: 30 fixes, 6 sent, 3 dropped (poor accuracy 2, spike 1), 412 m"
 */
export function describeWindow(report: FilterReport): string | undefined {
  const dropped = Object.entries(report.rejected).filter(([, count]) => (count ?? 0) > 0);
  if (!dropped.length && !report.relocations) return undefined;
  const labels: Record<string, string> = {
    mock: 'fake GPS',
    noAccuracy: 'no accuracy',
    inaccurate: 'poor accuracy',
    invalid: 'invalid',
    stale: 'out of order',
    spike: 'spike',
    tooFast: 'impossible speed',
    speedMismatch: 'jump',
    acceleration: 'impossible acceleration',
    inconsistent: 'off track',
  };
  const total = dropped.reduce((sum, [, count]) => sum + (count ?? 0), 0);
  const reasons = dropped
    .map(([reason, count]) => `${labels[reason] ?? reason} ${count}`)
    .join(', ');
  const relocated = report.relocations ? `, ${report.relocations} jump accepted` : '';
  return `GPS: ${report.raw} fixes, ${report.uploaded} sent, ${total} dropped (${reasons})${relocated}, ${Math.round(report.distanceM)} m`;
}
