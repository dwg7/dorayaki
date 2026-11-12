import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { generatePlane } from "../src/fixtures/plane.js";
import { decodeSurfelBlock, encodeSurfelBlock, surfelBlockByteLength } from "../src/surfel-block.js";

/**
 * SHA-256 of encodeSurfelBlock(generatePlane()) with the default 16 × 16
 * grid. If this changes, the fixture or the wire format changed; update it
 * deliberately and say so in the commit.
 */
const PLANE_16_SHA256 = "20d4a7fbb710a328cacdd004e62df63c93ac6fc92f55ad430f3549f962d18331";

test("plane fixture has the expected shape", () => {
  const plane = generatePlane({ gridSize: 4 });
  assert.equal(plane.length, 16);
  for (const s of plane) {
    assert.equal(s.z, 0);
    assert.deepEqual([s.nx, s.ny, s.nz], [0, 0, 1]);
    assert.ok(s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1);
  }
  assert.deepEqual([plane[0]?.x, plane[0]?.y], [0.125, 0.125]);
  assert.deepEqual([plane[15]?.x, plane[15]?.y], [0.875, 0.875]);
});

test("plane fixture is deterministic", () => {
  assert.deepEqual(encodeSurfelBlock(generatePlane()), encodeSurfelBlock(generatePlane()));
  const digest = createHash("sha256").update(encodeSurfelBlock(generatePlane())).digest("hex");
  assert.equal(digest, PLANE_16_SHA256);
});

test("plane fixture survives an encode/decode round trip", () => {
  const plane = generatePlane();
  const bytes = encodeSurfelBlock(plane);
  assert.equal(bytes.byteLength, surfelBlockByteLength(256));
  assert.deepEqual(decodeSurfelBlock(bytes), plane);
});

test("plane fixture rejects invalid grid sizes", () => {
  assert.throws(() => generatePlane({ gridSize: 0 }), RangeError);
  assert.throws(() => generatePlane({ gridSize: 2.5 }), RangeError);
});
