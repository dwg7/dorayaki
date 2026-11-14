import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { generatePlane } from "../src/fixtures/plane.js";
import { surfelToSplat } from "../src/splat.js";
import { decodeSurfelBlock, encodeSurfelBlock, surfelBlockByteLength } from "../src/surfel-block.js";
import { expectSplatsClose } from "./helpers.js";

/** The fixture as stored: circular surfels converted to splats. */
const splatsOf = (o: Parameters<typeof generatePlane>[0]) => generatePlane(o).map(surfelToSplat);

/**
 * SHA-256 of encodeSurfelBlock(splatsOf(OPTS)): default 16 × 16 grid
 * on a 128 m tile. If this changes, the fixture or the wire format changed; update it
 * deliberately and say so in the commit.
 */
const PLANE_16_SHA256 = "85f63ab06ea60c4cc13941ba5ed6950e3f7370b30f473dc93d458808fb6b7c74";
const OPTS = { tileWidthMetres: 128 };

test("plane fixture has the expected shape", () => {
  const plane = generatePlane({ ...OPTS, gridSize: 4 });
  assert.equal(plane.length, 16);
  for (const s of plane) {
    assert.equal(s.z, 0);
    assert.deepEqual([s.nx, s.ny, s.nz], [0, 0, 1]);
    assert.ok(s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1);
  }
  assert.deepEqual([plane[0]?.x, plane[0]?.y], [0.125, 0.125]);
  assert.deepEqual([plane[15]?.x, plane[15]?.y], [0.875, 0.875]);
  // Radius is metric: half the cell diagonal of a 32 m cell.
  assert.equal(plane[0]?.radius, Math.fround(32 * Math.SQRT1_2));
});

test("plane fixture is deterministic", () => {
  assert.deepEqual(encodeSurfelBlock(splatsOf(OPTS)), encodeSurfelBlock(splatsOf(OPTS)));
  const digest = createHash("sha256").update(encodeSurfelBlock(splatsOf(OPTS))).digest("hex");
  assert.equal(digest, PLANE_16_SHA256);
});

test("plane fixture survives an encode/decode round trip", () => {
  const plane = splatsOf(OPTS);
  const bytes = encodeSurfelBlock(plane);
  assert.equal(bytes.byteLength, surfelBlockByteLength(256));
  expectSplatsClose(decodeSurfelBlock(bytes), plane);
});

test("plane fixture rejects invalid grid sizes", () => {
  assert.throws(() => generatePlane({ ...OPTS, gridSize: 0 }), RangeError);
  assert.throws(() => generatePlane({ ...OPTS, gridSize: 2.5 }), RangeError);
  assert.throws(() => generatePlane({ tileWidthMetres: 0 }), RangeError);
  assert.throws(() => generatePlane({ tileWidthMetres: Number.NaN }), RangeError);
});
