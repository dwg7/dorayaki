import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeSurfelTile } from "../demo/src/decode-tile.js";
import { DEMO_TILE, DEMO_UNKNOWN_TAG, buildDemoTile, demoTilePath } from "../demo/src/demo-tile.js";
import { multiplyMat4, tileToMercatorMatrix, transformPoint } from "../demo/src/tile-matrix.js";
import { generateBridge } from "../src/fixtures/bridge.js";
import { EXPERIMENTAL_SURFEL_FRAME_TAG, concatFrames, readFrames, wrapSurfelBlock } from "../src/mlt-frame.js";
import { encodeSurfelBlock } from "../src/surfel-block.js";

test("demo tile is an unknown frame followed by the bridge surfel frame", () => {
  const tile = buildDemoTile();
  assert.deepEqual(readFrames(tile).map((f) => f.tag), [DEMO_UNKNOWN_TAG, EXPERIMENTAL_SURFEL_FRAME_TAG]);
  assert.deepEqual(decodeSurfelTile(tile), generateBridge());
  assert.deepEqual(buildDemoTile(), tile);
  assert.equal(demoTilePath(), "demo/tiles/16/58211/25806.mlt");
});

test("decodeSurfelTile requires exactly one surfel frame", () => {
  const block = wrapSurfelBlock(encodeSurfelBlock([]));
  assert.throws(() => decodeSurfelTile(new Uint8Array()), /found 0/);
  assert.throws(() => decodeSurfelTile(concatFrames([block, block])), /found 2/);
});

test("tile-local corners map to the tile's Mercator corners", () => {
  const m = tileToMercatorMatrix(DEMO_TILE);
  const n = 2 ** DEMO_TILE.z;
  assert.deepEqual(transformPoint(m, 0, 0, 0), [DEMO_TILE.x / n, DEMO_TILE.y / n, 0, 1]);
  assert.deepEqual(transformPoint(m, 1, 1, 0), [(DEMO_TILE.x + 1) / n, (DEMO_TILE.y + 1) / n, 0, 1]);
});

test("z uses the same scale as x and y", () => {
  const m = tileToMercatorMatrix(DEMO_TILE);
  const [, , z] = transformPoint(m, 0, 0, 1);
  const [x1] = transformPoint(m, 1, 0, 0);
  const [x0] = transformPoint(m, 0, 0, 0);
  assert.equal(z, x1 - x0);
});

test("multiplyMat4 composes column-major matrices", () => {
  const identity = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const m = tileToMercatorMatrix(DEMO_TILE);
  assert.deepEqual(multiplyMat4(identity, m), m);
  assert.deepEqual(multiplyMat4(m, identity), m);
  const translate = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1);
  assert.deepEqual(transformPoint(multiplyMat4(translate, m), 0, 0, 0), [10 + DEMO_TILE.x / n16(), 20 + DEMO_TILE.y / n16(), 30, 1]);
});

function n16(): number {
  return 2 ** DEMO_TILE.z;
}
