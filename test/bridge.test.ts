import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  BRIDGE_DECK_ROWS,
  BRIDGE_DECK_Z,
  BRIDGE_PIERS,
  BRIDGE_UNDERSIDE_Z,
  generateBridge,
  generateBridgeParts,
} from "../src/fixtures/bridge.js";
import { decodeSurfelBlock, encodeSurfelBlock, surfelBlockByteLength, type Surfel } from "../src/surfel-block.js";

/**
 * SHA-256 of encodeSurfelBlock(generateBridge()). If this changes, the
 * fixture or the wire format changed; update it deliberately.
 */
const BRIDGE_SHA256 = "56dd3cec51e9558a52c83e583ef6a1a60d13ab36b9a752486181f96739c6612c";

const C = 1 / 16;
const centre = (k: number): number => (k + 0.5) * C;

/** Group surfels by exact (x, y); each group is sorted by z. */
function columns(surfels: readonly Surfel[]): Map<string, Surfel[]> {
  const map = new Map<string, Surfel[]>();
  for (const s of surfels) {
    const key = `${s.x},${s.y}`;
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.z - b.z);
  return map;
}

function roundTrip(): { original: Surfel[]; decoded: Surfel[] } {
  const original = generateBridge();
  return { original, decoded: decodeSurfelBlock(encodeSurfelBlock(original)) };
}

test("bridge has ground, deck, underside, and supports", () => {
  const parts = generateBridgeParts();
  assert.equal(parts.ground.length, 256);
  assert.equal(parts.deck.length, 64);
  assert.equal(parts.underside.length, 64);
  assert.equal(parts.supports.length, 64);
  assert.equal(generateBridge().length, 448);

  for (const s of parts.ground) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [0, 0, 0, 1]);
  for (const s of parts.deck) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [BRIDGE_DECK_Z, 0, 0, 1]);
  for (const s of parts.underside) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [BRIDGE_UNDERSIDE_Z, 0, 0, -1]);
  assert.ok(BRIDGE_UNDERSIDE_Z < BRIDGE_DECK_Z);
});

test("supports are vertical faces between ground and underside", () => {
  const { supports } = generateBridgeParts();
  const normals = new Set<string>();
  for (const s of supports) {
    assert.equal(s.nz, 0, "support normal must be horizontal");
    assert.equal(Math.hypot(s.nx, s.ny), 1);
    assert.ok(s.z > 0 && s.z < BRIDGE_UNDERSIDE_Z);
    const onPierFace = BRIDGE_PIERS.some(([x0, x1, y0, y1]) =>
      ((s.x === x0 || s.x === x1) && s.y > y0 && s.y < y1) ||
      ((s.y === y0 || s.y === y1) && s.x > x0 && s.x < x1));
    assert.ok(onPierFace, `support at (${s.x}, ${s.y}) is not on a pier face`);
    normals.add(`${s.nx},${s.ny}`);
  }
  assert.deepEqual([...normals].sort(), ["-1,0", "0,-1", "0,1", "1,0"]);
});

test("bridge survives an encode/decode round trip, in order", () => {
  const { original, decoded } = roundTrip();
  assert.equal(encodeSurfelBlock(original).byteLength, surfelBlockByteLength(448));
  assert.deepEqual(decoded, original);
});

test("bridge fixture is deterministic", () => {
  const bytes = encodeSurfelBlock(generateBridge());
  assert.deepEqual(bytes, encodeSurfelBlock(generateBridge()));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), BRIDGE_SHA256);
});

test("decoded block keeps ground, underside, and deck as distinct layers at one x/y", () => {
  const { decoded } = roundTrip();
  const x = centre(0);
  const y = centre(BRIDGE_DECK_ROWS[0]);
  const stack = decoded.filter((s) => s.x === x && s.y === y).sort((a, b) => a.z - b.z);
  assert.deepEqual(stack.map((s) => s.z), [0, BRIDGE_UNDERSIDE_Z, BRIDGE_DECK_Z]);
  assert.deepEqual(stack.map((s) => s.nz), [1, -1, 1]);
});

test("decoded block keeps three layers at every x/y under the deck", () => {
  const { decoded } = roundTrip();
  const cols = columns(decoded);
  for (const j of BRIDGE_DECK_ROWS) {
    for (let i = 0; i < 16; i++) {
      const stack = cols.get(`${centre(i)},${centre(j)}`);
      assert.ok(stack, `missing column at i=${i} j=${j}`);
      assert.deepEqual(stack.map((s) => [s.z, s.nz]), [[0, 1], [BRIDGE_UNDERSIDE_Z, -1], [BRIDGE_DECK_Z, 1]]);
    }
  }
});

test("decoded block keeps stacked support surfels at each pier face position", () => {
  const { decoded } = roundTrip();
  const cols = columns(decoded.filter((s) => s.nz === 0));
  // 2 piers × 4 faces × 2 positions per face, each with 4 heights.
  assert.equal(cols.size, 16);
  for (const stack of cols.values()) {
    assert.deepEqual(stack.map((s) => s.z), [1, 3, 5, 7].map((k) => k / 32));
  }
});

test("outside the deck and piers the bridge is a single ground layer", () => {
  const { decoded } = roundTrip();
  const cols = columns(decoded);
  for (let j = 0; j < 16; j++) {
    if ((BRIDGE_DECK_ROWS as readonly number[]).includes(j)) continue;
    for (let i = 0; i < 16; i++) {
      assert.deepEqual(cols.get(`${centre(i)},${centre(j)}`)?.map((s) => s.z), [0]);
    }
  }
});
