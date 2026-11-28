import assert from "node:assert/strict";
import { test } from "node:test";

import { loadTileJson, tileUrl, tilesCovering, type TileSource } from "../demo/src/tilejson.js";
import { boundsIndex, listIndex, MAX_WITHIN } from "../demo/src/tile-index.js";
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
async function load(tj: object): Promise<TileSource> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(tj), { status: 200 })) as typeof fetch;
  try {
    return await loadTileJson("https://example.test/tj.json", "https://example.test/");
  } finally {
    globalThis.fetch = original;
  }
}

test("D25: a TileJSON becomes an index answered by view; Sasebo's bounds give the tiles a view asks for", async () => {
  const src = await load({ tiles: ["https://example.test/{z}/{x}/{y}"], bounds: [129.7071, 33.1630, 129.7368, 33.1873], minzoom: 15, maxzoom: 17 });
  assert.deepEqual(src.index.zooms, [15, 16, 17]);
  const listed = [15, 16, 17].flatMap((z) => tilesCovering(src.bounds, z));
  assert.equal([15, 16, 17].reduce((n, z) => n + src.index.within(src.bounds, z).length, 0), listed.length, "the whole bounds: the old list");
  assert.ok(listed.every((t) => src.index.has(t)));
  assert.equal(src.index.has({ z: 14, x: listed[0]!.x >> 1, y: listed[0]!.y >> 1 }), false, "outside the zoom range");
});

test("D25: bounds the size of a prefecture are accepted (no list), and a view outside them gets nothing", async () => {
  const src = await load({ tiles: ["https://example.test/{z}/{x}/{y}"], bounds: [128.5, 32.5, 130.5, 34.7], minzoom: 13, maxzoom: 17 });
  const view = [129.70, 33.16, 129.73, 33.19] as const;
  const z17 = src.index.within(view, 17);
  assert.ok(z17.length > 50 && z17.length < 400, `${z17.length} tiles`);
  assert.deepEqual(src.index.within([140, 35, 141, 36], 17), []);
});

test("D25: a tile the server says is missing is dropped from the index; exact lists stay exact; a runaway view is refused", () => {
  const index = boundsIndex([129.7, 33.16, 129.73, 33.19], 15, 17);
  const t = index.within([129.7, 33.16, 129.73, 33.19], 17)[0]!;
  assert.ok(index.has(t));
  index.markMissing(t);
  assert.equal(index.has(t), false);
  assert.equal(index.missing, 1);
  assert.ok(!index.within([129.7, 33.16, 129.73, 33.19], 17).some((u) => u.x === t.x && u.y === t.y));
  const list = listIndex([{ z: 17, x: 1, y: 2 }, { z: 16, x: 0, y: 1 }]);
  assert.deepEqual(list.zooms, [16, 17]);
  assert.equal(list.has({ z: 17, x: 1, y: 3 }), false);
  assert.throws(() => boundsIndex([-180, -85, 180, 85], 0, 17).within([-180, -85, 180, 85], 17), new RegExp(String(MAX_WITHIN)));
});
