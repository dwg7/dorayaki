import assert from "node:assert/strict";
import { test } from "node:test";

import { flightStats, sampleFlight } from "../demo/src/flight-log.js";
import { buildTimeline, cameraOfMapView, parseShotScript } from "../demo/src/shot-player.js";
import { arcAt, arcLengths, roundCorners, speedProfile, type TrackMotion } from "../demo/src/track-motion.js";

const M: TrackMotion = { cruise: 40, lateralAccel: 4, accel: 2, headingRate: 15, radius: 40 };

test("E031 roundCorners: a right angle becomes a curve that starts and ends `radius` before and after it; straight ends stay", () => {
  const { xy } = roundCorners([[0, 0], [200, 0], [200, 200]], [0, 0, 0], 40);
  assert.deepEqual(xy[0], [0, 0]);
  assert.deepEqual(xy[xy.length - 1], [200, 200]);
  assert.deepEqual(xy[1], [160, 0]);
  assert.deepEqual(xy[9], [200, 40]);
  assert.ok(Math.abs(arcLengths(xy)[xy.length - 1]! - 400) > 1, "shorter than the corner");
});

test("E031 speedProfile: cruise on the straight, slower in the turn, from rest to rest, never faster than accel allows", () => {
  const { xy } = roundCorners([[0, 0], [1000, 0], [1000, 1000]], [0, 0, 0], 40);
  const len = arcLengths(xy)[xy.length - 1]!;
  const p = speedProfile(xy, 0, len, M);
  const v = p.s.slice(1).map((s, i) => (s - p.s[i]!) / (p.t[i + 1]! - p.t[i]!));
  assert.ok(Math.max(...v) <= M.cruise + 1e-6);
  assert.ok(Math.max(...v) > 39, "reaches cruise on a 1 km straight");
  const turn = v[Math.round(v.length / 2)]!;
  assert.ok(turn < 20, `slower in the 40 m curve: ${turn.toFixed(1)} m/s`);
  // Away from the two ends (where segment means from rest distort a finite difference), the change of speed stays near `accel`.
  for (let i = 4; i < v.length - 4; i++) assert.ok(Math.abs(v[i]! - v[i - 1]!) / (p.t[i + 1]! - p.t[i]!) <= M.accel * 1.6, `acceleration bounded at ${i}`);
  assert.equal(arcAt(p, 0), 0);
  assert.equal(arcAt(p, p.t[p.t.length - 1]! + 5), len);
});

test("E031 a track with motion gets its duration from the plan and turns gently; look_at keeps the camera on a point", () => {
  const path = [[129.72, 33.17], [129.73, 33.17], [129.73, 33.18]];
  const plain = parseShotScript({ shots: [{ type: "track", duration_s: 20, path, offset_m: 60, alt_m: 80, lead_m: 120 }] });
  const planned = parseShotScript({ shots: [{ type: "track", path, offset_m: 60, alt_m: 80, lead_m: 120, motion: {} }] });
  assert.ok(planned.shots[0]!.duration_s > 30, `${planned.shots[0]!.duration_s} s`);
  const start = cameraOfMapView({ lng: 129.72, lat: 33.17, zoom: 16, pitch: 60, bearing: 0 }, 800);
  const rate = (s: typeof plain) => flightStats(sampleFlight(buildTimeline(s.shots, start, 800), 0.1)).shots.find((r) => r.shot === 0)!.maxBearingRate;
  assert.ok(rate(planned) < rate(plain), `${rate(planned).toFixed(1)} < ${rate(plain).toFixed(1)} deg/s`);
  assert.ok(rate(planned) <= 16, "about the 15 deg/s limit");
  const poi = parseShotScript({ shots: [{ type: "track", path, offset_m: 60, alt_m: 80, motion: {}, look_at: { lng: 129.725, lat: 33.175 } }] });
  const tl = buildTimeline(poi.shots, start, 800);
  for (const u of [0.1, 0.5, 0.9]) {
    const c = tl.segments[0]!.at(u);
    assert.ok(Math.abs(c.lng - 129.725) < 1e-9 && Math.abs(c.lat - 33.175) < 1e-9, "looking at the point");
  }
  assert.ok(planned.warnings.length === 0);
  assert.match(parseShotScript({ shots: [{ type: "track", duration_s: 5, path, alt_m: 80, motion: {} }] }).warnings[0]!, /from its plan/);
});
