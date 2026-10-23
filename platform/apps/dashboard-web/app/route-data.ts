import type { StoredPosition } from '@trackify/api-client';
import { distanceMeters, movedBeyondDrift } from '@trackify/geo';

export type RoutePoint = Pick<
  StoredPosition,
  'fixTime' | 'latitude' | 'longitude' | 'altitudeM' | 'speedKmh' | 'courseDeg' | 'accuracyM'
>;

/** The positions API returns at most this many fixes per request. */
export const PAGE_SIZE = 5_000;
/** Beyond this the map and downloads get sluggish, so the user is asked to pick a shorter period. */
export const MAX_ROUTE_POINTS = 100_000;

export interface LoadedRoute {
  /** Oldest first. */
  points: RoutePoint[];
  /** Fixes the tracker reported without a GPS lock; they are left off the route. */
  skipped: number;
  /** The period held more than MAX_ROUTE_POINTS fixes, so its oldest part was not loaded. */
  truncated: boolean;
}

/**
 * Loads every GPS fix between `from` and `to` (inclusive). The API returns fixes newest first,
 * PAGE_SIZE at a time, so this walks backwards from `to` until it reaches the start of the period.
 */
export async function loadRoute(
  fetchPage: (from: number, to: number, limit: number) => Promise<StoredPosition[]>,
  from: number,
  to: number,
): Promise<LoadedRoute> {
  const seen = new Set<string>();
  const fixes: StoredPosition[] = [];
  let upper = to;
  let truncated = false;
  for (;;) {
    const page = await fetchPage(from, upper, PAGE_SIZE);
    let added = 0;
    for (const fix of page) {
      const key = `${fix.fixTime}#${fix.messageId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fixes.push(fix);
      added += 1;
    }
    if (page.length < PAGE_SIZE || added === 0) break;
    if (fixes.length >= MAX_ROUTE_POINTS) {
      truncated = true;
      break;
    }
    // Pages overlap on their oldest millisecond so fixes sharing it are not lost; `seen` drops repeats.
    upper = page.reduce((oldest, fix) => Math.min(oldest, fix.fixTime), upper);
  }
  const located = fixes.filter((fix) => fix.valid !== false);
  located.sort((a, b) => a.fixTime - b.fixTime);
  return {
    points: located.map(
      ({ fixTime, latitude, longitude, altitudeM, speedKmh, courseDeg, accuracyM }) => ({
        fixTime,
        latitude,
        longitude,
        altitudeM,
        speedKmh,
        courseDeg,
        accuracyM,
      }),
    ),
    skipped: fixes.length - located.length,
    truncated,
  };
}

/**
 * The route the vehicle actually drove, using the same rule as live tracking: readings within GPS
 * drift of the last accepted position are dropped, so a parked vehicle stays one point instead of
 * a scribble. A clearly more accurate reading (twice as precise) may refine that point.
 */
export function withoutDrift(points: RoutePoint[]): RoutePoint[] {
  const route: RoutePoint[] = [];
  for (const point of points) {
    const anchor = route.at(-1);
    if (!anchor || movedBeyondDrift(anchor, point)) route.push(point);
    else if (point.accuracyM !== undefined && point.accuracyM <= (anchor.accuracyM ?? Infinity) / 2)
      route[route.length - 1] = { ...point, fixTime: anchor.fixTime };
  }
  return route;
}

/** Distance and top speed come from the drift-free route; duration spans every reading. */
export function summarizeRoute(points: RoutePoint[]) {
  const route = withoutDrift(points);
  let distanceM = 0;
  let maxSpeedKmh = 0;
  route.forEach((point, index) => {
    const previous = route[index - 1];
    if (!previous) return;
    distanceM += distanceMeters(previous, point);
    maxSpeedKmh = Math.max(maxSpeedKmh, point.speedKmh ?? 0);
  });
  const first = points[0];
  const last = points.at(-1);
  const durationMs = first && last ? last.fixTime - first.fixTime : 0;
  return { distanceM, durationMs, maxSpeedKmh };
}

/** KML opens in Google Earth and can be imported into Google My Maps. */
export function routeToKml(name: string, points: RoutePoint[]): string {
  const first = points[0];
  const last = points.at(-1);
  const line = first && last && first !== last;
  const place = (label: string, point: RoutePoint) =>
    `    <Placemark><name>${label}</name><TimeStamp><when>${iso(point.fixTime)}</when></TimeStamp>` +
    `<Point><coordinates>${point.longitude},${point.latitude}</coordinates></Point></Placemark>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${xml(name)}</name>`,
    // KML colours are aabbggrr: this is the dashboard blue #155EEF.
    '    <Style id="route"><LineStyle><color>ffef5e15</color><width>4</width></LineStyle></Style>',
    ...(line
      ? [
          `    <Placemark><name>${xml(name)}</name><styleUrl>#route</styleUrl>` +
            `<TimeSpan><begin>${iso(first.fixTime)}</begin><end>${iso(last.fixTime)}</end></TimeSpan>` +
            '<LineString><tessellate>1</tessellate><coordinates>' +
            points.map((point) => `${point.longitude},${point.latitude}`).join(' ') +
            '</coordinates></LineString></Placemark>',
        ]
      : []),
    ...(first ? [place('Start', first)] : []),
    ...(line ? [place('End', last)] : []),
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}

/** GPX works with most GPS, fitness and mapping apps. */
export function routeToGpx(name: string, points: RoutePoint[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trackify" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <trk>',
    `    <name>${xml(name)}</name>`,
    '    <trkseg>',
    ...points.map(
      (point) =>
        `      <trkpt lat="${point.latitude}" lon="${point.longitude}">` +
        (point.altitudeM === undefined ? '' : `<ele>${point.altitudeM}</ele>`) +
        `<time>${iso(point.fixTime)}</time></trkpt>`,
    ),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

/** CSV opens in Excel and Google Sheets. Times are UTC so rows sort and compare correctly. */
export function routeToCsv(points: RoutePoint[]): string {
  const rows = points.map((point) =>
    [
      iso(point.fixTime),
      point.latitude,
      point.longitude,
      point.speedKmh ?? '',
      point.courseDeg ?? '',
      point.altitudeM ?? '',
      point.accuracyM ?? '',
    ].join(','),
  );
  return [
    'time_utc,latitude,longitude,speed_kmh,course_deg,altitude_m,accuracy_m',
    ...rows,
    '',
  ].join('\r\n');
}

/** For example `van-12-route-2026-09-26-0000-to-2026-09-26-1830.kml`, in local time. */
export function routeFileName(deviceName: string, from: number, to: number, extension: string) {
  const slug =
    deviceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'vehicle';
  return `${slug}-route-${stamp(from)}-to-${stamp(to)}.${extension}`;
}

function stamp(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function xml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
