/**
 * E028: the tiles a tour needs, when, and whether a network could deliver them in time, before anything is played (the "tour linter" v0
 * of documents/director.md). The shots are sampled every `--dt` seconds with the player's own timeline; at each sample the view chooses
 * its tiles with the demo's own budgeted selection (`?mixed=1`); a tile's deadline is the first time it is wanted. Then three fetch
 * policies are simulated on one link of `--mbps` megabytes per second with `--latency` seconds per request and `--parallel` requests at once:
 *
 *   on-demand   a tile is requested at its deadline (no look-ahead);
 *   ahead-3s    requested 3 s before its deadline (about the demo's 1.5 and 3 s prefetch, without its cap of 6 tiles per view);
 *   full-EDF    every tile requested at the start, earliest deadline first (the whole route is known).
 *
 * A tile that arrives after its deadline is late; the report gives, per shot, the bytes newly wanted and, per policy, how many tiles and
 * bytes were late and the worst lateness. Tile sizes are the files' sizes. No terrain in Node: the look-at point is at height 0 (the demo
 * uses the terrain's), which moves the far edge of a pitched view a little.
 *
 *   npm run measure:tour-demand -- <tileset dir> <shots.json> [--size 1280x800] [--dt 0.25] [--mbps 2,8] [--latency 0.15] [--parallel 6]
 *     [--start lng,lat,zoom,bearing,pitch] [--budget 40] [--splats 4000000]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { visibleBounds, type View } from "../demo/src/camera.js";
import { selectBudgetedTiles } from "../demo/src/mixed-selection.js";
import { buildTimeline, cameraOfMapView, mapViewOf, parseShotScript, sampleTimeline } from "../demo/src/shot-player.js";
import type { TileAddress } from "../src/tile-geometry.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [, v] = args.splice(i, 2);
  return v!;
};
const [W, H] = opt("--size", "1280x800").split("x").map(Number) as [number, number];
const dt = Number(opt("--dt", "0.25"));
const speeds = opt("--mbps", "2,8").split(",").map(Number);
const latency = Number(opt("--latency", "0.15"));
const parallel = Number(opt("--parallel", "6"));
const [sLng, sLat, sZoom, sBearing, sPitch] = opt("--start", "129.7215,33.1768,16.4,-30,62").split(",").map(Number) as [number, number, number, number, number];
const budgetMB = Number(opt("--budget", "40"));
const budgetSplats = Number(opt("--splats", "4000000"));
const [dir, shotsPath] = args;
if (!dir || !shotsPath) {
  console.error("usage: measure-tour-demand <tileset dir> <shots.json> [--size WxH] [--dt s] [--mbps a,b] [--latency s] [--parallel n] [--start lng,lat,zoom,bearing,pitch]");
  process.exit(1);
}

// Every tile of the tileset with its size.
const sizes = new Map<string, number>();
const tiles: TileAddress[] = [];
for (const z of readdirSync(dir).filter((d) => /^\d+$/.test(d))) {
  for (const x of readdirSync(join(dir, z))) {
    for (const f of readdirSync(join(dir, z, x))) {
      if (!f.endsWith(".mlt")) continue;
      const t = { z: Number(z), x: Number(x), y: Number(f.slice(0, -4)) };
      tiles.push(t);
      sizes.set(`${t.z}/${t.x}/${t.y}`, statSync(join(dir, z, x, f)).size);
    }
  }
}
const key = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;
const meanByZoom = new Map<number, number>();
for (const z of new Set(tiles.map((t) => t.z))) {
  const s = tiles.filter((t) => t.z === z).map((t) => sizes.get(key(t))!);
  meanByZoom.set(z, s.reduce((a, b) => a + b, 0) / s.length);
}

const script = parseShotScript(JSON.parse(readFileSync(shotsPath, "utf8")));
const start = cameraOfMapView({ lng: sLng, lat: sLat, zoom: sZoom, bearing: sBearing, pitch: sPitch }, H);
const timeline = buildTimeline(script.shots, start, H);

// Deadlines: the first time each tile is wanted.
const deadline = new Map<string, { t: number; shot: number }>();
const wantedPerSample: number[] = [];
for (let t = 0; t <= timeline.duration + 1e-9; t += dt) {
  const { camera, index } = sampleTimeline(timeline, t);
  const v = mapViewOf(camera, H);
  const view: View = { lng: v.center[0], lat: v.center[1], zoom: v.zoom, bearing: v.bearing, pitch: v.pitch, width: W, height: H, centreZ: 0 };
  const want = selectBudgetedTiles(tiles, visibleBounds(view), view, {
    maxBytes: budgetMB * 1e6, maxSplats: budgetSplats, knownBytes: (x) => sizes.get(key(x)), priorBytes: (z) => meanByZoom.get(z) ?? 1e6,
  });
  wantedPerSample.push(want.length);
  for (const w of want) if (!deadline.has(key(w))) deadline.set(key(w), { t, shot: index });
}
const needs = [...deadline.entries()].map(([k, d]) => ({ key: k, t: d.t, shot: d.shot, bytes: sizes.get(k)! })).sort((a, b) => a.t - b.t);

console.log(`${shotsPath}: ${script.shots.length} shots, ${timeline.duration} s; ${tiles.length} tiles in ${dir}; view ${W}x${H}, every ${dt} s`);
console.log(`unique tiles wanted: ${needs.length}, ${(needs.reduce((n, x) => n + x.bytes, 0) / 1e6).toFixed(1)} MB; wanted per view: median ${[...wantedPerSample].sort((a, b) => a - b)[wantedPerSample.length >> 1]}, max ${Math.max(...wantedPerSample)}`);

// Newly wanted bytes per shot, and the heaviest second.
let tAcc = 0;
script.shots.forEach((s, i) => {
  const mine = needs.filter((n) => n.shot === i);
  const bytes = mine.reduce((n, x) => n + x.bytes, 0);
  const first = mine.filter((n) => n.t < tAcc + 1).reduce((n, x) => n + x.bytes, 0);
  console.log(`  shot ${i + 1} ${s.type.padEnd(8)} ${String(s.duration_s).padStart(3)} s: ${String(mine.length).padStart(4)} new tiles, ${(bytes / 1e6).toFixed(1).padStart(6)} MB (${(bytes / 1e6 / s.duration_s).toFixed(2)} MB/s mean; ${(first / 1e6).toFixed(1)} MB wanted in its first second)`);
  tAcc += s.duration_s;
});

/** One link, `parallel` requests at once sharing `mbps`, each paying `latency`; requests start no earlier than their release time, in the given order. */
function simulate(order: Array<{ t: number; bytes: number; release: number }>, mbps: number): { late: number; lateBytes: number; worst: number } {
  const lanes = new Array<number>(parallel).fill(0); // when each lane is free
  const perLane = (mbps * 1e6) / parallel;
  let late = 0, lateBytes = 0, worst = 0;
  for (const n of order) {
    let li = 0;
    for (let i = 1; i < parallel; i++) if (lanes[i]! < lanes[li]!) li = i;
    const begin = Math.max(lanes[li]!, n.release);
    const end = begin + latency + n.bytes / perLane;
    lanes[li] = end;
    if (end > n.t + 1e-9) { late++; lateBytes += n.bytes; worst = Math.max(worst, end - n.t); }
  }
  return { late, lateBytes, worst };
}
for (const mbps of speeds) {
  const row = (name: string, release: (t: number) => number): string => {
    const r = simulate(needs.map((n) => ({ t: n.t, bytes: n.bytes, release: release(n.t) })), mbps);
    return `${name} ${r.late} late (${(r.lateBytes / 1e6).toFixed(1)} MB), worst ${r.worst.toFixed(1)} s`;
  };
  // The shortest wait before playing (all deadlines later by `p`) that leaves no tile late, for the look-ahead policies.
  const preroll = (ahead: number): string => {
    const lateWith = (p: number): number => simulate(needs.map((n) => ({ t: n.t + p, bytes: n.bytes, release: ahead === Infinity ? 0 : Math.max(0, n.t + p - ahead) })), mbps).late;
    if (lateWith(600) > 0) return "> 600 s";
    let lo = 0, hi = 600;
    while (hi - lo > 0.1) { const mid = (lo + hi) / 2; if (lateWith(mid) > 0) lo = mid; else hi = mid; }
    return `${hi.toFixed(1)} s`;
  };
  console.log(`${mbps} MB/s, ${latency} s latency, ${parallel} parallel: ${row("on-demand", (t) => t)}; ${row("ahead-3s", (t) => Math.max(0, t - 3))}; ${row("full-EDF", () => 0)}`);
  console.log(`  wait before playing for no late tile: ahead-3s ${preroll(3)}, full-EDF ${preroll(Infinity)}`);
}
