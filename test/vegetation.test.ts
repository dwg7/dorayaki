import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeSurfelBlock, packedSurfelBlock, type Splat } from "../src/surfel-block.js";
import { vegetationFlags } from "../demo/src/vegetation.js";

const base = { qw: 1, qx: 0, qy: 0, qz: 0, r: 100, g: 120, b: 90, a: 242 };
const W = 250; // tile width, metres

/** A flat ground grid (z = 100), a tree (round blobs 5 to 12 m above it), and a bridge deck (flat splats 15 m up). */
function scene(): { splats: Splat[]; ground: number[]; tree: number[]; deck: number[] } {
  const splats: Splat[] = [];
  const ground: number[] = [], tree: number[] = [], deck: number[] = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    ground.push(splats.length);
    splats.push({ ...base, x: 0.05 + i * 0.02, y: 0.05 + j * 0.02, z: 100, sx: 1, sy: 1, sz: 0.05 }); // flat
  }
  for (let k = 0; k < 30; k++) {
    tree.push(splats.length);
    splats.push({ ...base, x: 0.2 + (k % 5) * 0.004, y: 0.2 + Math.floor(k / 5) * 0.004, z: 105 + (k % 7), sx: 0.8, sy: 0.7, sz: 0.75 }); // round
  }
  for (let k = 0; k < 20; k++) {
    deck.push(splats.length);
    splats.push({ ...base, x: 0.2 + k * 0.01, y: 0.3, z: 115, sx: 2, sy: 2, sz: 0.1 }); // flat, high above the ground
  }
  return { splats, ground, tree, deck };
}

for (const version of [5, 6] as const) {
  test(`version ${version}: ground stays, a round crown above it goes, a flat deck stays`, () => {
    const { splats, ground, tree, deck } = scene();
    const block = packedSurfelBlock(encodeSurfelBlock(splats, [splats.length], { version }));
    const flags = vegetationFlags(block, W);
    assert.ok(ground.every((i) => flags[i] === 0), "ground");
    assert.ok(tree.every((i) => flags[i] === 1), "tree");
    assert.ok(deck.every((i) => flags[i] === 0), "deck");
    const any = vegetationFlags(block, W, { roundOnly: false });
    assert.ok(deck.every((i) => any[i] === 1), "without the shape test the deck counts as above ground");
    assert.ok(ground.every((i) => any[i] === 0));
  });
}

test("minHeight and an empty block", () => {
  const { splats, tree } = scene();
  const block = packedSurfelBlock(encodeSurfelBlock(splats, [splats.length]));
  const high = vegetationFlags(block, W, { minHeight: 8 });
  assert.ok(tree.some((i) => high[i] === 0) && tree.some((i) => high[i] === 1), "only the higher blobs");
  assert.equal(vegetationFlags(packedSurfelBlock(encodeSurfelBlock([])), W).length, 0);
});
