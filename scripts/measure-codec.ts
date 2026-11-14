/**
 * Codec timing outside the browser (EXPERIMENTS.md E001/E002): encode and
 * decode time of Surfel Blocks, median of repeated runs, in Node.
 *
 * - bridge: the demo fixture on the Sapporo demo tile (one tile);
 * - numazu: every tile in demo/tiles/numazu/ if `npm run demo:numazu` has
 *   built them (decode of the MLT tile files as served).
 *
 * Browser-side numbers (fetch, decode, GPU upload, frame time) come from
 * the demo itself: `dorayaki.report()` and `await dorayaki.measureFrames()`
 * in the page's console.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";

import { decodeSurfelTileWithLevels } from "../demo/src/decode-tile.js";
import { demoTileSplats } from "../demo/src/demo-tile.js";
import { decodeSurfelBlock, encodeSurfelBlock } from "../src/surfel-block.js";

const RUNS = 50;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
function time(fn: () => unknown): number {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) fn(); // warm-up
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return +median(samples).toFixed(3);
}

const rows: Array<Record<string, number | string>> = [];
const [bridge] = demoTileSplats("bridge");
const bridgeBytes = encodeSurfelBlock(bridge!.surfels);
rows.push({
  case: "bridge (1 tile)", surfels: bridge!.surfels.length, blockBytes: bridgeBytes.byteLength,
  encodeMs: time(() => encodeSurfelBlock(bridge!.surfels)), decodeMs: time(() => decodeSurfelBlock(bridgeBytes)),
});

const dir = "demo/tiles/numazu";
if (existsSync(dir)) {
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith(".mlt") && files.push(join(d, f))));
  walk(dir);
  for (const f of files.sort()) {
    const tile = new Uint8Array(readFileSync(f));
    const decoded = decodeSurfelTileWithLevels(tile);
    rows.push({
      case: `numazu ${f.slice(dir.length + 1)}`, surfels: decoded.splats.length, blockBytes: tile.byteLength,
      encodeMs: time(() => encodeSurfelBlock(decoded.splats, decoded.levels)), decodeMs: time(() => decodeSurfelTileWithLevels(tile)),
    });
  }
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, cores: cpus().length, runs: RUNS }));
console.table(rows);
