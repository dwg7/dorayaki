import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeSurfelTile } from "../demo/src/decode-tile.js";
import { DEMO_TILE, DEMO_UNKNOWN_TAG, buildDemoTile, demoTilePath } from "../demo/src/demo-tile.js";
import { metricToMercatorMatrix, multiplyMat4, transformPoint } from "../demo/src/tile-matrix.js";
import { generateBridge } from "../src/fixtures/bridge.js";
import { EXPERIMENTAL_SURFEL_FRAME_TAG, concatFrames, readFrames, wrapSurfelBlock } from "../src/mlt-frame.js";
import { encodeSurfelBlock } from "../src/surfel-block.js";
import { tileWidthMetres } from "../src/tile-geometry.js";

const W = tileWidthMetres(DEMO_TILE);

test("demo tile is an unknown frame followed by the bridge surfel frame", () => {
  const tile = buildDemoTile();
  assert.deepEqual(readFrames(tile).map((f) => f.tag), [DEMO_UNKNOWN_TAG, EXPERIMENTAL_SURFEL_FRAME_TAG]);
  assert.deepEqual(decodeSurfelTile(tile), generateBridge({ tileWidthMetres: W }));
  assert.deepEqual(buildDemoTile(), tile);
  assert.equal(demoTilePath(), "demo/tiles/18/232847/103226.mlt");
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
