import assert from "node:assert/strict";
import { test } from "node:test";

import { tileUrl, tilesCovering } from "../demo/src/tilejson.js";
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
