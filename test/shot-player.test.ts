import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { distanceForZoom, zoomForDistance } from "../demo/src/camera.js";
import {
  buildTimeline, cameraOfMapView, describePlayback, ease, mapViewOf, parseShotScript, playShots, sampleTimeline,
  type CameraState, type MapView, type PlayerMap, type Shot,
} from "../demo/src/shot-player.js";

const H = 600;
const DEG = Math.PI / 180;
const start: CameraState = { lng: 129.72, lat: 33.179, distance: 700, pitch: 60, bearing: -30 };
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const alt = (c: CameraState): number => c.distance * Math.cos(c.pitch * DEG);
const horiz = (c: CameraState): number => c.distance * Math.sin(c.pitch * DEG);
const shots = (list: unknown[]): Shot[] => parseShotScript({ shots: list }).shots;

test("zoom and camera distance convert both ways, and the map view round-trips", () => {
  for (const z of [13, 16.4, 18.5]) assert.ok(near(zoomForDistance(distanceForZoom(z, H, 33.18), H, 33.18), z));
  const v = mapViewOf(cameraOfMapView({ lng: 129.7, lat: 33.17, zoom: 16.4, pitch: 62, bearing: -30 }, H), H);
  assert.ok(near(v.zoom, 16.4) && v.pitch === 62 && v.bearing === -30 && v.center[0] === 129.7);
  assert.equal(mapViewOf({ ...start, pitch: 89 }, H, 85).pitch, 85);
});

test("easings run from 0 to 1, clamp outside, and easeInOut passes the middle at one half", () => {
  for (const e of ["linear", "easeIn", "easeOut", "easeInOut"] as const) {
    assert.equal(ease(e, 0), 0);
    assert.equal(ease(e, 1), 1);
    assert.equal(ease(e, -1), 0);
    assert.equal(ease(e, 2), 1);
  }
  assert.ok(near(ease("easeInOut", 0.5), 0.5));
  assert.ok(ease("easeIn", 0.3) < 0.3 && ease("easeOut", 0.3) > 0.3);
});

test("the script is pure data: unknown types (track), missing look-at, bad durations and easings are refused; extra keys are ignored", () => {
  assert.throws(() => parseShotScript({}), /shots/);
  assert.throws(() => shots([{ type: "track", duration_s: 4, look_at: { lng: 0, lat: 0 } }]), /track/);
  assert.throws(() => shots([{ type: "hold", duration_s: 4 }]), /look_at/);
  assert.throws(() => shots([{ type: "hold", duration_s: 0, look_at: { lng: 0, lat: 0 } }]), /positive/);
  assert.throws(() => shots([{ type: "hold", duration_s: 2, easing: "bounce", look_at: { lng: 0, lat: 0 } }]), /easing/);
  assert.throws(() => shots([{ type: "crane", duration_s: 2, look_at: { lng: 0, lat: 0 }, to: {} }]), /alt_m/);
  assert.throws(() => shots([{ type: "dolly", duration_s: 2, look_at: { lng: 0, lat: 0 }, to: { range_m: "near" } }]), /number/);
  const ok = shots([{ type: "hold", duration_s: 2, look_at: { lng: 1, lat: 2 }, intent: "x", subject: "y", _note: "z" }]);
  assert.equal(ok[0]!.easing, "easeInOut");
});

test("hold: a still camera at the given look-at point, zoom, pitch and bearing", () => {
  const tl = buildTimeline(shots([{ type: "hold", duration_s: 4, look_at: { lng: 129.7198, lat: 33.179 }, camera: { zoom: 16.4, pitch: 62, bearing: -30 } }]), start, H);
  const a = sampleTimeline(tl, 0).camera, b = sampleTimeline(tl, 3.9).camera;
  assert.deepEqual(a, b);
  const v = mapViewOf(a, H);
  assert.ok(near(v.zoom, 16.4) && v.pitch === 62 && v.bearing === -30 && v.center[0] === 129.7198);
});

test("crane: the camera rises from alt to alt at its stand-off and bearing, holding the subject", () => {
  const tl = buildTimeline(shots([{ type: "crane", duration_s: 8, look_at: { lng: 129.705, lat: 33.17 }, from: { alt_m: 60 }, to: { alt_m: 900 } }]), start, H);
  const a = sampleTimeline(tl, 0).camera, m = sampleTimeline(tl, 4).camera, b = sampleTimeline(tl, 8).camera;
  assert.ok(near(alt(a), 60) && near(alt(b), 900));
  for (const c of [a, m, b]) {
    assert.ok(near(horiz(c), horiz(start)), "the stand-off is kept");
    assert.equal(c.bearing, start.bearing);
    assert.ok(c.lng === 129.705 && c.lat === 33.17);
  }
  assert.ok(a.pitch > m.pitch && m.pitch > b.pitch, "rising, it looks down more steeply");
});

test("traverse: the look-at point travels A to B, the camera settles at its end place and pulls back on the way", () => {
  const A = { lng: 129.705, lat: 33.17 }, B = { lng: 129.7198, lat: 33.179 };
  const tl = buildTimeline(shots([{ type: "traverse", duration_s: 10, easing: "easeInOut", from_look_at: A, to_look_at: B, camera: { alt_m: 600, bearing: -30, pitch: 55 } }]), start, H);
  const a = sampleTimeline(tl, 0).camera, m = sampleTimeline(tl, 5).camera, b = sampleTimeline(tl, 10).camera;
  assert.ok(a.lng === A.lng && a.lat === A.lat && near(b.lng, B.lng) && near(b.lat, B.lat));
  assert.ok(near(alt(b), 600) && near(b.pitch, 55) && near(b.bearing, -30));
  assert.ok(m.distance > Math.max(a.distance, b.distance), "pulled back in the middle");
  assert.ok(m.lng > A.lng && m.lng < B.lng);
});

test("orbit: a full circle at a fixed radius and height; alt + radius decide the pitch, with a warning when the script's pitch disagrees", () => {
  const script = parseShotScript({ shots: [{ type: "orbit", duration_s: 10, easing: "linear", look_at: { lng: 129.7198, lat: 33.179 }, camera: { alt_m: 400, radius_m: 800, pitch: 55 } }] });
  assert.equal(script.warnings.length, 1);
  const tl = buildTimeline(script.shots, start, H);
  for (const t of [0, 2.5, 5, 7.5, 10]) {
    const c = sampleTimeline(tl, t).camera;
    assert.ok(near(alt(c), 400) && near(horiz(c), 800));
  }
  assert.ok(near(sampleTimeline(tl, 10).camera.bearing - sampleTimeline(tl, 0).camera.bearing, 360));
  assert.ok(near(sampleTimeline(tl, 5).camera.bearing, start.bearing + 180));
});

test("dolly: along the view axis to the given range, pitch and bearing kept, steadily closer", () => {
  const tl = buildTimeline(shots([
    { type: "hold", duration_s: 1, look_at: { lng: 129.7198, lat: 33.179 }, camera: { range_m: 1500, pitch: 50, bearing: 10 } },
    { type: "dolly", duration_s: 6, easing: "easeOut", look_at: { lng: 129.7198, lat: 33.179 }, to: { range_m: 250 } },
  ]), start, H);
  let last = Infinity;
  for (const t of [1, 2, 3, 5, 7]) {
    const c = sampleTimeline(tl, t).camera;
    assert.ok(c.distance <= last + 1e-9 && c.pitch === 50 && c.bearing === 10);
    last = c.distance;
  }
  assert.ok(near(sampleTimeline(tl, 1).camera.distance, 1500) && near(sampleTimeline(tl, 7).camera.distance, 250));
});

test("a timeline joins its shots: duration is the sum, the index follows the shot, and past the end the last frame stays", () => {
  const tl = buildTimeline(shots([
    { type: "hold", duration_s: 2, look_at: { lng: 1, lat: 2 }, camera: { range_m: 500 } },
    { type: "dolly", duration_s: 3, look_at: { lng: 1, lat: 2 }, to: { range_m: 100 } },
  ]), start, H);
  assert.equal(tl.duration, 5);
  assert.equal(sampleTimeline(tl, 1).index, 0);
  assert.equal(sampleTimeline(tl, 2.5).index, 1);
  assert.deepEqual(sampleTimeline(tl, 99).camera, sampleTimeline(tl, 5).camera);
  assert.ok(near(sampleTimeline(tl, 99).camera.distance, 100));
});

test("the Sasebo example (demo/shots/sasebo.json) parses and plays: five shots, 38 s, inside the archive's bounds, one warning (the orbit's pitch)", () => {
  const script = parseShotScript(JSON.parse(readFileSync(new URL("../../demo/shots/sasebo.json", import.meta.url), "utf8")));
  assert.deepEqual(script.shots.map((s) => s.type), ["hold", "crane", "traverse", "orbit", "dolly"]);
  assert.equal(script.warnings.length, 1);
  const tl = buildTimeline(script.shots, start, H);
  assert.equal(tl.duration, 38);
  for (let t = 0; t <= tl.duration; t += 0.5) {
    const c = sampleTimeline(tl, t).camera;
    assert.ok(c.lng >= 129.7018 && c.lng <= 129.7595 && c.lat >= 33.133 && c.lat <= 33.1835, `look-at outside the data at ${t} s`);
    assert.ok(Number.isFinite(mapViewOf(c, H).zoom));
  }
});

/** A map that records jumpTo, with a container whose listeners the test can fire, and a frame clock the test advances. */
function fakeMap() {
  const listeners = new Map<string, (event: { target: unknown }) => void>();
  const view = { lng: 129.72, lat: 33.179, zoom: 16, pitch: 60, bearing: 0 };
  const jumps: MapView[] = [];
  const map: PlayerMap = {
    jumpTo: (o) => { jumps.push(o); view.lng = o.center[0]; view.lat = o.center[1]; view.zoom = o.zoom; view.pitch = o.pitch; view.bearing = o.bearing; },
    getCenter: () => ({ lng: view.lng, lat: view.lat }), getZoom: () => view.zoom, getPitch: () => view.pitch, getBearing: () => view.bearing,
    getMaxPitch: () => 85, getCanvas: () => ({ clientHeight: H }),
    getContainer: () => ({ addEventListener: (type, l) => { listeners.set(type, l); }, removeEventListener: (type) => { listeners.delete(type); } }),
  };
  let pending: ((now: number) => void) | undefined;
  const frames = { request: (cb: (now: number) => void) => { pending = cb; return 1; }, cancel: () => { pending = undefined; } };
  const step = (now: number): void => { const cb = pending; pending = undefined; cb?.(now); };
  return { map, jumps, listeners, frames, step, hasFrame: () => pending !== undefined };
}

test("playShots: one jumpTo per frame to the end, then done; the listeners are removed", () => {
  const f = fakeMap();
  const ends: string[] = [];
  const started: number[] = [];
  playShots(f.map, parseShotScript({ shots: [
    { type: "hold", duration_s: 1, look_at: { lng: 129.72, lat: 33.18 }, camera: { zoom: 16, pitch: 50, bearing: 0 } },
    { type: "dolly", duration_s: 1, look_at: { lng: 129.72, lat: 33.18 }, to: { range_m: 200 } },
  ] }), { frames: f.frames, onEnd: (r) => ends.push(r), onShot: (i) => started.push(i) });
  assert.equal(f.listeners.size, 4);
  for (const now of [1000, 1500, 2100, 2600, 3000]) f.step(now);
  assert.deepEqual(ends, ["done"]);
  assert.deepEqual(started, [0, 1]);
  assert.equal(f.jumps.length, 5);
  assert.ok(near(distanceForZoom(f.jumps[4]!.zoom, H, 33.18), 200));
  assert.equal(f.listeners.size, 0);
  assert.ok(!f.hasFrame());
});

test("playShots: manual input stops at once and leaves the camera where it is", () => {
  const f = fakeMap();
  const ends: string[] = [];
  playShots(f.map, parseShotScript({ shots: [{ type: "orbit", duration_s: 10, look_at: { lng: 129.72, lat: 33.18 }, camera: { alt_m: 400, radius_m: 800 } }] }), { frames: f.frames, onEnd: (r) => ends.push(r) });
  f.step(0);
  f.step(2000);
  const before = f.jumps.length;
  f.listeners.get("pointerdown")!({ target: "map" });
  f.step(2100);
  assert.deepEqual(ends, ["user"]);
  assert.equal(f.jumps.length, before, "no frame after the input");
  assert.ok(!f.hasFrame());
});

test("playShots: the returned function stops it", () => {
  const f = fakeMap();
  const ends: string[] = [];
  const stop = playShots(f.map, parseShotScript({ shots: [{ type: "hold", duration_s: 5, look_at: { lng: 129.72, lat: 33.18 }, camera: {} }] }), { frames: f.frames, onEnd: (r) => ends.push(r) });
  f.step(0);
  stop();
  stop();
  assert.deepEqual(ends, ["stopped"]);
});

test("look-at height: with the ground known, it runs smoothly from the ground at A to the ground at B, not over the bumps between", () => {
  const A = { lng: 129.705, lat: 33.17 }, B = { lng: 129.7198, lat: 33.179 };
  // Bumpy ground: 0 at A, 40 m at B, a 200 m hill half way.
  const groundAt = (lng: number): number => (lng <= A.lng + 1e-9 ? 0 : lng >= B.lng - 1e-9 ? 40 : 200);
  const tl = buildTimeline(shots([
    { type: "hold", duration_s: 2, look_at: A, camera: { range_m: 800 } },
    { type: "traverse", duration_s: 10, easing: "linear", to_look_at: B, camera: { range_m: 800 } },
    { type: "orbit", duration_s: 4, look_at: B, camera: { alt_m: 300, radius_m: 500 } },
  ]), { ...start, elevation: 0 }, H, groundAt);
  assert.equal(sampleTimeline(tl, 1).camera.elevation, 0);
  assert.ok(near(sampleTimeline(tl, 7).camera.elevation!, 20), "half way: half the difference, not the hill");
  assert.ok(near(sampleTimeline(tl, 12).camera.elevation!, 40));
  assert.ok(near(sampleTimeline(tl, 14).camera.elevation!, 40), "the orbit keeps B's height");
  assert.equal(mapViewOf(sampleTimeline(tl, 7).camera, H).elevation, sampleTimeline(tl, 7).camera.elevation);
  // Without groundAt there is no elevation, and the map keeps its own.
  assert.equal(buildTimeline(shots([{ type: "hold", duration_s: 1, look_at: A, camera: {} }]), start, H).end.elevation, undefined);
});

test("look-at height: an unknown ground carries the height over; a cut takes the ground at the new look-at point", () => {
  const tl = buildTimeline(shots([
    { type: "hold", duration_s: 1, look_at: { lng: 1, lat: 2 }, camera: {} },
    { type: "crane", duration_s: 1, look_at: { lng: 3, lat: 4 }, from: { alt_m: 60 }, to: { alt_m: 900 } },
  ]), { ...start, elevation: 12 }, H, (lng) => (lng === 3 ? 7 : null));
  assert.equal(sampleTimeline(tl, 0.5).camera.elevation, 12);
  assert.equal(sampleTimeline(tl, 1.5).camera.elevation, 7);
});

test("playShots with terrain: the map's clamping is switched off while playing, restored at the end, and jumpTo gets the elevation", () => {
  const f = fakeMap();
  let clamped = true;
  const map = { ...f.map, getTerrain: () => ({}), getCenterElevation: () => 5, queryTerrainElevation: () => 30, getCenterClampedToGround: () => clamped, setCenterClampedToGround: (v: boolean) => { clamped = v; } };
  const ends: string[] = [];
  playShots(map, parseShotScript({ shots: [{ type: "dolly", duration_s: 1, look_at: { lng: 129.72, lat: 33.18 }, to: { range_m: 300 } }] }), { frames: f.frames, onEnd: (r) => ends.push(r) });
  assert.equal(clamped, false);
  f.step(0);
  assert.equal(f.jumps[0]!.elevation, 30);
  f.step(1500);
  assert.deepEqual(ends, ["done"]);
  assert.equal(clamped, true);
});

test("playShots: onFrame reports the time played; input the control ignores does not stop it", () => {
  const f = fakeMap();
  const ends: string[] = [];
  const frames: Array<[number, number]> = [];
  playShots(f.map, parseShotScript({ shots: [{ type: "hold", duration_s: 2, look_at: { lng: 129.72, lat: 33.18 }, camera: {} }] }), {
    frames: f.frames, onEnd: (r) => ends.push(r), onFrame: (t, d) => frames.push([t, d]), ignoreInput: (e) => e.target === "control",
  });
  f.step(0);
  f.listeners.get("pointerdown")!({ target: "control" });
  f.step(1000);
  assert.deepEqual(ends, []);
  f.step(2500);
  assert.deepEqual(frames, [[0, 2], [1, 2], [2, 2]]);
  assert.deepEqual(ends, ["done"]);
});

test("describePlayback: the status line, the button and the progress for each state", () => {
  const playing = describePlayback({ kind: "playing", index: 1, count: 5, type: "crane", time: 12.7, duration: 38 });
  assert.equal(playing.text, "▶ Playing 2/5 · crane · 12 / 38 s");
  assert.equal(playing.button, "Stop");
  assert.ok(near(playing.progress, 12.7 / 38));
  assert.deepEqual(describePlayback({ kind: "done", duration: 38 }), { text: "■ Finished (38 s)", button: "Replay", progress: 1 });
  assert.equal(describePlayback({ kind: "user", time: 20, duration: 38 }).text, "⏸ Stopped by your input at 20 / 38 s");
  assert.equal(describePlayback({ kind: "stopped", time: 5, duration: 38 }).button, "Replay");
  assert.equal(describePlayback({ kind: "loading" }).button, undefined);
  assert.deepEqual(describePlayback({ kind: "ready", count: 5, duration: 38 }), { text: "Camera tour: 5 shots, 38 s", button: "Play tour", progress: 0 });
  assert.equal(describePlayback({ kind: "error", message: "x" }).button, undefined);
});
