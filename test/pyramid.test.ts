import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPyramid } from "../src/pointcloud/pyramid.js";
import { BASE_CELLS } from "../src/progressive.js";
import { tileWidthMetres } from "../src/tile-geometry.js";

const SAPPORO = { lng: 141.35077, lat: 43.06866 };

/** A flat 3 m x 3 m patch with 2 cm point spacing, plus a vertical 3 m x 3 m wall: dense enough for several levels. */
function points() {
  const xyz: number[] = [];
  const rgb: number[] = [];
  for (let i = 0; i < 150; i++) {
    for (let j = 0; j < 150; j++) {
      xyz.push(i * 0.02, j * 0.02, 10); rgb.push(0.4, 0.5, 0.3);
      xyz.push(i * 0.02, 5, 10 + j * 0.02); rgb.push(0.7, 0.7, 0.6);
    }
  }
  return { count: xyz.length / 3, xyz: Float64Array.from(xyz), rgb: Float32Array.from(rgb) };
}

const config = { aggregatedZooms: [18, 19], maxzoom: 20, levels: 3, minRefinementSupport: 3 };

test("a pyramid has aggregated tiles below maxzoom and levelled tiles at maxzoom", () => {
  const p = buildPyramid(points(), SAPPORO, config);
  const byZoom = (z: number) => p.tiles.filter((t) => t.tile.z === z);
  assert.ok(byZoom(18).length >= 1 && byZoom(19).length >= 1 && byZoom(20).length >= 1);
  for (const t of [...byZoom(18), ...byZoom(19)]) assert.deepEqual(t.levels, [t.splats.length]);
  for (const t of byZoom(20)) {
    assert.equal(t.levels.length, 3);
    assert.equal(t.levels.reduce((a, b) => a + b, 0), t.splats.length);
  }
  // Coarser zooms hold fewer Gaussians.
  assert.ok(p.gaussiansPerZoom[18]! < p.gaussiansPerZoom[19]! && p.gaussiansPerZoom[19]! < p.gaussiansPerZoom[20]!);
});

test("every splat lies inside its tile", () => {
  const p = buildPyramid(points(), SAPPORO, config);
  for (const t of p.tiles) for (const s of t.splats) assert.ok(s.x >= 0 && s.x < 1 && s.y >= 0 && s.y < 1);
});

test("maxzoom level 0 holds one splat per occupied level-0 cell; omission only thins later levels", () => {
  const full = buildPyramid(points(), SAPPORO, { ...config, minRefinementSupport: 1 });
  const thin = buildPyramid(points(), SAPPORO, { ...config, minRefinementSupport: 6 });
  const top = (p: typeof full) => p.tiles.filter((t) => t.tile.z === 20);
  const level0 = (p: typeof full) => top(p).reduce((n, t) => n + t.levels[0]!, 0);
  assert.equal(level0(full), level0(thin));
  assert.ok(top(thin).reduce((n, t) => n + t.splats.length, 0) < top(full).reduce((n, t) => n + t.splats.length, 0));
  // Level 0 has one splat per occupied cell of size W / 512.
  const w = tileWidthMetres(top(full)[0]!.tile);
  const cells = new Set<string>();
  for (const t of top(full)) {
    for (const s of t.splats.slice(0, t.levels[0]!)) {
      cells.add(`${t.tile.x},${t.tile.y},${Math.floor(s.x * BASE_CELLS)},${Math.floor(s.y * BASE_CELLS)},${Math.floor(s.z / (w / BASE_CELLS))}`);
    }
  }
  assert.equal(cells.size, level0(full));
});

test("one level at the maxzoom means no refinement", () => {
  const p = buildPyramid(points(), SAPPORO, { aggregatedZooms: [18], maxzoom: 19, levels: 1, minRefinementSupport: 99 });
  assert.ok(p.tiles.filter((t) => t.tile.z === 19).every((t) => t.levels.length === 1));
  assert.deepEqual(p.tiles.filter((t) => t.tile.z === 19).map((t) => t.levels[0]), p.tiles.filter((t) => t.tile.z === 19).map((t) => t.splats.length));
  assert.equal(p.finestVoxelMetres, tileWidthMetres({ z: 19, x: 0, y: Math.floor(((1 - Math.asinh(Math.tan((SAPPORO.lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** 19) }) / BASE_CELLS);
});

test("invalid configurations are rejected", () => {
  assert.throws(() => buildPyramid(points(), SAPPORO, { ...config, levels: 0 }), RangeError);
  assert.throws(() => buildPyramid(points(), SAPPORO, { ...config, aggregatedZooms: [20] }), RangeError);
});
