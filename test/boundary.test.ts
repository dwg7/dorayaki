import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  BOUNDARY_COLS,
  BOUNDARY_FOOTPRINT,
  BOUNDARY_ROOF_Z,
  BOUNDARY_ROWS,
  generateBoundary as generateBoundaryAt,
  generateBoundaryParts as generateBoundaryPartsAt,
} from "../src/fixtures/boundary.js";
import { decodeSurfelBlock, encodeSurfelBlock } from "../src/surfel-block.js";
import { splitByTile } from "../src/tiling.js";

/** 128 m tiles: pitch 8 m; each 64 m × 20 m wall is 10 columns × 3 rows. */
const WIDTH = 128;
const generateBoundary = () => generateBoundaryAt({ tileWidthMetres: WIDTH });
const generateBoundaryParts = () => generateBoundaryPartsAt({ tileWidthMetres: WIDTH });
const BLOCK = { origin: { z: 18, x: 1000, y: 2000 }, cols: BOUNDARY_COLS, rows: BOUNDARY_ROWS };

/**
 * SHA-256 of the four tiles' encoded blocks, concatenated in blockTiles
 * order, on 128 m tiles. If this changes, the fixture, the ownership rule,
 * or the wire format changed; update it deliberately.
 */
const BOUNDARY_SHA256 = "c51725ffa7c541e3a063829c91dc7b66b2a01b0b2128eadd382e639eddb5d687";

const tiles = () => splitByTile(generateBoundary(), BLOCK);

test("boundary has ground, roof, and four walls", () => {
  const p = generateBoundaryParts();
  assert.deepEqual([p.ground.length, p.roof.length, p.walls.length], [960, 64, 120]);
  for (const s of p.roof) assert.deepEqual([s.z, s.nz], [BOUNDARY_ROOF_Z, 1]);
  for (const s of p.ground) assert.deepEqual([s.z, s.nz], [0, 1]);
  const normals = new Set(p.walls.map((s) => `${s.nx},${s.ny},${s.nz}`));
  assert.deepEqual([...normals].sort(), ["-1,0,0", "0,-1,0", "0,1,0", "1,0,0"]);
  for (const s of p.walls) assert.ok(s.z > 0 && s.z < BOUNDARY_ROOF_Z);
  // No ground under the building.
  const [lo, hi] = BOUNDARY_FOOTPRINT;
  assert.ok(p.ground.every((s) => !(s.x > lo && s.x < hi && s.y > lo && s.y < hi)));
});

test("the building crosses both seams: every tile holds roof and wall surfels", () => {
  for (const { tile, surfels } of tiles()) {
    const roof = surfels.filter((s) => s.z === BOUNDARY_ROOF_Z && s.nz === 1);
    const walls = surfels.filter((s) => s.nz === 0);
    assert.deepEqual([surfels.length, roof.length, walls.length], [286, 16, 30], `tile ${tile.x}/${tile.y}`);
  }
});

test("every tile-local centre is in [0, 1), and some discs reach across a seam", () => {
  let crossing = 0;
  for (const { surfels } of tiles()) {
    for (const s of surfels) {
      assert.ok(s.x >= 0 && s.x < 1 && s.y >= 0 && s.y < 1);
      const r = s.radius / WIDTH; // radius in tile units
      if (s.x - r < 0 || s.x + r > 1 || s.y - r < 0 || s.y + r > 1) crossing++;
    }
  }
  assert.ok(crossing > 0);
});

test("the four tiles together hold exactly the generated surfels", () => {
  const all = generateBoundary();
  const back = tiles().flatMap(({ tile, surfels }) =>
    surfels.map((s) => ({ ...s, x: s.x + (tile.x - BLOCK.origin.x), y: s.y + (tile.y - BLOCK.origin.y) })),
  );
  const key = (s: { x: number; y: number; z: number; nx: number; ny: number }) => `${s.x},${s.y},${s.z},${s.nx},${s.ny}`;
  assert.deepEqual(back.map(key).sort(), all.map(key).sort());
});

test("each tile survives an encode/decode round trip", () => {
  for (const { surfels } of tiles()) assert.deepEqual(decodeSurfelBlock(encodeSurfelBlock(surfels)), surfels);
});

test("ground grid continues across seams without restarting", () => {
  // Ground centres in block coordinates sit at (k + 0.5) / 16 on both axes, k = 0..31.
  const xs = [...new Set(generateBoundaryParts().ground.map((s) => s.x))].sort((a, b) => a - b);
  assert.deepEqual(xs, Array.from({ length: 32 }, (_, k) => (k + 0.5) / 16));
});

test("boundary tiles are deterministic", () => {
  const bytes = () => Buffer.concat(tiles().map(({ surfels }) => encodeSurfelBlock(surfels)));
  assert.deepEqual(bytes(), bytes());
  assert.equal(createHash("sha256").update(bytes()).digest("hex"), BOUNDARY_SHA256);
});
