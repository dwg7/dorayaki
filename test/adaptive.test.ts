import assert from "node:assert/strict";
import { test } from "node:test";

import { adaptiveGaussians } from "../src/pointcloud/adaptive.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";

/** Points on the plane z = z0 over [0, size) x [0, size) metres, `step` apart, colour from `colour(x, y)`. */
function plane(acc: VoxelAccumulator, size: number, step: number, z0: number, colour: (x: number, y: number) => number): number {
  let n = 0;
  for (let x = step / 2; x < size; x += step) {
    for (let y = step / 2; y < size; y += step) {
      const c = colour(x, y);
      acc.add(x, y, z0, c, c, c);
      n++;
    }
  }
  return n;
}
const totalSupport = (g: readonly { support?: number }[]) => g.reduce((s, q) => s + (q.support ?? 0), 0);
const OPTIONS = { maxLevel: 4, thickness: 0.05, colourTolerance: 0.1 };

test("maxLevel 0 equals the uniform fit", () => {
  const acc = new VoxelAccumulator(0.5, 4);
  plane(acc, 4, 0.1, 0, () => 0.5);
  const a = adaptiveGaussians(acc, { ...OPTIONS, maxLevel: 0 }).gaussians;
  const b = acc.toGaussians({ minPoints: 1, minScale: 0.001, degenerateScale: 0.125 });
  assert.equal(a.length, b.length);
  a.forEach((g, i) => {
    assert.deepEqual(g.position, b[i]!.position);
    assert.equal(g.support, b[i]!.support);
  });
});

test("a flat uniform plane merges into a few large splats and keeps every point", () => {
  const acc = new VoxelAccumulator(0.5, 4);
  const n = plane(acc, 8, 0.1, 0, () => 0.5);
  const { gaussians } = adaptiveGaussians(acc, OPTIONS);
  assert.equal(acc.voxels, 256);
  assert.ok(gaussians.length <= 4, `${gaussians.length} splats`);
  assert.equal(totalSupport(gaussians), n);
});

test("parallel planes one metre apart do not merge across the gap", () => {
  const acc = new VoxelAccumulator(0.5, 4);
  const n = plane(acc, 4, 0.1, 0, () => 0.5) + plane(acc, 4, 0.1, 1, () => 0.5);
  const { gaussians } = adaptiveGaussians(acc, OPTIONS);
  assert.equal(totalSupport(gaussians), n);
  for (const g of gaussians) {
    assert.ok(Math.min(...g.scales) <= 0.05, "thin axis stays thin");
    assert.ok(Math.abs(g.position[2]) < 0.05 || Math.abs(g.position[2] - 1) < 0.05, `z ${g.position[2]}`);
  }
});

test("a colour edge stops the merge", () => {
  const acc = new VoxelAccumulator(0.5, 4);
  const n = plane(acc, 8, 0.1, 0, (x) => (x < 4 ? 0.1 : 0.9));
  const { gaussians } = adaptiveGaussians(acc, OPTIONS);
  assert.equal(totalSupport(gaussians), n);
  assert.ok(gaussians.length >= 2);
  for (const g of gaussians) assert.ok(Math.abs(g.colour[0] - 0.1) < 0.02 || Math.abs(g.colour[0] - 0.9) < 0.02, `colour ${g.colour[0]}`);
});

test("a tilted plane merges; a thick volume does not", () => {
  const tilted = new VoxelAccumulator(0.5, 4);
  for (let x = 0.05; x < 8; x += 0.1) for (let y = 0.05; y < 8; y += 0.1) tilted.add(x, y, 0.3 * x, 0.5, 0.5, 0.5);
  assert.ok(adaptiveGaussians(tilted, OPTIONS).gaussians.length < tilted.voxels / 4);

  const cloud = new VoxelAccumulator(0.5, 4);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 4000; i++) cloud.add(rnd() * 4, rnd() * 4, rnd() * 4, 0.5, 0.5, 0.5);
  assert.equal(adaptiveGaussians(cloud, OPTIONS).gaussians.length, cloud.voxels);
});

test("rejects a bad maxLevel", () => {
  assert.throws(() => adaptiveGaussians(new VoxelAccumulator(1), { ...OPTIONS, maxLevel: -1 }), RangeError);
  assert.throws(() => adaptiveGaussians(new VoxelAccumulator(1), { ...OPTIONS, maxLevel: 1.5 }), RangeError);
});

test("the sparse rule merges lightly supported voxels whatever their shape", () => {
  const acc = new VoxelAccumulator(0.5, 4);
  let seed = 11;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 300; i++) acc.add(rnd() * 4, rnd() * 4, rnd() * 4, 0.5, 0.5, 0.5); // ~1 point per voxel
  const strict = { maxLevel: 3, thickness: 0.01, colourTolerance: 0.01 };
  const without = adaptiveGaussians(acc, strict).gaussians;
  const withSparse = adaptiveGaussians(acc, { ...strict, sparseSupport: 6 }).gaussians;
  assert.ok(withSparse.length < without.length / 2, `${withSparse.length} against ${without.length}`);
  assert.equal(totalSupport(withSparse), 300);
});

test("vegetation share sets the opacity: all-vegetation voxels get the vegetation opacity, mixed ones in between, none by default", () => {
  const acc = new VoxelAccumulator(1);
  // Voxel A: 4 vegetation points; voxel B: 4 ground points; voxel C: 2 of 4 are vegetation.
  for (let i = 0; i < 4; i++) acc.add(0.1 + i * 0.1, 0.5, 0.5, 0.2, 0.5, 0.2, 1);
  for (let i = 0; i < 4; i++) acc.add(5.1 + i * 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0);
  for (let i = 0; i < 4; i++) acc.add(10.1 + i * 0.1, 0.5, 0.5, 0.3, 0.6, 0.3, i < 2 ? 1 : 0);
  const none = acc.toGaussians({});
  assert.deepEqual(none.map((g) => g.opacity), [0.95, 0.95, 0.95], "without vegetationOpacity nothing changes");
  const withVeg = acc.toGaussians({ vegetationOpacity: 0.45 }).map((g) => +g.opacity.toFixed(3));
  assert.deepEqual(withVeg, [0.45, 0.95, 0.7]);
  const merged = adaptiveGaussians(acc, { maxLevel: 0, thickness: 1, colourTolerance: 1, vegetationOpacity: 0.45 }).gaussians.map((g) => +g.opacity.toFixed(3));
  assert.deepEqual(merged, [0.45, 0.95, 0.7]);
});

test("merging keeps the vegetation share of all the points", () => {
  const acc = new VoxelAccumulator(1);
  // Two neighbouring voxels, one vegetation and one ground, merged into one cell of size 2.
  for (let i = 0; i < 4; i++) acc.add(0.1 + i * 0.2, 0.5, 0.5, 0.4, 0.4, 0.4, 1);
  for (let i = 0; i < 4; i++) acc.add(1.1 + i * 0.2, 0.5, 0.5, 0.4, 0.4, 0.4, 0);
  const r = adaptiveGaussians(acc, { maxLevel: 1, thickness: 5, colourTolerance: 1, vegetationOpacity: 0.35 });
  assert.equal(r.gaussians.length, 1);
  assert.ok(Math.abs(r.gaussians[0]!.opacity - 0.65) < 1e-9, `opacity ${r.gaussians[0]!.opacity}`);
});
