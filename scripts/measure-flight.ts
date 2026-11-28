/**
 * E031: the flight log of a tour before it plays (demo/src/flight-log.ts): per shot, the camera's top and mean speed, top acceleration
 * and jerk, top bearing and pitch rates, top look-at speed and lowest height above sea level (above the look-at point's height, 0 without
 * terrain), and the cuts. No browser.
 *
 *   npm run measure:flight -- <shots.json> [--height 817] [--dt 0.1] [--start lng,lat,zoom,bearing,pitch]
 */
import { readFileSync } from "node:fs";

import { flightStats, sampleFlight } from "../demo/src/flight-log.js";
import { buildTimeline, cameraOfMapView, parseShotScript } from "../demo/src/shot-player.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [, v] = args.splice(i, 2);
  return v!;
};
const height = Number(opt("--height", "817"));
const dt = Number(opt("--dt", "0.1"));
const [lng, lat, zoom, bearing, pitch] = opt("--start", "129.7215,33.1768,16.4,-30,62").split(",").map(Number) as [number, number, number, number, number];
const [shotsPath] = args;
if (!shotsPath) { console.error("usage: measure-flight <shots.json> [--height px] [--dt s] [--start lng,lat,zoom,bearing,pitch]"); process.exit(1); }

const script = parseShotScript(JSON.parse(readFileSync(shotsPath, "utf8")));
const timeline = buildTimeline(script.shots, cameraOfMapView({ lng, lat, zoom, bearing, pitch }, height), height);
const stats = flightStats(sampleFlight(timeline, dt));
const f = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d) : "-");
console.log(`${shotsPath}: ${script.shots.length} shots, ${timeline.duration} s, sampled every ${dt} s (canvas ${height} px tall)`);
console.log("shot      type      speed max/mean m/s  accel max m/s2  jerk max m/s3  bearing max deg/s  pitch max deg/s  look-at max m/s  lowest m");
for (const r of stats.shots) {
  const type = r.shot < 0 ? "(tour)" : script.shots[r.shot]!.type;
  console.log(`${String(r.shot < 0 ? "all" : r.shot + 1).padEnd(9)} ${type.padEnd(9)} ${(f(r.maxSpeed) + " / " + f(r.meanSpeed)).padStart(18)} ${f(r.maxAccel).padStart(15)} ${f(r.maxJerk, 0).padStart(14)} ${f(r.maxBearingRate).padStart(18)} ${f(r.maxPitchRate).padStart(16)} ${f(r.maxLookSpeed).padStart(16)} ${f(r.minHeight, 0).padStart(9)}`);
}
console.log(`cuts: ${stats.cuts.length ? stats.cuts.map((c) => `${c.t} s (${c.jump} m)`).join(", ") : "none"}`);
