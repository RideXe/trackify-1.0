import { distanceMeters, type GeoPoint } from './index';
import {
  initialAxis,
  positionInnovation,
  predictAxis,
  smoothAxis,
  updatePosition,
  updateVelocity,
  type AxisState,
  type AxisStep,
} from './kalman';

/**
 * Cleans a window of raw location fixes (typically 1 per second for ~30 s) into a short, smooth,
 * trustworthy track. Runs on the phone before upload; the same rules protect the server.
 *
 * Stages, each recording why it dropped a fix:
 *  1. gate       — mock locations, missing or poor accuracy (Wi-Fi/cell fallbacks), bad times
 *  2. spike      — A→B→C where B leaves the path and comes back (needs the next fix: look-ahead)
 *  3. physics    — impossible speed, acceleration, or a jump the receiver's own Doppler speed
 *                  contradicts; a run of consistent "impossible" fixes is a real relocation
 *  4. stillness  — parked: hold one position and add no distance
 *  5. smoothing  — Kalman filter forward, Rauch–Tung–Striebel backward, gated by Mahalanobis
 *  6. distance   — along the smoothed full-rate track
 *  7. compress   — Douglas–Peucker keeps turns; plus stops and one point per interval
 */

/** What the phone's motion sensors said (Android activity recognition), when permitted. */
export type MotionActivity = 'still' | 'vehicle' | 'foot' | 'bicycle';

export interface RawFix {
  /** UTC milliseconds of the fix. */
  t: number;
  /** Monotonic milliseconds since boot (Android elapsedRealtimeNanos); safer than t for gaps. */
  e?: number;
  lat: number;
  lon: number;
  /** Horizontal accuracy, metres (68% radius). */
  acc?: number;
  /** Doppler speed, m/s. */
  spd?: number;
  spdAcc?: number;
  /** Degrees clockwise from north. */
  brg?: number;
  brgAcc?: number;
  alt?: number;
  provider?: string;
  mock?: boolean;
  sats?: number;
  act?: MotionActivity;
}

export interface CleanPoint {
  t: number;
  lat: number;
  lon: number;
  /** Estimated position uncertainty after filtering, metres. */
  acc: number;
  /** Speed, m/s. */
  spd: number;
  brg?: number;
  alt?: number;
  /** Parked at this point. */
  still: boolean;
  act?: MotionActivity;
  /** Distance travelled along the track since the previous uploaded point, metres. */
  path: number;
}

export type RejectReason =
  | 'mock'
  | 'noAccuracy'
  | 'inaccurate'
  | 'invalid'
  | 'stale'
  | 'spike'
  | 'tooFast'
  | 'speedMismatch'
  | 'acceleration'
  | 'inconsistent';

export interface FilterReport {
  raw: number;
  kept: number;
  uploaded: number;
  rejected: Partial<Record<RejectReason, number>>;
  /** Runs of "impossible" fixes accepted as a genuine jump (e.g. leaving a tunnel). */
  relocations: number;
  /** Fixes first rejected, then accepted as part of a relocation. */
  recovered: number;
  /** A few rejected fixes with their reason, for debugging. */
  samples: Array<{
    t: number;
    lat: number;
    lon: number;
    acc?: number;
    spd?: number;
    reason: RejectReason;
  }>;
  distanceM: number;
}

export interface FilterOptions {
  /** Accept fixes up to this accuracy while moving / parked; never above the hard limit. */
  maxAccuracyMovingM: number;
  maxAccuracyStillM: number;
  hardMaxAccuracyM: number;
  /** Fastest plausible speed for the vehicle, m/s. */
  maxSpeedMs: number;
  maxAccelerationMs2: number;
  /** Doppler cross-check slack, m/s, added to 3× the reported speed accuracy. */
  dopplerSlackMs: number;
  /** Below this speed for `stillEnterS` seconds counts as parked. */
  stillSpeedMs: number;
  stillEnterS: number;
  /** Above this speed for `moveExitS` seconds ends parking. */
  moveSpeedMs: number;
  moveExitS: number;
  /** Process noise: expected acceleration, m/s (1σ). */
  accelerationNoiseMs2: number;
  /** A gap longer than this restarts the filter. */
  gapResetS: number;
  /** Consecutive consistent rejected fixes that prove a real relocation. */
  relocateAfter: number;
  /** Compression: Douglas–Peucker tolerance and the longest silence while driving. */
  compressToleranceM: number;
  maxIntervalS: number;
  /** While parked, upload at most one point per this many seconds. */
  stillIntervalS: number;
}

export const defaultFilterOptions: FilterOptions = {
  maxAccuracyMovingM: 30,
  maxAccuracyStillM: 50,
  hardMaxAccuracyM: 100,
  maxSpeedMs: 50,
  maxAccelerationMs2: 8,
  dopplerSlackMs: 5,
  stillSpeedMs: 0.8,
  stillEnterS: 5,
  moveSpeedMs: 2,
  moveExitS: 3,
  accelerationNoiseMs2: 2,
  gapResetS: 60,
  relocateAfter: 3,
  compressToleranceM: 5,
  maxIntervalS: 10,
  stillIntervalS: 60,
};

/** Carried from one window to the next (persisted on the phone between uploads). */
export interface FilterState {
  version: 1;
  /** Last fix that passed the gate and physics, for continuity checks. */
  last?: RawFix;
  /** Held back until the next window can confirm it is not a spike. */
  pending?: RawFix;
  /** Rejected-for-physics fixes that agree with each other: possibly a real jump. */
  suspects: RawFix[];
  /** Local metric frame for the filter. */
  origin?: GeoPoint;
  kalman?: { t: number; e?: number; x: AxisState; y: AxisState };
  still?: {
    lat: number;
    lon: number;
    acc: number;
    since: number;
    lastUploaded: number;
    /** Sum of 1/acc² of the fixes averaged into the parked position. */
    weight?: number;
    /** Consecutive fixes beyond the noise, when there is no speed to go by. */
    awayCount?: number;
  };
  slowSince?: number;
  fastSince?: number;
  lastUploaded?: { t: number; lat: number; lon: number };
  /** Last point of the smoothed track, uploaded or not: where distance continues from. */
  lastTrack?: { t: number; lat: number; lon: number };
  /** Distance travelled since the last uploaded point. */
  pathSinceUpload: number;
}

export function initialFilterState(): FilterState {
  return { version: 1, suspects: [], pathSinceUpload: 0 };
}

export interface FilterResult {
  points: CleanPoint[];
  state: FilterState;
  report: FilterReport;
}

/**
 * Filters one window. Pass `final: true` to flush the held-back last fix (a one-off position,
 * or the end of a shift).
 */
export function filterWindow(
  rawFixes: readonly RawFix[],
  previous: FilterState,
  overrides: Partial<FilterOptions> = {},
  final = false,
): FilterResult {
  const options = { ...defaultFilterOptions, ...overrides };
  const state: FilterState = structuredCloneState(previous);
  const report: FilterReport = {
    raw: rawFixes.length,
    kept: 0,
    uploaded: 0,
    rejected: {},
    relocations: 0,
    recovered: 0,
    samples: [],
    distanceM: 0,
  };
  const reject = (fix: RawFix, reason: RejectReason) => {
    report.rejected[reason] = (report.rejected[reason] ?? 0) + 1;
    if (report.samples.length < 8)
      report.samples.push({
        t: fix.t,
        lat: fix.lat,
        lon: fix.lon,
        acc: fix.acc,
        spd: fix.spd,
        reason,
      });
  };

  // 1. Order, de-duplicate and gate.
  const ordered = [...(state.pending ? [state.pending] : []), ...rawFixes].sort(
    (a, b) => a.t - b.t,
  );
  state.pending = undefined;
  const gated: RawFix[] = [];
  let lastTime = state.last?.t ?? -Infinity;
  for (const fix of ordered) {
    const reason = gate(fix, lastTime, options);
    if (reason) {
      // The held-back fix was already counted as raw in its own window.
      reject(fix, reason);
      continue;
    }
    gated.push(fix);
    lastTime = fix.t;
  }

  // 2. Spike rejection with one fix of look-ahead. The last fix waits for the next window.
  const held = !final && gated.length ? gated.pop() : undefined;
  const despiked: RawFix[] = [];
  for (let index = 0; index < gated.length; index += 1) {
    const before = despiked.at(-1) ?? state.last;
    const fix = gated[index]!;
    const after = gated[index + 1] ?? held;
    if (before && after && isSpike(before, fix, after, options)) reject(fix, 'spike');
    else despiked.push(fix);
  }
  if (held) state.pending = held;

  // 3–5. Physics, stillness and the forward filter.
  type Accepted = { fix: RawFix; still: boolean; reset: boolean; anchor?: ParkedAnchor };
  const accepted: Accepted[] = [];
  for (const fix of despiked) {
    const last = state.last;
    const gap = last ? seconds(last, fix) : Infinity;
    let reset = !last || gap > options.gapResetS;
    // While parked with a measured standstill, drift is expected; parking logic handles it.
    const parked = state.still !== undefined && (fix.spd ?? 0) < options.moveSpeedMs;
    const reason =
      reset || parked
        ? undefined
        : (physics(last!, fix, gap, options) ??
          (state.kalman && !consistentWithFilter(state, fix, options)
            ? 'inconsistent'
            : undefined));
    if (reason) {
      // A fix that only disagrees with the past may be right: if the next ones agree with it
      // instead (leaving a tunnel, a long GPS outage), it is a genuine relocation.
      const lastSuspect = state.suspects.at(-1);
      const agrees = !lastSuspect || !physics(lastSuspect, fix, seconds(lastSuspect, fix), options);
      state.suspects = agrees ? [...state.suspects, fix] : [fix];
      if (state.suspects.length < options.relocateAfter) {
        reject(fix, reason);
        continue;
      }
      const earlier = state.suspects.slice(0, -1);
      report.relocations += 1;
      report.recovered += earlier.length;
      earlier.forEach((suspect, index) =>
        accepted.push({ fix: suspect, still: false, reset: index === 0 }),
      );
      reset = earlier.length === 0;
      state.still = undefined;
      state.slowSince = undefined;
    }
    state.suspects = [];
    const still = updateStillness(state, fix, options);
    state.last = fix;
    // A copy: a departure later in this window clears state.still before smoothing runs.
    const anchor = still && state.still ? { ...state.still } : undefined;
    accepted.push({ fix, still, reset, anchor });
  }
  report.kept = accepted.length;

  // Smoothing runs per segment (between resets and parked periods).
  const smoothed = smoothSegments(accepted, state, options);

  // 6–7. Distance and compression.
  const points = compress(smoothed, state, options, report, final);
  report.uploaded = points.length;
  return { points, state, report };
}

function gate(fix: RawFix, lastTime: number, options: FilterOptions): RejectReason | undefined {
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lon) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lon) > 180
  )
    return 'invalid';
  if (fix.lat === 0 && fix.lon === 0) return 'invalid';
  if (fix.mock) return 'mock';
  if (fix.acc === undefined || !Number.isFinite(fix.acc) || fix.acc <= 0) return 'noAccuracy';
  const moving = (fix.spd ?? 0) >= options.stillSpeedMs;
  const limit = Math.min(
    options.hardMaxAccuracyM,
    moving ? options.maxAccuracyMovingM : options.maxAccuracyStillM,
  );
  if (fix.acc > limit) return 'inaccurate';
  if (fix.t <= lastTime) return 'stale';
  return undefined;
}

/** Seconds between fixes: monotonic time when both have it and agree with wall time. */
export function seconds(from: RawFix, to: RawFix): number {
  const wall = (to.t - from.t) / 1000;
  if (from.e !== undefined && to.e !== undefined) {
    const monotonic = (to.e - from.e) / 1000;
    if (monotonic > 0 && Math.abs(monotonic - wall) < 5) return monotonic;
  }
  return wall;
}

function isSpike(before: RawFix, fix: RawFix, after: RawFix, options: FilterOptions) {
  if (seconds(before, after) > 10) return false;
  const direct = meters(before, after);
  const detour = meters(before, fix) + meters(fix, after);
  const offTrack = crossTrackMeters(before, after, fix);
  const tolerance = Math.max(3 * (fix.acc ?? 10), 30);
  if (offTrack <= tolerance || detour <= 2 * direct + 10) return false;
  // Only a spike if going straight from before to after is itself plausible.
  return !physics(before, after, seconds(before, after), options);
}

function physics(
  from: RawFix,
  to: RawFix,
  dt: number,
  options: FilterOptions,
): RejectReason | undefined {
  if (dt <= 0) return 'stale';
  const distance = meters(from, to);
  const slack = (from.acc ?? 0) + (to.acc ?? 0);
  if ((distance - slack) / dt > options.maxSpeedMs) return 'tooFast';
  if (from.spd !== undefined && to.spd !== undefined && dt <= 5) {
    if (Math.abs(to.spd - from.spd) / dt > options.maxAccelerationMs2) return 'acceleration';
    const doppler = (from.spd + to.spd) / 2;
    // Position noise alone moves the implied speed by about (acc₁ + acc₂) / dt; phones tend to
    // under-report accuracy, hence the margin.
    const tolerance =
      3 * Math.max(from.spdAcc ?? 0.5, to.spdAcc ?? 0.5) +
      options.dopplerSlackMs +
      (1.5 * slack) / dt;
    // Turns make the straight line shorter than the path, so only a jump *faster* than the
    // receiver measured is suspicious.
    if (distance > slack + 5 && distance / dt - doppler > tolerance) return 'speedMismatch';
  }
  return undefined;
}

function updateStillness(state: FilterState, fix: RawFix, options: FilterOptions): boolean {
  const speed = fix.spd;
  if (speed !== undefined) {
    if (speed < options.stillSpeedMs) {
      state.slowSince ??= fix.t;
      state.fastSince = undefined;
    } else if (speed > options.moveSpeedMs) {
      state.fastSince ??= fix.t;
      state.slowSince = undefined;
    } else {
      state.slowSince = undefined;
      state.fastSince = undefined;
    }
  }
  const acc = Math.max(fix.acc ?? 30, 3);
  // The motion sensors know the phone is still even when GPS speed is missing (indoors). They
  // report with a delay, so a GPS speed of driving overrides them.
  const sensorStill = fix.act === 'still' && (speed === undefined || speed < options.moveSpeedMs);
  const still = state.still;
  if (still) {
    const away = meters(still, fix);
    // "In a vehicle" plus driving speed ends parking at once instead of after moveExitS.
    const driving =
      (state.fastSince !== undefined && (fix.t - state.fastSince) / 1000 >= options.moveExitS) ||
      (fix.act === 'vehicle' && speed !== undefined && speed > options.moveSpeedMs);
    // With a measured near-zero speed, drift is not movement: only a big displacement (towed,
    // on a ferry) ends parking. Without speed, displacement beyond the noise has to persist.
    const standing = sensorStill || (speed !== undefined && speed < options.moveSpeedMs);
    const limit = standing ? Math.max(50, 4 * acc) : Math.max(25, 2 * acc, 2 * still.acc);
    let displaced = false;
    if (away > limit) {
      still.awayCount = (still.awayCount ?? 0) + 1;
      displaced = still.awayCount >= 3;
    } else still.awayCount = 0;
    if (driving || displaced) {
      state.still = undefined;
      return false;
    }
    // A far-off fix that has not (yet) proven a move must not drag the parked position.
    if (away > limit) return true;
    // The parked position is the accuracy-weighted mean of the fixes so far.
    const weight = 1 / (acc * acc);
    const total = (still.weight ?? 1 / (still.acc * still.acc)) + weight;
    still.lat += ((fix.lat - still.lat) * weight) / total;
    still.lon += ((fix.lon - still.lon) * weight) / total;
    still.weight = total;
    still.acc = Math.max(3, Math.sqrt(1 / total));
    return true;
  }
  const slowLongEnough =
    state.slowSince !== undefined && (fix.t - state.slowSince) / 1000 >= options.stillEnterS;
  if (slowLongEnough || sensorStill) {
    state.still = {
      lat: fix.lat,
      lon: fix.lon,
      acc,
      since: fix.t,
      lastUploaded: 0,
      weight: 1 / (acc * acc),
    };
    return true;
  }
  return false;
}

function consistentWithFilter(state: FilterState, fix: RawFix, options: FilterOptions): boolean {
  const filter = state.kalman!;
  const origin = state.origin!;
  const dt = seconds({ t: filter.t, e: filter.e, lat: 0, lon: 0 }, fix);
  if (dt <= 0) return true;
  const q = options.accelerationNoiseMs2 ** 2;
  const { x, y } = toLocal(origin, fix);
  const r = Math.max(fix.acc ?? 10, 3) ** 2;
  const ix = positionInnovation(predictAxis(filter.x, dt, q), x, r);
  const iy = positionInnovation(predictAxis(filter.y, dt, q), y, r);
  // χ² with 2 degrees of freedom at 99%.
  return ix.residual ** 2 / ix.variance + iy.residual ** 2 / iy.variance <= 9.21;
}

/** Where a parked fix was held, as it was when the fix was accepted. */
type ParkedAnchor = Pick<NonNullable<FilterState['still']>, 'lat' | 'lon' | 'acc'>;

interface SmoothedFix {
  t: number;
  lat: number;
  lon: number;
  acc: number;
  spd: number;
  brg?: number;
  alt?: number;
  still: boolean;
  act?: MotionActivity;
}

function smoothSegments(
  accepted: Array<{ fix: RawFix; still: boolean; reset: boolean; anchor?: ParkedAnchor }>,
  state: FilterState,
  options: FilterOptions,
): SmoothedFix[] {
  const output: SmoothedFix[] = [];
  const q = options.accelerationNoiseMs2 ** 2;
  let segment: Array<{ fix: RawFix; x: AxisStep; y: AxisStep }> = [];
  const flush = () => {
    if (!segment.length) return;
    const xs = smoothAxis(segment.map((step) => step.x));
    const ys = smoothAxis(segment.map((step) => step.y));
    segment.forEach((step, index) => {
      const point = fromLocal(state.origin!, xs[index]!.p, ys[index]!.p);
      const vx = xs[index]!.v;
      const vy = ys[index]!.v;
      const speed = Math.hypot(vx, vy);
      output.push({
        t: step.fix.t,
        ...point,
        acc: Math.sqrt(Math.max(xs[index]!.c[0], ys[index]!.c[0])),
        spd: step.fix.spd ?? speed,
        brg: speed > 2 ? (Math.atan2(vx, vy) * 180) / Math.PI + (vx < 0 ? 360 : 0) : step.fix.brg,
        alt: step.fix.alt,
        still: false,
        act: step.fix.act,
      });
    });
    segment = [];
  };

  for (const { fix, still, reset, anchor: parkedAt } of accepted) {
    if (!state.origin || meters(state.origin, fix) > 50_000) {
      flush();
      state.origin = { latitude: fix.lat, longitude: fix.lon };
      state.kalman = undefined;
    }
    if (still) {
      flush();
      const anchor = parkedAt!;
      const local = toLocal(state.origin, { lat: anchor.lat, lon: anchor.lon });
      state.kalman = {
        t: fix.t,
        e: fix.e,
        x: initialAxis(local.x, anchor.acc ** 2, 0, 0.25),
        y: initialAxis(local.y, anchor.acc ** 2, 0, 0.25),
      };
      output.push({
        t: fix.t,
        lat: anchor.lat,
        lon: anchor.lon,
        acc: anchor.acc,
        spd: 0,
        alt: fix.alt,
        still: true,
        act: fix.act,
      });
      continue;
    }
    const { x, y } = toLocal(state.origin, fix);
    const r = Math.max(fix.acc ?? 10, 3) ** 2;
    let stepX: AxisStep;
    let stepY: AxisStep;
    const filter = state.kalman;
    const dt = filter ? seconds({ t: filter.t, e: filter.e, lat: 0, lon: 0 }, fix) : 0;
    if (reset || !filter || dt <= 0 || dt > options.gapResetS) {
      flush();
      stepX = { filtered: initialAxis(x, r), dt: 0 };
      stepY = { filtered: initialAxis(y, r), dt: 0 };
    } else {
      const px = predictAxis(filter.x, dt, q);
      const py = predictAxis(filter.y, dt, q);
      stepX = { predicted: px, filtered: updatePosition(px, x, r), dt };
      stepY = { predicted: py, filtered: updatePosition(py, y, r), dt };
    }
    // The receiver's Doppler velocity is far more precise than position differences.
    if (fix.spd !== undefined && fix.brg !== undefined && fix.spd >= options.moveSpeedMs) {
      const radians = (fix.brg * Math.PI) / 180;
      const variance = Math.max(fix.spdAcc ?? 0.5, 0.3) ** 2;
      stepX = {
        ...stepX,
        filtered: updateVelocity(stepX.filtered, fix.spd * Math.sin(radians), variance),
      };
      stepY = {
        ...stepY,
        filtered: updateVelocity(stepY.filtered, fix.spd * Math.cos(radians), variance),
      };
    }
    state.kalman = { t: fix.t, e: fix.e, x: stepX.filtered, y: stepY.filtered };
    segment.push({ fix, x: stepX, y: stepY });
  }
  flush();
  return output.sort((a, b) => a.t - b.t);
}

function compress(
  track: SmoothedFix[],
  state: FilterState,
  options: FilterOptions,
  report: FilterReport,
  final: boolean,
): CleanPoint[] {
  if (!track.length) return [];

  // Points that must be uploaded: the very first and every parking change.
  const forced = new Set<number>();
  track.forEach((point, index) => {
    if (!state.lastUploaded && index === 0) forced.add(index);
    if (index > 0 && track[index - 1]!.still !== point.still) forced.add(index);
  });

  // Running distance along the full-rate track since the last uploaded point.
  const pathTo: number[] = [];
  let running = state.pathSinceUpload;
  track.forEach((point, index) => {
    const from = index > 0 ? track[index - 1] : state.lastTrack;
    // Distance counts only while the receiver measures real speed, never for parked drift.
    const moving = !point.still && (point.spd === undefined || point.spd >= options.stillSpeedMs);
    const segment = from && moving ? meters(from, point) : 0;
    running += segment;
    report.distanceM += segment;
    pathTo.push(running);
  });

  // Douglas–Peucker keeps the shape (turns included) with few points. It starts from the last
  // uploaded point, so a turn right at the start of this window is not lost.
  const keep = new Set<number>(forced);
  const shape: Array<{ lat: number; lon: number }> = [
    ...(state.lastUploaded ? [state.lastUploaded] : []),
    ...track,
  ];
  const offset = state.lastUploaded ? 1 : 0;
  const anchors = [
    ...new Set([0, ...[...forced].map((index) => index + offset), shape.length - 1]),
  ].sort((a, b) => a - b);
  const picked = new Set<number>();
  for (let a = 0; a + 1 < anchors.length; a += 1)
    douglasPeucker(shape, anchors[a]!, anchors[a + 1]!, options.compressToleranceM, picked);
  for (const index of picked) if (index - offset >= 0) keep.add(index - offset);

  const kept: CleanPoint[] = [];
  let uploadedAt = 0;
  track.forEach((point, index) => {
    const lastTime = state.lastUploaded?.t;
    const silent = lastTime === undefined || (point.t - lastTime) / 1000 >= options.maxIntervalS;
    const due = point.still
      ? forced.has(index) ||
        point.t - (state.still?.lastUploaded ?? 0) >= options.stillIntervalS * 1000
      : keep.has(index) || silent;
    if (!due && !(final && index === track.length - 1)) return;
    kept.push({
      t: point.t,
      lat: round(point.lat, 7),
      lon: round(point.lon, 7),
      acc: round(point.acc, 1),
      spd: round(point.spd, 2),
      ...(point.brg !== undefined ? { brg: round(point.brg, 1) } : {}),
      ...(point.alt !== undefined ? { alt: round(point.alt, 1) } : {}),
      still: point.still,
      ...(point.act !== undefined ? { act: point.act } : {}),
      path: round(pathTo[index]! - uploadedAt, 1),
    });
    uploadedAt = pathTo[index]!;
    state.lastUploaded = { t: point.t, lat: point.lat, lon: point.lon };
    if (point.still && state.still) state.still.lastUploaded = point.t;
  });
  state.pathSinceUpload = pathTo[track.length - 1]! - uploadedAt;
  const end = track[track.length - 1]!;
  state.lastTrack = { t: end.t, lat: end.lat, lon: end.lon };
  return kept;
}

function douglasPeucker(
  track: Array<{ lat: number; lon: number }>,
  from: number,
  to: number,
  tolerance: number,
  keep: Set<number>,
) {
  if (to - from < 2) return;
  let worst = -1;
  let worstDistance = tolerance;
  for (let index = from + 1; index < to; index += 1) {
    const distance = crossTrackMeters(track[from]!, track[to]!, track[index]!);
    if (distance > worstDistance) {
      worst = index;
      worstDistance = distance;
    }
  }
  if (worst < 0) return;
  keep.add(worst);
  douglasPeucker(track, from, worst, tolerance, keep);
  douglasPeucker(track, worst, to, tolerance, keep);
}

type LatLon = { lat: number; lon: number } | GeoPoint;
const latOf = (point: LatLon) => ('lat' in point ? point.lat : point.latitude);
const lonOf = (point: LatLon) => ('lon' in point ? point.lon : point.longitude);
const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance for either coordinate shape. */
function meters(a: LatLon, b: LatLon) {
  return distanceMeters(
    { latitude: latOf(a), longitude: lonOf(a) },
    { latitude: latOf(b), longitude: lonOf(b) },
  );
}

/** Equirectangular projection around an origin: accurate to centimetres over tens of kilometres. */
function toLocal(origin: GeoPoint, point: LatLon) {
  const cos = Math.cos((origin.latitude * Math.PI) / 180);
  return {
    x: ((lonOf(point) - origin.longitude) * Math.PI * EARTH_RADIUS_M * cos) / 180,
    y: ((latOf(point) - origin.latitude) * Math.PI * EARTH_RADIUS_M) / 180,
  };
}

function fromLocal(origin: GeoPoint, x: number, y: number) {
  const cos = Math.cos((origin.latitude * Math.PI) / 180);
  return {
    lat: origin.latitude + (y * 180) / (Math.PI * EARTH_RADIUS_M),
    lon: origin.longitude + (x * 180) / (Math.PI * EARTH_RADIUS_M * cos),
  };
}

/** Distance of `point` from the segment from→to, metres. */
export function crossTrackMeters(from: LatLon, to: LatLon, point: LatLon): number {
  const origin = { latitude: latOf(from), longitude: lonOf(from) };
  const b = toLocal(origin, to);
  const p = toLocal(origin, point);
  const lengthSquared = b.x * b.x + b.y * b.y;
  if (lengthSquared === 0) return Math.hypot(p.x, p.y);
  const along = Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / lengthSquared));
  return Math.hypot(p.x - along * b.x, p.y - along * b.y);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function structuredCloneState(state: FilterState): FilterState {
  return JSON.parse(JSON.stringify(state)) as FilterState;
}
