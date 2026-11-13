/**
 * Measurements for the maxzoom / progressive-ordering design
 * (documents/progressive-maxzoom.md), on the VIRTUAL SHIZUOKA MMS mesh 08NE2701.
 *
 * For each zoom z = 18..23 it takes the voxel size v_z = tile width / 512
 * (about one CSS pixel at that zoom, for 512 px tiles) and reports:
 * - aggregated Gaussians: occupied voxels at v_z (one Gaussian each);
 * - nested refinement: Gaussians added when going from v_{z-1} to v_z
 *   (occupied fine voxels minus occupied coarse voxels), i.e. the size of
 *   level z in a subsampling hierarchy whose union is the finest level;
 * - bytes at the current 32-byte record.
 *
 * It also prints the source density, so that the per-tile figures can be
 * scaled to other areas. COPC baselines are measured separately with PDAL
 * (see NOTES.md); pass their byte sizes as arguments to print ratios:
 *   npm run measure:numazu -- <copc_all_bytes> <copc_xyzrgb_bytes>
 */
import { readFileSync } from "node:fs";

import { EARTH_CIRCUMFERENCE_METRES } from "../src/tile-geometry.js";
import { readLas } from "../src/pointcloud/las.js";

const LAS_PATH = "data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.las";
const RECORD_BYTES = 32;

const las = readLas(new Uint8Array(readFileSync(LAS_PATH)));
const [copcAll, copcXyzRgb] = process.argv.slice(2).map(Number);

// Mercator tile width at the data's latitude (35.134° N).
const lat = (35.13419 * Math.PI) / 180;
const tileWidth = (z: number) => (EARTH_CIRCUMFERENCE_METRES * Math.cos(lat)) / 2 ** z;

function occupied(v: number): number {
  const set = new Set<string>();
  for (let i = 0; i < las.count; i++) {
    set.add(`${Math.floor(las.x[i]! / v)},${Math.floor(las.y[i]! / v)},${Math.floor(las.z[i]! / v)}`);
  }
  return set.size;
}

// 2D footprint actually covered by points, on a 0.25 m grid.
const cells = new Set<string>();
for (let i = 0; i < las.count; i++) cells.add(`${Math.floor(las.x[i]! / 0.25)},${Math.floor(las.y[i]! / 0.25)}`);
const footprint = cells.size * 0.0625;

console.log(JSON.stringify({
  points: las.count,
  bboxMetres: [las.max[0] - las.min[0], las.max[1] - las.min[1], las.max[2] - las.min[2]].map((v) => +v.toFixed(2)),
  footprintM2: +footprint.toFixed(1),
  pointsPerM2: Math.round(las.count / footprint),
}));

const rows: Array<Record<string, number>> = [];
let previous = 0;
for (let z = 17; z <= 23; z++) {
  const v = tileWidth(z) / 512;
  const n = occupied(v);
  if (z >= 18) {
    rows.push({
      zoom: z,
      tileWidthM: +tileWidth(z).toFixed(2),
      voxelM: +v.toFixed(4),
      gaussians: n,
      pointsPerGaussian: +(las.count / n).toFixed(1),
      addedAtThisLevel: n - previous,
      bytesAt32: n * RECORD_BYTES,
      bytesPerSourcePointAt32: +((n * RECORD_BYTES) / las.count).toFixed(2),
      ...(copcXyzRgb ? { ratioToCopcXyzRgbAt32: +((n * RECORD_BYTES) / copcXyzRgb).toFixed(3) } : {}),
    });
  }
  previous = n;
}
console.table(rows);
if (copcAll && copcXyzRgb) {
  console.log(JSON.stringify({
    copcAllBytes: copcAll,
    copcAllBytesPerPoint: +(copcAll / las.count).toFixed(2),
    copcXyzRgbBytes: copcXyzRgb,
    copcXyzRgbBytesPerPoint: +(copcXyzRgb / las.count).toFixed(2),
  }));
}
