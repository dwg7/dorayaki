import assert from "node:assert/strict";
import { test } from "node:test";

import { cameraOfMapView, parseShotScript } from "../demo/src/shot-player.js";
import { nextRequests, planTour, waitBeforePlaying, type TourNeed } from "../demo/src/tour-plan.js";
import type { TileAddress } from "../src/tile-geometry.js";

const need = (key: string, t: number, bytes: number): TourNeed => {
  const [z, x, y] = key.split("/").map(Number) as [number, number, number];
  return { tile: { z, x, y }, key, t, bytes };
};

test("E029 waitBeforePlaying: zero when the rate delivers every missing tile by its deadline, else the shortfall in seconds", () => {
  const needs = [need("17/0/0", 0, 2e6), need("17/1/0", 1, 2e6), need("17/2/0", 10, 2e6)];
  // 1 MB/s: the first 2 MB need 2 s by t = 0, then 4 MB by t = 1 (3 s short), 6 MB by t = 10 (fine).
  assert.equal(waitBeforePlaying(needs, () => false, 1e6), 3);
  assert.equal(waitBeforePlaying(needs, (k) => k !== "17/2/0", 1e6), 0, "only the late tile is missing, and it has 10 s");
  assert.equal(waitBeforePlaying(needs, () => false, 0), Infinity);
});

test("E029 nextRequests: deadline order, skipping held and in-flight tiles, at most `slots`, stopping at the bytes allowed ahead", () => {
  const needs = [need("17/0/0", 0, 1e6), need("17/1/0", 2, 1e6), need("17/2/0", 4, 1e6), need("17/3/0", 6, 1e6), need("17/4/0", 8, 1e6)];
  const state = (k: string): "have" | "inflight" | "none" => (k === "17/0/0" ? "have" : k === "17/1/0" ? "inflight" : "none");
  assert.deepEqual(nextRequests(needs, 0, state, 2, 1e9).map((n) => n.key), ["17/2/0", "17/3/0"]);
  // Ahead of time 1: 17/1/0 (in flight) and 17/2/0 make 2 MB; with 2 MB allowed ahead nothing more is requested.
  assert.deepEqual(nextRequests(needs, 1, state, 6, 2e6).map((n) => n.key), ["17/2/0"]);
  assert.deepEqual(nextRequests(needs, 0, state, 0, 1e9), []);
});

test("E029 planTour: every tile a held view wants, once, at the first time it is wanted, in deadline order", () => {
  // A 4 x 4 block of z17 tiles and their z16 and z15 parents around Sasebo.
  const candidates: TileAddress[] = [];
  const x0 = 112760, y0 = 52720;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) candidates.push({ z: 17, x: x0 + i, y: y0 + j });
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) candidates.push({ z: 16, x: (x0 >> 1) + i, y: (y0 >> 1) + j });
  candidates.push({ z: 15, x: x0 >> 2, y: y0 >> 2 });
  const lng = ((x0 + 2) / 2 ** 17) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y0 + 2)) / 2 ** 17))) * 180) / Math.PI;
  const script = parseShotScript({ shots: [{ type: "hold", duration_s: 2, look_at: { lng, lat }, camera: { zoom: 17.5, pitch: 0, bearing: 0 } }] });
  const start = cameraOfMapView({ lng, lat, zoom: 17.5, pitch: 0, bearing: 0 }, 600);
  const needs = planTour(script.shots, start, { candidates, width: 800, height: 600, maxBytes: 40e6, maxSplats: 4e6, knownBytes: () => 1e6, priorBytes: () => 1e6 });
  assert.ok(needs.length > 0);
  assert.equal(new Set(needs.map((n) => n.key)).size, needs.length, "each tile once");
  assert.ok(needs.every((n) => n.t === 0), "a still camera wants everything at the start");
  assert.ok(needs.every((n, i) => i === 0 || needs[i - 1]!.t <= n.t));
});
