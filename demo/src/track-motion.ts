/**
 * E031 (proposed, measured before it is kept): a track that moves like a planned flight. Two pure steps on the path in local metres:
 *
 * 1. `roundCorners`: each corner is replaced by a quadratic curve that starts and ends `radius` metres (at most half of each
 *    neighbouring segment) before and after it, so the camera's path has no kinks (Litchi's "curve size", in spirit).
 * 2. `speedProfile`: the speed along the path is the largest that keeps, at every point, the speed under a cruise speed, the sideways
 *    acceleration v² κ under `lateralAccel`, the heading rate v κ under `headingRate`, and the change of speed under `accel`
 *    (a forward and a backward pass; starting and ending at rest). The tour's seconds then come out of the plan instead of being
 *    written by hand. Jerk is not limited (an acceleration limit first; measured before anything more).
 *
 * All limits are experimental parameters to be judged by eye, not the performance of any aircraft.
 */

export interface TrackMotion {
  /** Cruise speed on straight parts, m/s. */
  cruise: number;
  /** Largest sideways acceleration in turns, m/s². */
  lateralAccel: number;
  /** Largest change of speed, m/s². */
  accel: number;
  /** Largest heading change, degrees per second. */
  headingRate: number;
  /** Corner rounding: the curve starts this many metres before a corner (0: none). */
  radius: number;
}

export const DEFAULT_TRACK_MOTION: TrackMotion = { cruise: 40, lateralAccel: 4, accel: 2, headingRate: 15, radius: 40 };

type P = [number, number];

/** Corners replaced by quadratic curves (8 segments each); values carried along by `extra` are interpolated the same way. */
export function roundCorners(xy: readonly P[], extra: readonly number[], radius: number): { xy: P[]; extra: number[] } {
  if (radius <= 0 || xy.length < 3) return { xy: xy.map((p) => [p[0], p[1]]), extra: [...extra] };
  const out: P[] = [[xy[0]![0], xy[0]![1]]];
  const ex: number[] = [extra[0]!];
  for (let i = 1; i < xy.length - 1; i++) {
    const a = xy[i - 1]!, v = xy[i]!, b = xy[i + 1]!;
    const la = Math.hypot(v[0] - a[0], v[1] - a[1]), lb = Math.hypot(b[0] - v[0], b[1] - v[1]);
    const d = Math.min(radius, la / 2, lb / 2);
    if (d <= 0) continue;
    const p0: P = [v[0] + ((a[0] - v[0]) * d) / la, v[1] + ((a[1] - v[1]) * d) / la];
    const p2: P = [v[0] + ((b[0] - v[0]) * d) / lb, v[1] + ((b[1] - v[1]) * d) / lb];
    const e0 = extra[i]! + ((extra[i - 1]! - extra[i]!) * d) / la, e2 = extra[i]! + ((extra[i + 1]! - extra[i]!) * d) / lb;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * v[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * v[1] + t * t * p2[1]]);
      ex.push(u * u * e0 + 2 * u * t * extra[i]! + t * t * e2);
    }
  }
  out.push([xy[xy.length - 1]![0], xy[xy.length - 1]![1]]);
  ex.push(extra[extra.length - 1]!);
  return { xy: out, extra: ex };
}

/** Arc length at each vertex. */
export function arcLengths(xy: readonly P[]): number[] {
  const s = [0];
  for (let i = 1; i < xy.length; i++) s.push(s[i - 1]! + Math.hypot(xy[i]![0] - xy[i - 1]![0], xy[i]![1] - xy[i - 1]![1]));
  return s;
}

/**
 * The time along the path, by arc length, for a stretch from `s0` to `s1` of the path (the part the camera's base point travels):
 * returns increasing times and arc lengths sampled every `step` metres, starting and ending at rest.
 */
export function speedProfile(xy: readonly P[], s0: number, s1: number, m: TrackMotion, step = 2, window = 25): { t: number[]; s: number[] } {
  const arc = arcLengths(xy);
  const total = arc[arc.length - 1]!;
  const at = (s: number): P => {
    const c = Math.min(total, Math.max(0, s));
    let i = 1;
    while (i < arc.length - 1 && arc[i]! < c) i++;
    const a = arc[i - 1]!, b = arc[i]!, f = b > a ? (c - a) / (b - a) : 0;
    return [xy[i - 1]![0] + (xy[i]![0] - xy[i - 1]![0]) * f, xy[i - 1]![1] + (xy[i]![1] - xy[i - 1]![1]) * f];
  };
  // The direction of travel smoothed over ±window metres (the same smoothing that turns the camera, shot-player.ts); the curvature is
  // how fast it turns per metre. Vertex-by-vertex curvature would see every metre-scale kink of a mapped centre line as a hairpin.
  const heading = (s: number): number => { const p = at(s + window), q = at(s - window); return Math.atan2(p[1] - q[1], p[0] - q[0]); };
  const curvatureAt = (s: number): number => {
    let d = Math.abs(heading(s + step / 2) - heading(s - step / 2));
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d / step;
  };
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const ss = Array.from({ length: n }, (_, i) => s0 + ((s1 - s0) * i) / (n - 1));
  const ds = (s1 - s0) / (n - 1);
  const omega = (m.headingRate * Math.PI) / 180;
  const vmax = ss.map((s) => {
    const k = curvatureAt(s);
    return Math.min(m.cruise, k > 0 ? Math.sqrt(m.lateralAccel / k) : Infinity, k > 0 ? omega / k : Infinity);
  });
  vmax[0] = 0; vmax[n - 1] = 0;
  const v = [...vmax];
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i]!, Math.sqrt(v[i - 1]! ** 2 + 2 * m.accel * ds)); // forward: speed up no faster than accel
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i]!, Math.sqrt(v[i + 1]! ** 2 + 2 * m.accel * ds)); // backward: slow down in time
  const t = [0];
  for (let i = 1; i < n; i++) {
    const mean = (v[i - 1]! + v[i]!) / 2;
    t.push(t[i - 1]! + (mean > 1e-6 ? ds / mean : Math.sqrt((2 * ds) / m.accel)));
  }
  return { t, s: ss };
}

/** Arc length at time `time` (linear between samples; clamped). */
export function arcAt(profile: { t: readonly number[]; s: readonly number[] }, time: number): number {
  const { t, s } = profile;
  if (time <= 0) return s[0]!;
  if (time >= t[t.length - 1]!) return s[s.length - 1]!;
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid]! <= time) lo = mid; else hi = mid; }
  const f = (time - t[lo]!) / (t[hi]! - t[lo]!);
  return s[lo]! + (s[hi]! - s[lo]!) * f;
}
