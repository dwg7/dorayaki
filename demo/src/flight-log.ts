/**
 * E031: a flight log of a tour before it plays — how the camera would move, from the player's own timeline (no DOM). The timeline is
 * sampled every `dt` seconds; the camera's place is the look-at point moved back by the horizontal stand-off against the bearing and up
 * by the height above it (the MapLibre approximation of shot-player.ts). From it: speed, acceleration and jerk of the camera, the turn
 * rates of the bearing and the pitch, and the speed of the look-at point. A jump faster than `cutSpeed` (a cut between shots) is counted
 * as a cut and left out of the rates. Terms: *bearing* is the MapLibre bearing (the direction the camera looks, from north, clockwise);
 * *pitch* is degrees from straight down. Without terrain the look-at height is the timeline's `elevation` or 0.
 */
import { sampleTimeline, type Timeline } from "./shot-player.js";

const DEG = Math.PI / 180;
const R = 6378137;

export interface FlightSample {
  t: number;
  shot: number;
  /** Camera place, metres east and north of the first sample's look-at point, and height. */
  e: number; n: number; up: number;
  bearing: number; pitch: number;
  /** Look-at point, metres east and north (same origin). */
  le: number; ln: number;
}

export interface FlightStats {
  /** Per shot index (and -1 for the whole tour): maxima, and the mean speed. */
  shots: Array<{ shot: number; maxSpeed: number; meanSpeed: number; maxAccel: number; maxJerk: number; maxBearingRate: number; maxPitchRate: number; maxLookSpeed: number; minHeight: number }>;
  cuts: Array<{ t: number; jump: number }>;
}

/** The camera every `dt` seconds. */
export function sampleFlight(timeline: Timeline, dt = 0.1): FlightSample[] {
  const out: FlightSample[] = [];
  const first = sampleTimeline(timeline, 0).camera;
  const lat0 = first.lat, lng0 = first.lng;
  const kx = R * DEG * Math.cos(lat0 * DEG), ky = R * DEG;
  for (let t = 0; t <= timeline.duration + 1e-9; t += dt) {
    const { camera: c, index } = sampleTimeline(timeline, t);
    const le = (c.lng - lng0) * kx, ln = (c.lat - lat0) * ky;
    const h = c.distance * Math.sin(c.pitch * DEG), v = c.distance * Math.cos(c.pitch * DEG);
    out.push({ t, shot: index, e: le - h * Math.sin(c.bearing * DEG), n: ln - h * Math.cos(c.bearing * DEG), up: (c.elevation ?? 0) + v, bearing: c.bearing, pitch: c.pitch, le, ln });
  }
  return out;
}

/** Bearing difference the short way round, degrees. */
const turn = (a: number, b: number): number => ((((b - a) % 360) + 540) % 360) - 180;

/** Rates from the samples (finite differences); jumps faster than `cutSpeed` m/s are cuts. */
export function flightStats(s: readonly FlightSample[], cutSpeed = 2000): FlightStats {
  const n = s.length;
  if (n < 2) return { shots: [], cuts: [] };
  const dt = s[1]!.t - s[0]!.t;
  const speed: number[] = [], cut: boolean[] = [];
  const cuts: FlightStats["cuts"] = [];
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(s[i]!.e - s[i - 1]!.e, s[i]!.n - s[i - 1]!.n, s[i]!.up - s[i - 1]!.up);
    const isCut = d / dt > cutSpeed;
    cut.push(isCut); speed.push(isCut ? NaN : d / dt);
    if (isCut) cuts.push({ t: +s[i]!.t.toFixed(2), jump: Math.round(d) });
  }
  // Acceleration from velocity vectors, jerk from acceleration (both skip samples next to a cut).
  const vel = (i: number): [number, number, number] => [(s[i]!.e - s[i - 1]!.e) / dt, (s[i]!.n - s[i - 1]!.n) / dt, (s[i]!.up - s[i - 1]!.up) / dt];
  const acc: number[] = new Array(n).fill(NaN), accV: Array<[number, number, number] | undefined> = new Array(n);
  for (let i = 2; i < n; i++) {
    if (cut[i - 1] || cut[i - 2]) continue;
    const a = vel(i), b = vel(i - 1);
    accV[i] = [(a[0] - b[0]) / dt, (a[1] - b[1]) / dt, (a[2] - b[2]) / dt];
    acc[i] = Math.hypot(...accV[i]!);
  }
  const jerk: number[] = new Array(n).fill(NaN);
  for (let i = 3; i < n; i++) if (accV[i] && accV[i - 1]) jerk[i] = Math.hypot(accV[i]![0] - accV[i - 1]![0], accV[i]![1] - accV[i - 1]![1], accV[i]![2] - accV[i - 1]![2]) / dt;
  const rows = new Map<number, FlightStats["shots"][number] & { sum: number; count: number }>();
  const row = (k: number) => {
    let r = rows.get(k);
    if (!r) { r = { shot: k, maxSpeed: 0, meanSpeed: 0, maxAccel: 0, maxJerk: 0, maxBearingRate: 0, maxPitchRate: 0, maxLookSpeed: 0, minHeight: Infinity, sum: 0, count: 0 }; rows.set(k, r); }
    return r;
  };
  for (let i = 1; i < n; i++) {
    for (const k of [s[i]!.shot, -1]) {
      const r = row(k);
      r.minHeight = Math.min(r.minHeight, s[i]!.up);
      if (cut[i - 1]) continue;
      const v = speed[i - 1]!;
      r.maxSpeed = Math.max(r.maxSpeed, v); r.sum += v; r.count++;
      if (Number.isFinite(acc[i]!)) r.maxAccel = Math.max(r.maxAccel, acc[i]!);
      if (Number.isFinite(jerk[i]!)) r.maxJerk = Math.max(r.maxJerk, jerk[i]!);
      r.maxBearingRate = Math.max(r.maxBearingRate, Math.abs(turn(s[i - 1]!.bearing, s[i]!.bearing)) / dt);
      r.maxPitchRate = Math.max(r.maxPitchRate, Math.abs(s[i]!.pitch - s[i - 1]!.pitch) / dt);
      r.maxLookSpeed = Math.max(r.maxLookSpeed, Math.hypot(s[i]!.le - s[i - 1]!.le, s[i]!.ln - s[i - 1]!.ln) / dt);
    }
  }
  const shots = [...rows.values()].sort((a, b) => a.shot - b.shot).map(({ sum, count, ...r }) => ({ ...r, meanSpeed: count ? sum / count : 0 }));
  return { shots, cuts };
}
