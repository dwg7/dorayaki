import assert from "node:assert/strict";
import { test } from "node:test";

import { viewTiles } from "../demo/src/tile-view.js";
import { tileLatitude, tileLongitude } from "../src/tile-geometry.js";

const grid = (z: number, x0: number, y0: number, cols: number, rows: number) =>
  Array.from({ length: cols * rows }, (_, i) => ({ z, x: x0 + (i % cols), y: y0 + Math.floor(i / cols) }));

test("viewTiles keeps only tiles of the zoom that intersect the bounds", () => {
  const t17 = grid(17, 116121, 52009, 4, 3);
  const all = [...t17, ...grid(16, 58060, 26004, 2, 2)];
  // Bounds of exactly tile (116122, 52010).
  const t = { z: 17, x: 116122, y: 52010 };
  const bounds: [number, number, number, number] = [tileLongitude(t, 0), tileLatitude(t, 1), tileLongitude(t, 1), tileLatitude(t, 0)];
  assert.deepEqual(viewTiles(all, 17, bounds, 99), [t]); // neighbours touch the edge only: excluded
  assert.equal(viewTiles(all, 16, bounds, 99).length, 1);
  assert.deepEqual(viewTiles(all, 15, bounds, 99), []);
});

test("viewTiles orders by distance from the view centre and caps the count", () => {
  const t17 = grid(17, 116121, 52009, 4, 3);
  const a = { z: 17, x: 116121, y: 52009 }, b = { z: 17, x: 116124, y: 52011 };
  const bounds: [number, number, number, number] = [tileLongitude(a, 0), tileLatitude(b, 1), tileLongitude(b, 1), tileLatitude(a, 0)];
  assert.equal(viewTiles(t17, 17, bounds, 99).length, 12);
  const near = viewTiles(t17, 17, bounds, 4);
  assert.equal(near.length, 4);
  for (const t of near) assert.ok(t.x >= 116122 && t.x <= 116123, `tile ${t.x}/${t.y} is not central`);
});

test("viewTiles measures nearness from the given centre, not from the middle of the bounds", () => {
  // A tilted view: the bounds run far to the north, but the map looks at the southern row.
  const t17 = grid(17, 116121, 52005, 3, 7);
  const a = { z: 17, x: 116121, y: 52005 }, b = { z: 17, x: 116123, y: 52011 };
  const bounds: [number, number, number, number] = [tileLongitude(a, 0), tileLatitude(b, 1), tileLongitude(b, 1), tileLatitude(a, 0)];
  const looking = { z: 17, x: 116122, y: 52011 };
  const centre: [number, number] = [(tileLongitude(looking, 0) + tileLongitude(looking, 1)) / 2, (tileLatitude(looking, 0) + tileLatitude(looking, 1)) / 2];
  const byBounds = viewTiles(t17, 17, bounds, 3);
  const byCentre = viewTiles(t17, 17, bounds, 3, centre);
  assert.ok(byBounds.every((t) => t.y <= 52009), "the middle of the bounds is in the north");
  assert.deepEqual(byCentre[0], looking);
  assert.ok(byCentre.every((t) => t.y >= 52010), "the tiles around the looked-at point are kept");
});
