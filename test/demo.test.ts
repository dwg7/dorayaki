import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeSurfelTile } from "../demo/src/decode-tile.js";
import { DEMO_TILE, DEMO_UNKNOWN_TAG, buildDemoTiles, demoTilePath, demoTileSplats, isDemoTileset, tilesetTiles } from "../demo/src/demo-tile.js";
import { metricToMercatorMatrix, multiplyMat4, transformPoint } from "../demo/src/tile-matrix.js";
import { generateBridge } from "../src/fixtures/bridge.js";
import { generateOverhang } from "../src/fixtures/overhang.js";
import { EXPERIMENTAL_SURFEL_FRAME_TAG, concatFrames, readFrames, wrapSurfelBlock } from "../src/mlt-frame.js";
import { surfelToSplat } from "../src/splat.js";
import { encodeSurfelBlock } from "../src/surfel-block.js";
import { tileWidthMetres } from "../src/tile-geometry.js";
import { expectSplatsClose } from "./helpers.js";

const W = tileWidthMetres(DEMO_TILE);

test("demo tiles are an unknown frame followed by the fixture's surfel frame", () => {
  const cases = [
    ["bridge", generateBridge({ tileWidthMetres: W }).map(surfelToSplat)],
    ["overhang", generateOverhang({ tileWidthMetres: W }).map(surfelToSplat)],
  ] as const;
  for (const [tileset, surfels] of cases) {
    const [only, ...rest] = buildDemoTiles(tileset);
    assert.equal(rest.length, 0);
    const tile = (only as { bytes: Uint8Array }).bytes;
    assert.deepEqual(readFrames(tile).map((f) => f.tag), [DEMO_UNKNOWN_TAG, EXPERIMENTAL_SURFEL_FRAME_TAG]);
    expectSplatsClose(decodeSurfelTile(tile), surfels);
    assert.deepEqual(buildDemoTiles(tileset)[0]?.bytes, tile);
    assert.equal(demoTilePath(tileset, DEMO_TILE), `demo/tiles/${tileset}/18/234000/96256.mlt`);
  }
  assert.ok(isDemoTileset("overhang"));
  assert.ok(!isDemoTileset("../etc"));
});

test("the boundary tileset is a 2 × 2 block whose tiles decode to the split fixture", () => {
  const tiles = tilesetTiles("boundary");
  assert.deepEqual(tiles, [
    { z: 18, x: 234000, y: 96256 },
    { z: 18, x: 234001, y: 96256 },
    { z: 18, x: 234000, y: 96257 },
    { z: 18, x: 234001, y: 96257 },
  ]);
  const expected = demoTileSplats("boundary");
  const built = buildDemoTiles("boundary");
  assert.deepEqual(built.map((b) => b.tile), tiles);
  built.forEach((b, n) => expectSplatsClose(decodeSurfelTile(b.bytes), expected[n]!.surfels));
  assert.ok(expected.every((t) => t.surfels.length > 0));
});

test("the toy-gs tileset covers the tiles its Gaussians fall in", () => {
  const tiles = tilesetTiles("toy-gs");
  assert.ok(tiles.length >= 1);
  const built = buildDemoTiles("toy-gs");
  const total = built.reduce((n, b) => n + decodeSurfelTile(b.bytes).length, 0);
  assert.equal(total, 400 + 50 + 27);
});

test("decodeSurfelTile requires exactly one surfel frame", () => {
  const block = wrapSurfelBlock(encodeSurfelBlock([]));
  assert.throws(() => decodeSurfelTile(new Uint8Array()), /found 0/);
  assert.throws(() => decodeSurfelTile(concatFrames([block, block])), /found 2/);
});

test("metric frame corners map to the tile's Mercator corners", () => {
  const m = metricToMercatorMatrix(DEMO_TILE);
  const n = 2 ** DEMO_TILE.z;
  assert.deepEqual(transformPoint(m, 0, 0, 0), [DEMO_TILE.x / n, DEMO_TILE.y / n, 0, 1]);
  const [x, y, z, w] = transformPoint(m, W, W, 0);
  assert.ok(Math.abs(x - (DEMO_TILE.x + 1) / n) < 1e-15);
  assert.ok(Math.abs(y - (DEMO_TILE.y + 1) / n) < 1e-15);
  assert.deepEqual([z, w], [0, 1]);
});

test("one metre up equals one metre east in Mercator units", () => {
  const m = metricToMercatorMatrix(DEMO_TILE);
  const [, , z] = transformPoint(m, 0, 0, 1);
  const [x1] = transformPoint(m, 1, 0, 0);
  const [x0] = transformPoint(m, 0, 0, 0);
  // x1 - x0 loses ~1e-16 absolute to cancellation near 0.89; compare relatively.
  assert.ok(Math.abs(z - (x1 - x0)) / z < 1e-6);
  assert.equal(z, 1 / (W * 2 ** DEMO_TILE.z));
});

test("multiplyMat4 composes column-major matrices", () => {
  const identity = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const m = metricToMercatorMatrix(DEMO_TILE);
  assert.deepEqual(multiplyMat4(identity, m), m);
  assert.deepEqual(multiplyMat4(m, identity), m);
  const translate = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1);
  assert.deepEqual(transformPoint(multiplyMat4(translate, m), 0, 0, 0), [10 + DEMO_TILE.x / n16(), 20 + DEMO_TILE.y / n16(), 30, 1]);
});

function n16(): number {
  return 2 ** DEMO_TILE.z;
}
