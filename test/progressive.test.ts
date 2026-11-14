import assert from "node:assert/strict";
import { test } from "node:test";

import { BASE_CELLS, omitWeakRefinements, orderByRefinement, prefixCount } from "../src/progressive.js";
import { surfelToSplat } from "../src/splat.js";
import { decodeSurfelBlockWithLevels, encodeSurfelBlock, type Surfel } from "../src/surfel-block.js";
import { expectSplatsClose } from "./helpers.js";

const W = 32; // metres; level-0 cell = 32 / 512 = 6.25 cm
const s = (x: number, y: number, z: number, r = 0): Surfel => ({ x, y, z, nx: 0, ny: 0, nz: 1, radius: Math.fround(0.01), r, g: 0, b: 0, a: 255 });

/** A dense 12 × 12 × 4 lattice at 1.5625 cm spacing (a quarter of a level-0 cell), in one corner. */
function lattice(): Surfel[] {
  const step = W / (BASE_CELLS * 4); // metres
  const out: Surfel[] = [];
  for (let k = 0; k < 4; k++) for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
    out.push(s(((i + 0.5) * step) / W, ((j + 0.5) * step) / W, 10 + (k + 0.5) * step, i));
  }
  return out;
}

const key = (q: Surfel) => `${q.x},${q.y},${q.z}`;

test("the levels are a permutation of the input: nothing added, dropped or duplicated", () => {
  const input = lattice();
  const { surfels, levels } = orderByRefinement(input, W, 3);
  assert.equal(levels.reduce((a, b) => a + b, 0), input.length);
  assert.deepEqual(surfels.map(key).sort(), input.map(key).sort());
  assert.equal(new Set(surfels.map(key)).size, input.length);
});

test("level k holds one representative per occupied cell not already covered", () => {
  // 12 × 12 × 4 fine points span 3 × 3 × 1 level-0 cells and 6 × 6 × 2 level-1 cells.
  const { levels } = orderByRefinement(lattice(), W, 3);
  assert.deepEqual(levels, [9, 72 - 9, 576 - 72]);
});

test("every prefix of whole levels covers each occupied cell of its finest level", () => {
  const { surfels, levels } = orderByRefinement(lattice(), W, 3);
  for (let k = 0; k < 3; k++) {
    const cells = BASE_CELLS * 2 ** k;
    const size = W / cells;
    const cell = (q: Surfel) => `${Math.floor(q.x * cells)},${Math.floor(q.y * cells)},${Math.floor(q.z / size)}`;
    const occupied = new Set(surfels.map(cell));
    const covered = new Set(surfels.slice(0, prefixCount(levels, k + 1)).map(cell));
    assert.deepEqual([...covered].sort(), [...occupied].sort(), `level ${k}`);
  }
});

test("a representative is the member nearest its cell centroid", () => {
  // One level-0 cell with three points on a line: the middle one is chosen.
  const c = W / BASE_CELLS;
  const pts = [s(0.1 * c / W, 0.5 * c / W, 0.5 * c), s(0.5 * c / W, 0.5 * c / W, 0.5 * c), s(0.8 * c / W, 0.5 * c / W, 0.5 * c)];
  const { surfels, levels } = orderByRefinement(pts, W, 2);
  assert.deepEqual(levels, [1, 2]);
  assert.equal(surfels[0], pts[1]);
});

test("one level is the whole set; ordering is deterministic", () => {
  const input = lattice();
  assert.deepEqual(orderByRefinement(input, W, 1).levels, [input.length]);
  assert.deepEqual(orderByRefinement(input, W, 3), orderByRefinement([...input], W, 3));
  assert.throws(() => orderByRefinement(input, W, 0), RangeError);
});

test("the ordered tile round-trips with its level table", () => {
  const { surfels, levels } = orderByRefinement(lattice(), W, 3);
  const splats = surfels.map(surfelToSplat);
  const back = decodeSurfelBlockWithLevels(encodeSurfelBlock(splats, levels));
  assert.deepEqual(back.levels, levels);
  expectSplatsClose(back.splats, splats);
  assert.equal(prefixCount(levels, 0), 0);
  assert.equal(prefixCount(levels, 99), surfels.length);
});

test("omitting weak refinements keeps level 0 whole and thins later levels in order", () => {
  const order = orderByRefinement(lattice(), W, 3);
  const keep = (q: Surfel) => q.r % 2 === 0; // r encodes the lattice column
  const thin = omitWeakRefinements(order, keep);
  assert.equal(thin.levels[0], order.levels[0]);
  assert.deepEqual(thin.surfels.slice(0, thin.levels[0]), order.surfels.slice(0, order.levels[0]));
  const rest = order.surfels.slice(order.levels[0]).filter(keep);
  assert.deepEqual(thin.surfels.slice(thin.levels[0]), rest);
  assert.equal(thin.levels.reduce((a, b) => a + b, 0), thin.surfels.length);
  // Level-0 coverage is unchanged.
  const cell = (q: Surfel) => `${Math.floor(q.x * BASE_CELLS)},${Math.floor(q.y * BASE_CELLS)},${Math.floor(q.z / (W / BASE_CELLS))}`;
  assert.deepEqual(new Set(thin.surfels.map(cell)), new Set(order.surfels.map(cell)));
  // Keeping everything is the identity.
  assert.deepEqual(omitWeakRefinements(order, () => true), order);
});
