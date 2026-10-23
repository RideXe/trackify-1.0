/**
 * Constant-velocity Kalman filter for one axis (east or north, in metres), with a
 * Rauch–Tung–Striebel smoother. With isotropic position and velocity noise the two axes are
 * independent, so a 2-D track is two of these, which keeps the maths small and easy to check.
 *
 * State: [position, velocity]. Covariance is stored as [p00, p01, p11] (symmetric).
 */
export interface AxisState {
  p: number;
  v: number;
  c: [number, number, number];
}

export interface AxisStep {
  /** Filtered state after this step's measurements. */
  filtered: AxisState;
  /** Prediction for this step before its measurements (undefined for the first step). */
  predicted?: AxisState;
  dt: number;
}

export function initialAxis(
  position: number,
  positionVariance: number,
  velocity = 0,
  velocityVariance = 100,
): AxisState {
  return { p: position, v: velocity, c: [positionVariance, 0, velocityVariance] };
}

/** White-noise-acceleration model: `accelerationVariance` is σa² in (m/s²)². */
export function predictAxis(state: AxisState, dt: number, accelerationVariance: number): AxisState {
  const [p00, p01, p11] = state.c;
  const q00 = (accelerationVariance * dt ** 4) / 4;
  const q01 = (accelerationVariance * dt ** 3) / 2;
  const q11 = accelerationVariance * dt ** 2;
  return {
    p: state.p + state.v * dt,
    v: state.v,
    c: [p00 + 2 * dt * p01 + dt * dt * p11 + q00, p01 + dt * p11 + q01, p11 + q11],
  };
}

/** Innovation and its variance for a position measurement, for gating before updating. */
export function positionInnovation(state: AxisState, measured: number, variance: number) {
  return { residual: measured - state.p, variance: state.c[0] + variance };
}

export function updatePosition(state: AxisState, measured: number, variance: number): AxisState {
  const [p00, p01, p11] = state.c;
  const s = p00 + variance;
  const k0 = p00 / s;
  const k1 = p01 / s;
  const residual = measured - state.p;
  return {
    p: state.p + k0 * residual,
    v: state.v + k1 * residual,
    c: [(1 - k0) * p00, (1 - k0) * p01, p11 - k1 * p01],
  };
}

export function updateVelocity(state: AxisState, measured: number, variance: number): AxisState {
  const [p00, p01, p11] = state.c;
  const s = p11 + variance;
  const k0 = p01 / s;
  const k1 = p11 / s;
  const residual = measured - state.v;
  return {
    p: state.p + k0 * residual,
    v: state.v + k1 * residual,
    c: [p00 - k0 * p01, p01 - k0 * p11, (1 - k1) * p11],
  };
}

/**
 * Backward smoothing pass over a run of steps. Each estimate then uses the fixes after it too,
 * which removes the lag (corner cutting) a forward-only filter has at turns.
 */
export function smoothAxis(steps: AxisStep[]): AxisState[] {
  if (!steps.length) return [];
  const smoothed: AxisState[] = new Array<AxisState>(steps.length);
  smoothed[steps.length - 1] = steps[steps.length - 1]!.filtered;
  for (let k = steps.length - 2; k >= 0; k -= 1) {
    const filtered = steps[k]!.filtered;
    const next = steps[k + 1]!;
    const predicted = next.predicted;
    if (!predicted) {
      smoothed[k] = filtered;
      continue;
    }
    const dt = next.dt;
    const [f00, f01, f11] = filtered.c;
    const [q00, q01, q11] = predicted.c;
    // C = P_f Fᵀ P_p⁻¹ with F = [[1, dt], [0, 1]].
    const a00 = f00 + dt * f01;
    const a01 = f01;
    const a10 = f01 + dt * f11;
    const a11 = f11;
    const det = q00 * q11 - q01 * q01;
    if (Math.abs(det) < 1e-12) {
      smoothed[k] = filtered;
      continue;
    }
    const i00 = q11 / det;
    const i01 = -q01 / det;
    const i11 = q00 / det;
    const c00 = a00 * i00 + a01 * i01;
    const c01 = a00 * i01 + a01 * i11;
    const c10 = a10 * i00 + a11 * i01;
    const c11 = a10 * i01 + a11 * i11;
    const later = smoothed[k + 1]!;
    const dp = later.p - predicted.p;
    const dv = later.v - predicted.v;
    const d00 = later.c[0] - q00;
    const d01 = later.c[1] - q01;
    const d11 = later.c[2] - q11;
    // P_s = P_f + C (P_s,next − P_p) Cᵀ
    const m00 = c00 * d00 + c01 * d01;
    const m01 = c00 * d01 + c01 * d11;
    const m10 = c10 * d00 + c11 * d01;
    const m11 = c10 * d01 + c11 * d11;
    smoothed[k] = {
      p: filtered.p + c00 * dp + c01 * dv,
      v: filtered.v + c10 * dp + c11 * dv,
      c: [f00 + m00 * c00 + m01 * c01, f01 + m00 * c10 + m01 * c11, f11 + m10 * c10 + m11 * c11],
    };
  }
  return smoothed;
}
