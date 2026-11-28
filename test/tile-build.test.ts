import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTilePieces, type TilePointFeed } from "../src/pointcloud/tile-build.js";
import { tileWidthMetres } from "../src/tile-geometry.js";

const TILE = { z: 17, x: 116122, y: 52009 };
const W = tileWidthMetres(TILE);
const CONFIG = { adaptive: { maxLevel: 3, thickness: 0.2, colorTolerance: 0.2, sparseSupport: 24, sparseScale: 10 } };

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A flat ground over the whole tile at 20 m with a wall of the same color, and a floor 6 m above part of it (two z at one x/y). */
const scene = (seed: number): TilePointFeed => (add) => {
  const r = rng(seed);
  for (let i = 0; i < 60000; i++) add(r() * W, r() * W, 20 + r() * 0.02, 0.4, 0.4, 0.4);
  for (let i = 0; i < 20000; i++) add(r() * 60, r() * 60, 26 + r() * 0.02, 0.9, 0.1, 0.1);
};

test("pieces cover z17, z16 and z15 in tile units of the target tiles", () => {
  const pieces = buildTilePieces(scene(1), TILE, CONFIG);
  assert.deepEqual(pieces.map((p) => p.tile), [TILE, { z: 16, x: TILE.x >> 1, y: TILE.y >> 1 }, { z: 15, x: TILE.x >> 2, y: TILE.y >> 2 }]);
  for (const p of pieces) {
    assert.ok(p.splats.length > 0);
    for (const s of p.splats) assert.ok(s.x >= 0 && s.x < 1 && s.y >= 0 && s.y < 1, `${p.tile.z}: ${s.x},${s.y}`);
  }
  // Coarser zooms hold fewer splats; a z16 piece lies in its quarter of the z16 tile, a z15 piece in its sixteenth.
  assert.ok(pieces[1]!.splats.length < pieces[0]!.splats.length && pieces[2]!.splats.length < pieces[1]!.splats.length);
  const ox = TILE.x & 1, oy = TILE.y & 1;
  for (const s of pieces[1]!.splats) assert.ok(s.x >= ox / 2 && s.x < (ox + 1) / 2 && s.y >= oy / 2 && s.y < (oy + 1) / 2);
});

test("two heights at the same x/y both survive (not a height field)", () => {
  const [z17] = buildTilePieces(scene(2), TILE, CONFIG);
  const upper = z17!.splats.filter((s) => s.z > 25), lower = z17!.splats.filter((s) => s.z < 21);
  assert.ok(upper.length > 0 && lower.length > 0);
  assert.ok(upper.every((s) => s.r > 200 && s.g < 60));
});

test("the same points in another order give the same splats", () => {
  const pts: number[][] = [];
  scene(4)((e, s, u, r, g, b) => { pts.push([e, s, u, r, g, b]); });
  const feedOrder = (order: number[]): TilePointFeed => (add) => { for (const i of order) add(pts[i]![0]!, pts[i]![1]!, pts[i]![2]!, pts[i]![3]!, pts[i]![4]!, pts[i]![5]!); };
  const idx = pts.map((_, i) => i);
  const rev = [...idx].reverse();
  const a = buildTilePieces(feedOrder(idx), TILE, CONFIG), b = buildTilePieces(feedOrder(rev), TILE, CONFIG);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i]!.splats.length, b[i]!.splats.length);
    // Sums are accumulated in a different order: positions agree to rounding.
    for (let k = 0; k < a[i]!.splats.length; k++) assert.ok(Math.abs(a[i]!.splats[k]!.x - b[i]!.splats[k]!.x) < 1e-9 && Math.abs(a[i]!.splats[k]!.z - b[i]!.splats[k]!.z) < 1e-6);
  }
});

test("an empty tile gives empty pieces; a one-point tile gives one splat per zoom", () => {
  for (const p of buildTilePieces(() => undefined, TILE, CONFIG)) assert.equal(p.splats.length, 0);
  for (const p of buildTilePieces((add) => add(10, 10, 5, 1, 1, 1), TILE, CONFIG)) assert.equal(p.splats.length, 1);
});

test("a class slot is carried into the opacity by opacityOf", () => {
  const cfg = { adaptive: { ...CONFIG.adaptive, opacityOf: (c: readonly number[]) => c.indexOf(Math.max(...c)) / 255 }, classSlots: 3, zooms: [17] };
  const [p] = buildTilePieces((add) => { for (let i = 0; i < 50; i++) add(100 + (i % 7) * 0.05, 100 + (i % 5) * 0.05, 3, 0.5, 0.5, 0.5, 2); }, TILE, cfg);
  assert.equal(p!.splats.length, 1);
  assert.equal(p!.splats[0]!.a, 2);
});

test("a tile of another zoom, a zoom above 17 and maxLevel above 3 are rejected", () => {
  assert.throws(() => buildTilePieces(() => undefined, { z: 16, x: 1, y: 1 }, CONFIG), RangeError);
  assert.throws(() => buildTilePieces(() => undefined, TILE, { ...CONFIG, zooms: [18] }), RangeError);
  assert.throws(() => buildTilePieces(() => undefined, TILE, { adaptive: { ...CONFIG.adaptive, maxLevel: 4 } }), RangeError);
});

test("cellScale 2 gives coarser z16 and z15 and leaves z17 alone; a scale that breaks the groups is rejected", () => {
  const base = buildTilePieces(scene(5), TILE, CONFIG);
  const coarse = buildTilePieces(scene(5), TILE, { ...CONFIG, cellScale: 2 });
  assert.equal(coarse[0]!.splats.length, base[0]!.splats.length);
  assert.equal(coarse[1]!.voxels < base[1]!.voxels, true);
  assert.equal(coarse[2]!.voxels < base[2]!.voxels, true);
  assert.throws(() => buildTilePieces(scene(5), TILE, { ...CONFIG, cellScale: 3 }), RangeError);
  assert.throws(() => buildTilePieces(scene(5), TILE, { ...CONFIG, cellScale: 64 }), RangeError);
});

test("thicknessScale and colorScale only act below z17", () => {
  const base = buildTilePieces(scene(6), TILE, CONFIG);
  const strong = buildTilePieces(scene(6), TILE, { ...CONFIG, thicknessScale: 4, colorScale: 3 });
  assert.equal(strong[0]!.splats.length, base[0]!.splats.length);
  assert.ok(strong[1]!.splats.length <= base[1]!.splats.length && strong[2]!.splats.length <= base[2]!.splats.length);
});

test("targetSplats: a piece over its share is merged harder, z17 is untouched, and the pieces of a tile add up to at most the target", () => {
  const plain = buildTilePieces(scene(7), TILE, CONFIG);
  const target = 400;
  const fitted = buildTilePieces(scene(7), TILE, { ...CONFIG, targetSplats: target });
  assert.equal(fitted[0]!.splats.length, plain[0]!.splats.length);
  assert.equal(fitted[0]!.mergeScale, undefined);
  for (const [i, d] of [[1, 1], [2, 2]] as const) {
    const share = Math.floor(target / 4 ** d);
    assert.ok(fitted[i]!.splats.length <= Math.max(share, plain[i]!.splats.length ? 0 : share) || fitted[i]!.mergeScale === 64, `z${17 - d}: ${fitted[i]!.splats.length} > ${share} at step ${fitted[i]!.mergeScale}`);
    assert.ok(fitted[i]!.splats.length <= plain[i]!.splats.length);
    assert.ok(fitted[i]!.mergeScale! >= 1);
  }
  // A target the piece already meets changes nothing and takes step 1.
  const roomy = buildTilePieces(scene(7), TILE, { ...CONFIG, targetSplats: 10_000_000 });
  assert.deepEqual(roomy[1]!.splats, plain[1]!.splats);
  assert.equal(roomy[1]!.mergeScale, 1);
});

test("targetSplats can be given by zoom", () => {
  const p = buildTilePieces(scene(8), TILE, { ...CONFIG, targetSplats: { 16: 10_000_000, 15: 200 } });
  assert.equal(p[1]!.mergeScale, 1);
  assert.ok(p[2]!.mergeScale! >= 1);
});

test("E025: finestCellScale coarsens z17 only; a z17 target comes only from the per-zoom form", () => {
  const base = buildTilePieces(scene(9), TILE, CONFIG);
  const coarse = buildTilePieces(scene(9), TILE, { ...CONFIG, finestCellScale: 2 });
  assert.ok(coarse[0]!.voxels < base[0]!.voxels);
  assert.equal(coarse[1]!.voxels, base[1]!.voxels);
  assert.throws(() => buildTilePieces(scene(9), TILE, { ...CONFIG, finestCellScale: 3 }), RangeError);
  const capped = buildTilePieces(scene(9), TILE, { ...CONFIG, targetSplats: { 17: 50 } });
  assert.ok(capped[0]!.mergeScale! >= 1);
  assert.ok(capped[0]!.splats.length <= base[0]!.splats.length);
  assert.ok(capped[0]!.splats.length <= 50 || capped[0]!.mergeScale === 64);
  assert.equal(buildTilePieces(scene(9), TILE, { ...CONFIG, targetSplats: 50 })[0]!.mergeScale, undefined);
});

test("E026: maxMergeScale stops loosening at that step; a piece still over its share keeps that step's splats and says so", () => {
  const free = buildTilePieces(scene(9), TILE, { ...CONFIG, targetSplats: { 17: 1 } });
  const capped = buildTilePieces(scene(9), TILE, { ...CONFIG, targetSplats: { 17: 1 }, maxMergeScale: 2 });
  assert.equal(capped[0]!.mergeScale, 2);
  assert.equal(capped[0]!.overTarget, true);
  assert.ok(capped[0]!.splats.length >= free[0]!.splats.length, "a lower ceiling never merges more");
  const one = buildTilePieces(scene(9), TILE, { ...CONFIG, targetSplats: { 17: 1 }, maxMergeScale: 1 });
  assert.equal(one[0]!.splats.length, buildTilePieces(scene(9), TILE, CONFIG)[0]!.splats.length, "ceiling 1: the base rule");
  assert.equal(buildTilePieces(scene(9), TILE, { ...CONFIG, targetSplats: { 17: 1e9 }, maxMergeScale: 2 })[0]!.overTarget, undefined);
  assert.throws(() => buildTilePieces(scene(9), TILE, { ...CONFIG, maxMergeScale: 3 }), RangeError);
});
