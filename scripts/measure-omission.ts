/**
 * Measure omission of weakly supported surfels in maxzoom tiles (E002 in
 * EXPERIMENTS.md), on VIRTUAL SHIZUOKA MMS mesh 08NE2701.
 *
 * Finest Gaussians: one per 1.53 cm voxel (z20 tile width / 2048), the
 * same as `npm run demo:numazu`. A Gaussian's support is the number of
 * source points in its voxel. Two strategies, for thresholds s:
 * (a) global: drop Gaussians with support < s, then order into levels;
 * (b) last level only: order all Gaussians, then drop support < s only
 *     from the last level, so levels 0..L-2 keep full coverage;
 * (c) refinement levels: order all Gaussians, keep level 0 whole, drop
 *     support < s from every later level.
 * Reported per strategy and threshold: kept Gaussians, z20 bytes (all
 * levels, 32-byte records), ratio to COPC (xyz+rgb, 5,183,226 B), and the
 * share of level-0 cells (6.1 cm) still covered.
 */
import { readFileSync } from "node:fs";

import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { gaussianToDisc, placeDiscs } from "../src/gaussian/to-surfels.js";
import { readLas } from "../src/pointcloud/las.js";
import { fitVoxelGaussians } from "../src/pointcloud/voxel-gaussians.js";
import { BASE_CELLS, orderByRefinement } from "../src/progressive.js";
import type { Surfel } from "../src/surfel-block.js";
import { tileWidthMetres } from "../src/tile-geometry.js";
import { splitByTile } from "../src/tiling.js";

const LAS_PATH = "data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.las";
const COPC_XYZRGB = 5_183_226;
const MAXZOOM = 20;
const LEVELS = 3;

const las = readLas(new Uint8Array(readFileSync(LAS_PATH)));
const e0 = (las.min[0] + las.max[0]) / 2;
const n0 = (las.min[1] + las.max[1]) / 2;
const origin = jprcsToLatLng(8, n0, e0);
const xyz = new Float64Array(las.count * 3);
const rgb = new Float32Array(las.count * 3);
for (let i = 0; i < las.count; i++) {
  xyz[i * 3] = las.x[i]! - e0;
  xyz[i * 3 + 1] = las.y[i]! - n0;
  xyz[i * 3 + 2] = las.z[i]!;
  for (let k = 0; k < 3; k++) rgb[i * 3 + k] = (las.rgb![i * 3 + k]! >> 8) / 255;
}
const n = 2 ** MAXZOOM;
const yRow = Math.floor(((1 - Math.asinh(Math.tan((origin.lat * Math.PI) / 180)) / Math.PI) / 2) * n);
const w20 = tileWidthMetres({ z: MAXZOOM, x: 0, y: yRow });
const voxel = w20 / (BASE_CELLS * 2 ** (LEVELS - 1));
const finest = fitVoxelGaussians({ count: las.count, xyz, rgb }, { voxelSize: voxel, minPoints: 1, minScale: 0.001, degenerateScale: voxel / 4 });
const discs = finest.map(gaussianToDisc);
const supports = discs.map((d) => d.support ?? 0);

// Support histogram.
const hist: Record<string, number> = {};
for (const s of supports) { const k = s >= 8 ? "8+" : String(s); hist[k] = (hist[k] ?? 0) + 1; }
console.log(JSON.stringify({ voxelMetres: voxel, finestGaussians: discs.length, supportHistogram: hist }));

/** Surfels of all z20 tiles with their supports, tile by tile. */
const { block, surfels } = placeDiscs(discs, origin, MAXZOOM);
surfels.forEach((s, i) => ((s as Surfel & { support: number }).support = supports[i]!));
const tiles = splitByTile(surfels, block).filter((t) => t.surfels.length > 0);
const support = (s: Surfel) => (s as Surfel & { support: number }).support;

function level0Cells(list: readonly Surfel[], w: number): Set<string> {
  const size = w / BASE_CELLS;
  return new Set(list.map((s) => `${Math.floor(s.x * BASE_CELLS)},${Math.floor(s.y * BASE_CELLS)},${Math.floor(s.z / size)}`));
}

const rows: Array<Record<string, number | string>> = [];
const baseCells = tiles.reduce((acc, t) => acc + level0Cells(t.surfels, tileWidthMetres(t.tile)).size, 0);
for (const strategy of ["global", "last-level", "refinement-levels"] as const) {
  for (const threshold of [1, 2, 3, 4, 6, 8]) {
    let kept = 0, bytes = 0, covered = 0;
    const levelTotals = new Array(LEVELS).fill(0);
    for (const t of tiles) {
      const w = tileWidthMetres(t.tile);
      let ordered;
      if (strategy === "global") {
        ordered = orderByRefinement(t.surfels.filter((s) => support(s) >= threshold), w, LEVELS);
      } else if (strategy === "refinement-levels") {
        const full = orderByRefinement(t.surfels, w, LEVELS);
        const out: Surfel[] = [];
        const levels: number[] = [];
        let at = 0;
        full.levels.forEach((c, k) => {
          const run = full.surfels.slice(at, at + c);
          at += c;
          const keep = k === 0 ? run : run.filter((s) => support(s) >= threshold);
          for (const s of keep) out.push(s); // no spread: large arrays overflow the stack
          levels.push(keep.length);
        });
        ordered = { surfels: out, levels };
      } else {
        const full = orderByRefinement(t.surfels, w, LEVELS);
        const headCount = full.levels.slice(0, -1).reduce((a, b) => a + b, 0);
        const tail = full.surfels.slice(headCount).filter((s) => support(s) >= threshold);
        ordered = { surfels: [...full.surfels.slice(0, headCount), ...tail], levels: [...full.levels.slice(0, -1), tail.length] };
      }
      kept += ordered.surfels.length;
      bytes += 16 + 4 * LEVELS + 32 * ordered.surfels.length;
      ordered.levels.forEach((c, k) => (levelTotals[k] += c));
      covered += level0Cells(ordered.surfels.slice(0, ordered.levels[0]), w).size;
    }
    rows.push({
      strategy, minSupport: threshold, kept, keptShare: +(kept / discs.length).toFixed(3),
      levels: levelTotals.join("/"), z20Bytes: bytes, xCopc: +(bytes / COPC_XYZRGB).toFixed(2),
      level0Coverage: +(covered / baseCells).toFixed(3),
    });
  }
}
console.table(rows);
