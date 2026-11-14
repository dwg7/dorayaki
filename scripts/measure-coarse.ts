/**
 * E003 (EXPERIMENTS.md): coarser Gaussians, and what anisotropy buys.
 *
 * For voxel sizes of about one CSS pixel at z21, z20, z19 and z18 (tile
 * width / 512 at the data's latitude), fit one Gaussian per voxel (mean,
 * covariance) on VIRTUAL SHIZUOKA MMS mesh 08NE2701, and measure how well
 * each representation covers the voxel's own source points:
 *
 * - disc (current record): a circle of radius 2·sqrt(s_a·s_b) in the plane
 *   of the two longer axes;
 * - ellipse (3DGS-style splat): the in-plane 2σ ellipse (u/s_a)² + (w/s_b)²
 *   <= 4. It has exactly the same area as the disc (4π·s_a·s_b), so any
 *   difference in coverage comes from shape (anisotropy) alone.
 * Both use the same thickness test, |distance along the normal| <= 2 s_min.
 *
 * Fidelity = RMS distance of source points from their Gaussian's plane
 * (along its shortest axis), the geometric error a flat splat makes.
 * Coverage = share of source points inside their own voxel's shape. That
 * ignores neighbours, so both figures are lower bounds; the comparison
 * between the two is what matters. Byte estimates: 32 B (current v3
 * record), 12 B (a compact disc: quantized position, octahedral normal,
 * log radius, RGBA8) and 16 B (a compact ellipsoid: quantized position,
 * 3 log scales, a quantized rotation, RGBA8). The compact sizes are
 * estimates for proposed records, not implemented formats.
 */
import { readFileSync } from "node:fs";

import { EARTH_CIRCUMFERENCE_METRES } from "../src/tile-geometry.js";
import { readLas } from "../src/pointcloud/las.js";
import { symmetricEigen3 } from "../src/pointcloud/voxel-gaussians.js";

const LAS_PATH = "data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.las";
const COPC_XYZRGB = 5_183_226;
/** Voxels with fewer than 3 points have no defined shape: they get scales of voxel / 4. */
const DEGENERATE_SCALE_FRACTION = 0.25;
/** Otherwise scales are floored at 1 mm only, so flat voxels stay flat. */
const MIN_SCALE_METRES = 0.001;

const las = readLas(new Uint8Array(readFileSync(LAS_PATH)));
const lat = (35.13419 * Math.PI) / 180;
const tileWidth = (z: number) => (EARTH_CIRCUMFERENCE_METRES * Math.cos(lat)) / 2 ** z;

const rows: Array<Record<string, number>> = [];
for (const z of [21, 20, 19, 18]) {
  const v = tileWidth(z) / 512;
  // Group point indices by voxel.
  const voxels = new Map<string, number[]>();
  for (let i = 0; i < las.count; i++) {
    const key = `${Math.floor(las.x[i]! / v)},${Math.floor(las.y[i]! / v)},${Math.floor(las.z[i]! / v)}`;
    let list = voxels.get(key);
    if (!list) voxels.set(key, (list = []));
    list.push(i);
  }
  let discCovered = 0, ellipsoidCovered = 0, flat = 0, anisoSum = 0, residualSq = 0;
  for (const idx of voxels.values()) {
    const n = idx.length;
    let mx = 0, my = 0, mz = 0;
    for (const i of idx) { mx += las.x[i]!; my += las.y[i]!; mz += las.z[i]!; }
    mx /= n; my /= n; mz /= n;
    let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
    for (const i of idx) {
      const dx = las.x[i]! - mx, dy = las.y[i]! - my, dz = las.z[i]! - mz;
      cxx += dx * dx; cxy += dx * dy; cxz += dx * dz; cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
    }
    const { values, vectors } = symmetricEigen3([cxx / n, cxy / n, cxz / n, cxy / n, cyy / n, cyz / n, cxz / n, cyz / n, czz / n]);
    const floor = n < 3 ? v * DEGENERATE_SCALE_FRACTION : MIN_SCALE_METRES;
    const scales = values.map((ev) => Math.max(floor, Math.sqrt(Math.max(0, ev))));
    const order = [0, 1, 2].sort((a, b) => scales[a]! - scales[b]!);
    const [kn, ka, kb] = order as [number, number, number];
    const axis = (k: number) => [vectors[0]![k]!, vectors[1]![k]!, vectors[2]![k]!];
    const [an, aa, ab] = [axis(kn), axis(ka), axis(kb)];
    const [sn, sa, sb] = [scales[kn]!, scales[ka]!, scales[kb]!];
    const discR = 2 * Math.sqrt(sa * sb);
    if (sn / Math.sqrt(sa * sb) < 0.3) flat++;
    anisoSum += sb / sa;
    for (const i of idx) {
      const d = [las.x[i]! - mx, las.y[i]! - my, las.z[i]! - mz];
      const dot = (u: number[]) => d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!;
      const pn = dot(an), pa = dot(aa), pb = dot(ab);
      residualSq += pn * pn;
      if (Math.abs(pn) <= 2 * sn && Math.hypot(pa, pb) <= discR) discCovered++;
      if (Math.abs(pn) <= 2 * sn && (pa / sa) ** 2 + (pb / sb) ** 2 <= 4) ellipsoidCovered++;
    }
  }
  const N = voxels.size;
  rows.push({
    zoomDetail: z,
    voxelCm: +(v * 100).toFixed(1),
    gaussians: N,
    pointsPerGaussian: +(las.count / N).toFixed(1),
    flatShare: +(flat / N).toFixed(2),
    meanAnisotropy: +(anisoSum / N).toFixed(2),
    rmsResidualCm: +(Math.sqrt(residualSq / las.count) * 100).toFixed(2),
    discCoverage: +(discCovered / las.count).toFixed(3),
    ellipseCoverage: +(ellipsoidCovered / las.count).toFixed(3),
    xCopcAt32B: +((N * 32) / COPC_XYZRGB).toFixed(3),
    xCopcDisc12B: +((N * 12) / COPC_XYZRGB).toFixed(3),
    xCopcEllipsoid16B: +((N * 16) / COPC_XYZRGB).toFixed(3),
  });
}
console.table(rows);
