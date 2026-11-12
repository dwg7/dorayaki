import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { generatePlane } from "../src/fixtures/plane.js";
import { decodeSurfelBlock, encodeSurfelBlock, surfelBlockByteLength } from "../src/surfel-block.js";

/**
 * SHA-256 of encodeSurfelBlock(generatePlane(OPTS)): default 16 × 16 grid
 * on a 128 m tile. If this changes, the fixture or the wire format changed; update it
 * deliberately and say so in the commit.
 */
const PLANE_16_SHA256 = "e7fe148dfa6c19383f822c5ed3a8558b3b89ac9761be185a73ba3c088f55f369";
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
  assert.deepEqual(encodeSurfelBlock(generatePlane(OPTS)), encodeSurfelBlock(generatePlane(OPTS)));
  const digest = createHash("sha256").update(encodeSurfelBlock(generatePlane(OPTS))).digest("hex");
  assert.equal(digest, PLANE_16_SHA256);
});

test("plane fixture survives an encode/decode round trip", () => {
  const plane = generatePlane(OPTS);
  const bytes = encodeSurfelBlock(plane);
  assert.equal(bytes.byteLength, surfelBlockByteLength(256));
  assert.deepEqual(decodeSurfelBlock(bytes), plane);
});

test("plane fixture rejects invalid grid sizes", () => {
  assert.throws(() => generatePlane({ ...OPTS, gridSize: 0 }), RangeError);
  assert.throws(() => generatePlane({ ...OPTS, gridSize: 2.5 }), RangeError);
  assert.throws(() => generatePlane({ tileWidthMetres: 0 }), RangeError);
  assert.throws(() => generatePlane({ tileWidthMetres: Number.NaN }), RangeError);
});
