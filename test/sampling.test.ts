import assert from "node:assert/strict";
import { test } from "node:test";

import { patchOvershoot, samplePatch } from "../src/fixtures/sampling.js";

const tileAxis = (lo: number, hi: number, w: number) => ({ lo, hi, metresPerUnit: w });
const zAxis = (lo: number, hi: number) => ({ lo, hi, metresPerUnit: 1 });

test("a tile-wide horizontal patch keeps the 1/16 grid and P·√½ radius", () => {
  const p = samplePatch(tileAxis(0, 1, 128), tileAxis(0, 1, 128), 8);
  assert.equal(p.u.length, 16);
  assert.deepEqual(p.u, Array.from({ length: 16 }, (_, k) => (k + 0.5) / 16));
  assert.deepEqual(p.cell, [8, 8]);
  assert.equal(p.radius, Math.fround(Math.hypot(8, 8) / 2));
});

test("an 8 m face on a 124 m tile is subdivided to fit its height", () => {
  const w = 124.17563859464565;
  const p = samplePatch(tileAxis(0, 1, w), zAxis(8, 16), w / 16);
  assert.deepEqual(p.v, [10, 14]);
  assert.equal(p.u.length, 32);
  assert.ok(p.radius < 2.8 && p.radius > 2.7, `radius ${p.radius}`);
  // Old rule: radius P·√½ = 5.49 m, reaching 3.49 m past the face edge.
  assert.ok(patchOvershoot(p) < 0.9);
});

test("overshoot never exceeds (√5 - 1)/4 of the pitch", () => {
  const bound = (Math.sqrt(5) - 1) / 4;
  for (const pitch of [1, 4, 7.76, 8, 62.5]) {
    for (const a of [0.3, 1, 2.5, 7.9, 8, 11, 16, 33, 124.2]) {
      for (const b of [0.3, 1, 3, 8, 11, 15.5, 40]) {
        const p = samplePatch(zAxis(0, a), zAxis(0, b), pitch);
        const s = Math.max(...p.cell);
        assert.ok(s <= pitch + 1e-9, `cell ${s} > pitch ${pitch}`);
        assert.ok(patchOvershoot(p) <= bound * pitch + 1e-6, `a=${a} b=${b} pitch=${pitch}`);
        // Discs still cover the cell corners.
        assert.ok(p.radius + 1e-6 >= Math.hypot(p.cell[0], p.cell[1]) / 2);
      }
    }
  }
});

test("rejects degenerate patches and pitches", () => {
  assert.throws(() => samplePatch(zAxis(0, 0), zAxis(0, 1), 1), RangeError);
  assert.throws(() => samplePatch(zAxis(0, 1), zAxis(0, 1), 0), RangeError);
});
