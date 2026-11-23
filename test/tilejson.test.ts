import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_TILES, loadTileJson, tileUrl, tilesCovering } from "../demo/src/tilejson.js";
import { tileLatitude, tileLongitude } from "../src/tile-geometry.js";

test("tilesCovering lists the tiles intersecting a bounding box", () => {
  const t = { z: 20, x: 928618, y: 414860 };
  // A box well inside one tile.
  const inside = [tileLongitude(t, 0.4), tileLatitude(t, 0.6), tileLongitude(t, 0.6), tileLatitude(t, 0.4)] as const;
  assert.deepEqual(tilesCovering(inside, 20), [t]);
  // A box straddling the southern edge covers the tile and its southern neighbour.
  const straddle = [tileLongitude(t, 0.4), tileLatitude(t, 1.2), tileLongitude(t, 0.6), tileLatitude(t, 0.8)] as const;
  assert.deepEqual(tilesCovering(straddle, 20), [t, { z: 20, x: 928618, y: 414861 }]);
  // The same box at zoom 18 falls in one tile.
  assert.equal(tilesCovering(straddle, 18).length, 1);
});

test("bounds ending exactly on tile edges do not pull in neighbours", () => {
  const a = { z: 20, x: 928618, y: 414860 };
  const exact = [tileLongitude(a, 0), tileLatitude(a, 2), tileLongitude(a, 1), tileLatitude(a, 0)] as const; // 1 × 2 tiles
  assert.deepEqual(tilesCovering(exact, 20), [a, { z: 20, x: 928618, y: 414861 }]);
});

test("tileUrl fills the z/x/y placeholders", () => {
  assert.equal(tileUrl("https://stars.optgeo.org/dorayaki-numazu/{z}/{x}/{y}", { z: 18, x: 1, y: 2 }), "https://stars.optgeo.org/dorayaki-numazu/18/1/2");
});

/** `loadTileJson` with `fetch` answering one TileJSON. */
async function listed(tj: object): Promise<number> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(tj), { status: 200 })) as typeof fetch;
  try {
    return (await loadTileJson("https://example.test/tj.json", "https://example.test/")).tiles.length;
  } finally {
    globalThis.fetch = original;
  }
}

test("an area of several square kilometres (Sasebo, 164 tiles over z15 to z17) is listed", async () => {
  const n = await listed({ tiles: ["https://example.test/{z}/{x}/{y}"], bounds: [129.7071, 33.1630, 129.7368, 33.1873], minzoom: 15, maxzoom: 17 });
  assert.ok(n > 64 && n < MAX_TILES, `${n} tiles`);
});

test("bounds that would list more than MAX_TILES are refused", async () => {
  await assert.rejects(listed({ tiles: ["https://example.test/{z}/{x}/{y}"], bounds: [128, 32, 131, 35], minzoom: 15, maxzoom: 17 }), /exceed the demo's limit/);
});
