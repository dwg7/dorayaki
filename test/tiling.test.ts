import assert from "node:assert/strict";
import { test } from "node:test";

import type { Surfel } from "../src/surfel-block.js";
import { blockTiles, splitByTile } from "../src/tiling.js";

const block = { origin: { z: 18, x: 100, y: 200 }, cols: 2, rows: 2 };
const s = (x: number, y: number, z = 0): Surfel => ({ x, y, z, nx: 0, ny: 0, nz: 1, radius: 1, r: 0, g: 0, b: 0, a: 255 });

test("blockTiles lists the block row-major from the north-west tile", () => {
  assert.deepEqual(blockTiles(block), [
    { z: 18, x: 100, y: 200 },
    { z: 18, x: 101, y: 200 },
    { z: 18, x: 100, y: 201 },
    { z: 18, x: 101, y: 201 },
  ]);
  assert.throws(() => blockTiles({ ...block, cols: 0 }), RangeError);
});

test("each surfel goes to the tile containing its centre, in tile-local coordinates", () => {
  const parts = splitByTile([s(0.25, 0.5), s(1.5, 0.25, 7), s(0.5, 1.75), s(1.125, 1.875)], block);
  assert.deepEqual(parts.map((p) => p.surfels.map((q) => [q.x, q.y, q.z])), [
    [[0.25, 0.5, 0]],
    [[0.5, 0.25, 7]],
    [[0.5, 0.75, 0]],
    [[0.125, 0.875, 0]],
  ]);
});

test("centres exactly on a seam go to the east or south tile (half-open intervals)", () => {
  const parts = splitByTile([s(1, 0.5), s(0.5, 1), s(1, 1), s(0, 0)], block);
  assert.deepEqual(parts.map((p) => p.surfels.length), [1, 1, 1, 1]);
  assert.deepEqual([parts[1]?.surfels[0]?.x, parts[2]?.surfels[0]?.y], [0, 0]);
});

test("no surfel is duplicated, dropped, or clipped; radius may reach across the seam", () => {
  const input = [s(0.99, 0.5), s(1.01, 0.5), s(0.5, 0.5)].map((q) => ({ ...q, radius: 5 }));
  const parts = splitByTile(input, block);
  assert.equal(parts.reduce((n, p) => n + p.surfels.length, 0), input.length);
  assert.ok(parts.flatMap((p) => p.surfels).every((q) => q.radius === 5));
  assert.deepEqual(parts[0]?.surfels.map((q) => q.x), [0.99, 0.5]); // original order kept
});

test("tiles with no surfels are still listed", () => {
  const parts = splitByTile([s(0.5, 0.5)], block);
  assert.deepEqual(parts.map((p) => p.surfels.length), [1, 0, 0, 0]);
});

test("centres outside the block are rejected", () => {
  for (const [x, y] of [[-0.001, 0.5], [2, 0.5], [0.5, 2], [Number.NaN, 0]] as const) {
    assert.throws(() => splitByTile([s(x, y)], block), RangeError);
  }
});
