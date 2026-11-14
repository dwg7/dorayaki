import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  BRIDGE_DECK_ROWS,
  BRIDGE_DECK_Z,
  BRIDGE_PIERS,
  BRIDGE_UNDERSIDE_Z,
  generateBridge as generateBridgeAt,
  generateBridgeParts as generateBridgePartsAt,
} from "../src/fixtures/bridge.js";
import { splatToSurfel, surfelToSplat } from "../src/splat.js";
import { decodeSurfelBlock, encodeSurfelBlock, surfelBlockByteLength, type Surfel } from "../src/surfel-block.js";
import { expectSplatsClose } from "./helpers.js";

/** Normals come back from a quantized rotation: snap each component to the nearest integer. */
const snap = (v: number): number => Math.round(v) + 0;

/**
 * Tests use a 128 m tile: maximum pitch 8 m. Each 16 m × 11 m pier face is
 * sampled in 3 columns × 2 rows (cells 5.33 m × 5.5 m), rows at 2.75 and 8.25 m.
 */
const WIDTH = 128;
const generateBridge = () => generateBridgeAt({ tileWidthMetres: WIDTH });
const generateBridgeParts = () => generateBridgePartsAt({ tileWidthMetres: WIDTH });

/**
 * SHA-256 of encodeSurfelBlock(generateBridge().map(surfelToSplat)) on a 128 m tile. If this changes, the
 * fixture or the wire format changed; update it deliberately.
 */
const BRIDGE_SHA256 = "fdde0c1998093173d6a282ffc5fc34fcb476a318fbef7771c11d49ba066979fc";

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

function roundTrip() {
  const original = generateBridge();
  const splats = original.map(surfelToSplat);
  const decodedSplats = decodeSurfelBlock(encodeSurfelBlock(splats));
  // The disc view of the decoded splats, with axis-aligned normals snapped.
  const decoded = decodedSplats.map(splatToSurfel).map((s) => ({ ...s, nx: snap(s.nx), ny: snap(s.ny), nz: snap(s.nz) }));
  return { original, splats, decodedSplats, decoded };
}

test("bridge has ground, deck, underside, and supports", () => {
  const parts = generateBridgeParts();
  assert.equal(parts.ground.length, 256);
  assert.equal(parts.deck.length, 64);
  assert.equal(parts.underside.length, 64);
  assert.equal(parts.supports.length, 48); // 2 piers × 4 faces × 3 columns × 2 rows
  assert.equal(generateBridge().length, 432);

  for (const s of parts.ground) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [0, 0, 0, 1]);
  for (const s of parts.deck) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [BRIDGE_DECK_Z, 0, 0, 1]);
  for (const s of parts.underside) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [BRIDGE_UNDERSIDE_Z, 0, 0, -1]);
  assert.ok(BRIDGE_UNDERSIDE_Z < BRIDGE_DECK_Z);
  // Heights are metres; radius is metric (half the diagonal of an 8 m cell).
  assert.deepEqual([BRIDGE_UNDERSIDE_Z, BRIDGE_DECK_Z], [11, 12]);
  for (const s of [...parts.ground, ...parts.deck, ...parts.underside]) {
    assert.equal(s.radius, Math.fround(Math.hypot(8, 8) / 2));
  }
  for (const s of parts.supports) assert.equal(s.radius, Math.fround(Math.hypot(16 / 3, 5.5) / 2));
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

test("bridge survives an encode/decode round trip, in order, within the quantization tolerances", () => {
  const { splats, decodedSplats } = roundTrip();
  assert.equal(encodeSurfelBlock(splats).byteLength, surfelBlockByteLength(432));
  expectSplatsClose(decodedSplats, splats);
});

test("bridge fixture is deterministic", () => {
  const bytes = encodeSurfelBlock(generateBridge().map(surfelToSplat));
  assert.deepEqual(bytes, encodeSurfelBlock(generateBridge().map(surfelToSplat)));
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
  // 2 piers × 4 faces × 3 positions per face, each with 2 heights.
  assert.equal(cols.size, 24);
  for (const stack of cols.values()) {
    assert.deepEqual(stack.map((s) => s.z), [2.75, 8.25]);
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

test("pier rows follow the tile width so vertical sampling matches horizontal", () => {
  const rows = (w: number) => [...new Set(generateBridgePartsAt({ tileWidthMetres: w }).supports.map((s) => s.z))];
  assert.deepEqual(rows(128), [2.75, 8.25]); // pitch 8 m
  assert.deepEqual(rows(1000), [5.5]); // pitch 62.5 m: one row
  assert.equal(rows(16).length, 11); // pitch 1 m
});

test("pier discs stay within (√5 - 1)/4 of the pitch of their faces", () => {
  const bound = ((Math.sqrt(5) - 1) / 4) * 8;
  for (const s of generateBridgeParts().supports) {
    assert.ok(s.z + s.radius <= BRIDGE_UNDERSIDE_Z + bound, `top ${s.z + s.radius}`);
    assert.ok(s.z - s.radius >= -bound, `bottom ${s.z - s.radius}`);
  }
});

test("bridge heights do not depend on the tile width", () => {
  for (const w of [64, 128, 1000]) {
    const { deck, underside } = generateBridgePartsAt({ tileWidthMetres: w });
    assert.ok(deck.every((s) => s.z === 12));
    assert.ok(underside.every((s) => s.z === 11));
  }
  assert.throws(() => generateBridgeAt({ tileWidthMetres: -1 }), RangeError);
});
