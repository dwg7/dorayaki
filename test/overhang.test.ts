import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  OVERHANG_LIP_Y,
  OVERHANG_ROWS,
  OVERHANG_TOP_Z,
  OVERHANG_UNDERSIDE_Z,
  OVERHANG_WALL_Y,
  generateOverhang as generateOverhangAt,
  generateOverhangParts as generateOverhangPartsAt,
} from "../src/fixtures/overhang.js";
import { decodeSurfelBlock, encodeSurfelBlock, surfelBlockByteLength, type Surfel } from "../src/surfel-block.js";

/** Tests use a 128 m tile: pitch 8 m, so each 8 m face gets one row. */
const WIDTH = 128;
const generateOverhang = () => generateOverhangAt({ tileWidthMetres: WIDTH });
const generateOverhangParts = () => generateOverhangPartsAt({ tileWidthMetres: WIDTH });

/**
 * SHA-256 of encodeSurfelBlock(generateOverhang()) on a 128 m tile. If this
 * changes, the fixture or the wire format changed; update it deliberately.
 */
const OVERHANG_SHA256 = "4441e324c2a1ca40254e85c54485b46eb2f1eef000932d641efec19ffec199ea";

const centre = (k: number): number => (k + 0.5) / 16;

function columns(surfels: readonly Surfel[]): Map<string, Surfel[]> {
  const map = new Map<string, Surfel[]>();
  for (const s of surfels) {
    const key = `${s.x},${s.y}`;
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  for (const list of map.values()) list.sort((a, b) => a.z - b.z);
  return map;
}

const roundTrip = (): Surfel[] => decodeSurfelBlock(encodeSurfelBlock(generateOverhang()));

test("overhang has top, lip, underside, back wall, and ground", () => {
  const p = generateOverhangParts();
  assert.deepEqual(
    [p.top.length, p.lip.length, p.underside.length, p.wall.length, p.ground.length],
    [160, 16, 64, 16, 160],
  );
  assert.equal(generateOverhang().length, 416);

  for (const s of p.top) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [OVERHANG_TOP_Z, 0, 0, 1]);
  for (const s of p.underside) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [OVERHANG_UNDERSIDE_Z, 0, 0, -1]);
  for (const s of p.ground) assert.deepEqual([s.z, s.nx, s.ny, s.nz], [0, 0, 0, 1]);
  for (const s of p.lip) assert.deepEqual([s.y, s.nx, s.ny, s.nz], [OVERHANG_LIP_Y, 0, 1, 0]);
  for (const s of p.wall) assert.deepEqual([s.y, s.nx, s.ny, s.nz], [OVERHANG_WALL_Y, 0, 1, 0]);
  assert.deepEqual([OVERHANG_UNDERSIDE_Z, OVERHANG_TOP_Z], [8, 16]);
});

test("vertical faces span their height ranges", () => {
  const { lip, wall } = generateOverhangParts();
  for (const s of lip) assert.ok(s.z > OVERHANG_UNDERSIDE_Z && s.z < OVERHANG_TOP_Z);
  for (const s of wall) assert.ok(s.z > 0 && s.z < OVERHANG_UNDERSIDE_Z);
  // The lip stands directly above the overhang's outer edge, the wall below its inner edge.
  assert.ok(OVERHANG_WALL_Y < OVERHANG_LIP_Y);
});

test("overhang survives an encode/decode round trip, in order", () => {
  const original = generateOverhang();
  const bytes = encodeSurfelBlock(original);
  assert.equal(bytes.byteLength, surfelBlockByteLength(416));
  assert.deepEqual(decodeSurfelBlock(bytes), original);
});

test("overhang fixture is deterministic", () => {
  const bytes = encodeSurfelBlock(generateOverhang());
  assert.deepEqual(bytes, encodeSurfelBlock(generateOverhang()));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), OVERHANG_SHA256);
});

test("under the overhang, decoded columns hold ground, underside, and top", () => {
  const cols = columns(roundTrip());
  for (const j of OVERHANG_ROWS) {
    for (let i = 0; i < 16; i++) {
      const stack = cols.get(`${centre(i)},${centre(j)}`);
      assert.deepEqual(
        stack?.map((s) => [s.z, s.nz]),
        [[0, 1], [OVERHANG_UNDERSIDE_Z, -1], [OVERHANG_TOP_Z, 1]],
        `column i=${i} j=${j}`,
      );
    }
  }
});

test("a downward-facing surface lies between two upward-facing ones (not a height field)", () => {
  const stack = columns(roundTrip()).get(`${centre(0)},${centre(OVERHANG_ROWS[0])}`) ?? [];
  const facing = stack.map((s) => Math.sign(s.nz));
  assert.deepEqual(facing, [1, -1, 1]);
});

test("behind the wall only the top remains; in front of the lip only the ground", () => {
  const cols = columns(roundTrip());
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 6; j++) assert.deepEqual(cols.get(`${centre(i)},${centre(j)}`)?.map((s) => s.z), [16]);
    for (let j = 10; j < 16; j++) assert.deepEqual(cols.get(`${centre(i)},${centre(j)}`)?.map((s) => s.z), [0]);
  }
});

test("face rows follow the tile width; heights do not", () => {
  const rows = (w: number, part: "lip" | "wall") =>
    [...new Set(generateOverhangPartsAt({ tileWidthMetres: w })[part].map((s) => s.z))];
  assert.deepEqual(rows(128, "lip"), [12]); // pitch 8 m: one row
  assert.deepEqual(rows(64, "lip"), [10, 14]); // pitch 4 m: two rows
  assert.deepEqual(rows(64, "wall"), [2, 6]);
  assert.deepEqual(rows(124.17563859464565, "lip"), [10, 14]); // 8 m face fits 2 rows of 4 m
  for (const w of [64, 124.17563859464565, 1000]) {
    const p = generateOverhangPartsAt({ tileWidthMetres: w });
    assert.ok(p.top.every((s) => s.z === 16));
    assert.ok(p.underside.every((s) => s.z === 8));
  }
  assert.throws(() => generateOverhangAt({ tileWidthMetres: 0 }), RangeError);
});

test("on a 124 m tile, the lip no longer hangs far below the underside", () => {
  const w = 124.17563859464565;
  const { lip, wall } = generateOverhangPartsAt({ tileWidthMetres: w });
  const lipBottom = Math.min(...lip.map((s) => s.z - s.radius));
  const wallTop = Math.max(...wall.map((s) => s.z + s.radius));
  // Old rule (radius P·√½ = 5.49 m): lip bottom 4.51 m, wall top 11.49 m.
  assert.ok(lipBottom > 7, `lip bottom ${lipBottom}`);
  assert.ok(wallTop < 9, `wall top ${wallTop}`);
});
