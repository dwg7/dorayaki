import assert from "node:assert/strict";
import { test } from "node:test";

import { TOY_GS_PROPERTIES } from "../src/fixtures/toy-gaussians.js";
import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { readPly, writePlyFloat32 } from "../src/gaussian/ply.js";
import { gaussianToDisc, gaussiansFromPly, rotationAxes } from "../src/gaussian/to-surfels.js";
import { LasError, readLas, writeLas12Format3 } from "../src/pointcloud/las.js";
import { fitVoxelGaussians, gaussiansToPlyRows, quaternionFromAxes, symmetricEigen3 } from "../src/pointcloud/voxel-gaussians.js";

const close = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("JPRCS zone origin maps to its defining latitude and longitude", () => {
  const p = jprcsToLatLng(8, 0, 0);
  close(p.lat, 36, 1e-9);
  close(p.lng, 138.5, 1e-9);
  assert.throws(() => jprcsToLatLng(20, 0, 0), RangeError);
});

test("JPRCS inverse matches the GSI xy2bl service (zone VIII, 2026-11-12)", () => {
  // GSI surveycalc xy2bl, refFrame JGD2011, zone 8, X = -96006.9375, Y = 28793.027:
  // latitude 35.13419231, longitude 138.81595577 (printed to 8 decimals,
  // so allow 1e-8 degrees, about 1 mm).
  const p = jprcsToLatLng(8, -96006.9375, 28793.027);
  close(p.lat, 35.13419231, 1e-8);
  close(p.lng, 138.81595577, 1e-8);
});

test("LAS 1.2 format 3 round-trips scaled coordinates, class, and RGB", () => {
  const bytes = writeLas12Format3([
    { x: 28786.055, y: -96013.874, z: 7.526, cls: 2, rgb: [65280, 0, 256] },
    { x: 28799.999, y: -96000.001, z: 19.9, cls: 5, rgb: [1, 2, 3] },
  ]);
  const las = readLas(bytes);
  assert.equal(las.count, 2);
  assert.equal(las.pointFormat, 3);
  close(las.x[0]!, 28786.055, 1e-9);
  close(las.y[1]!, -96000.001, 1e-9);
  close(las.z[1]!, 19.9, 1e-9);
  assert.deepEqual([...las.classification], [2, 5]);
  assert.deepEqual([...(las.rgb ?? [])], [65280, 0, 256, 1, 2, 3]);
});

test("LAS reader rejects malformed input", () => {
  const ok = writeLas12Format3([{ x: 0, y: 0, z: 0, cls: 2, rgb: [0, 0, 0] }]);
  assert.throws(() => readLas(ok.subarray(0, 100)), LasError);
  assert.throws(() => readLas(ok.subarray(0, ok.byteLength - 1)), LasError);
  const bad = ok.slice();
  bad[0] = 0x58;
  assert.throws(() => readLas(bad), LasError);
  const laz = ok.slice();
  laz[104] = 0x83;
  assert.throws(() => readLas(laz), /LAZ/);
});

test("symmetric eigen-decomposition and quaternion reproduce the matrix axes", () => {
  const { values, vectors } = symmetricEigen3([4, 1, 0, 1, 3, 0, 0, 0, 1]);
  const sorted = [...values].sort((a, b) => a - b);
  close(sorted[0]!, 1);
  close(sorted[1]!, 3.5 - Math.sqrt(5) / 2);
  close(sorted[2]!, 3.5 + Math.sqrt(5) / 2);
  const cols = [0, 1, 2].map((j) => [vectors[0]![j]!, vectors[1]![j]!, vectors[2]![j]!]);
  const q = quaternionFromAxes(cols[0]!, cols[1]!, cols[2]!.map((v) => v * Math.sign(cols[0]![0]! * (cols[1]![1]! * cols[2]![2]! - cols[1]![2]! * cols[2]![1]!) - cols[0]![1]! * (cols[1]![0]! * cols[2]![2]! - cols[1]![2]! * cols[2]![0]!) + cols[0]![2]! * (cols[1]![0]! * cols[2]![1]! - cols[1]![1]! * cols[2]![0]!))));
  const axes = rotationAxes(q);
  for (let j = 0; j < 2; j++) for (let k = 0; k < 3; k++) close(axes[j]![k]!, cols[j]![k]!, 1e-9);
});

/** Deterministic points: a flat 1 m × 1 m patch on a 5 cm grid, plus a 0.25 m cube cloud. */
function syntheticPoints() {
  const xyz: number[] = [];
  const rgb: number[] = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) { xyz.push(0.025 + i * 0.05, 0.025 + j * 0.05, 0.1); rgb.push(0.4, 0.5, 0.3); }
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) for (let c = 0; c < 5; c++) { xyz.push(2.025 + a * 0.05, 2.025 + b * 0.05, 2.025 + c * 0.05); rgb.push(0.2, 0.6, 0.2); }
  return { count: xyz.length / 3, xyz: Float64Array.from(xyz), rgb: Float32Array.from(rgb) };
}

test("voxel Gaussians: flat patches face up, filled voxels are isotropic", () => {
  const gs = fitVoxelGaussians(syntheticPoints(), { voxelSize: 0.25 });
  assert.equal(gs.length, 16 + 1); // 4 × 4 voxels of the patch, one voxel of the cube
  const discs = gs.map(gaussianToDisc);
  for (const d of discs.slice(0, 16)) {
    close(Math.abs(d.normal[2]), 1, 1e-9);
    assert.ok(d.flatness < 0.05);
  }
  const cube = discs[16]!;
  close(cube.flatness, 1, 1e-6);
  close(cube.position[0], 2.125, 1e-9);
  assert.deepEqual(gs[16]!.colour.map((c) => Math.round(c * 10) / 10), [0.2, 0.6, 0.2]);
});

test("voxel Gaussians round-trip through a reference-3DGS PLY", () => {
  const gs = fitVoxelGaussians(syntheticPoints(), { voxelSize: 0.25 });
  const back = gaussiansFromPly(readPly(writePlyFloat32(TOY_GS_PROPERTIES, gaussiansToPlyRows(gs))));
  assert.equal(back.length, gs.length);
  gs.forEach((g, i) => {
    for (let k = 0; k < 3; k++) close(back[i]!.position[k]!, g.position[k]!, 1e-5);
    for (let k = 0; k < 3; k++) close(back[i]!.scales[k]! / g.scales[k]!, 1, 1e-5);
    close(back[i]!.opacity, g.opacity, 1e-5);
  });
});
