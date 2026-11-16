import assert from "node:assert/strict";
import { test } from "node:test";

import type { View } from "../demo/src/camera.js";
import { selectMixedTiles } from "../demo/src/mixed-selection.js";
import { tileLatitude, tileLongitude, type TileAddress } from "../src/tile-geometry.js";

/** A pyramid over four z15 tiles near Kawazu: z15 (4), z16 (16), z17 (64), all present. */
function pyramid(): TileAddress[] {
  const out: TileAddress[] = [];
  for (const z of [15, 16, 17]) {
    const k = 2 ** (z - 15);
    for (let x = 29030 * k; x < 29032 * k; x++) for (let y = 13001 * k; y < 13003 * k; y++) out.push({ z, x, y });
  }
  return out;
}
const all = pyramid();
const key = (t: TileAddress) => `${t.z}/${t.x}/${t.y}`;
const centreOf = (t: TileAddress) => [tileLongitude(t, 0.5), tileLatitude(t, 0.5)] as const;
const [lng, lat] = centreOf({ z: 15, x: 29031, y: 13002 });
const bounds: [number, number, number, number] = [tileLongitude({ z: 15, x: 29030, y: 13002 }, 0), tileLatitude({ z: 15, x: 29030, y: 13002 }, 1), tileLongitude({ z: 15, x: 29031, y: 13002 }, 1), tileLatitude({ z: 15, x: 29030, y: 13001 }, 0)];
const view = (over: Partial<View>): View => ({ lng, lat, zoom: 17.5, bearing: 0, pitch: 0, width: 800, height: 800, centreZ: 200, ...over });
const isAncestor = (a: TileAddress, b: TileAddress) => a.z < b.z && Math.floor(b.x / 2 ** (b.z - a.z)) === a.x && Math.floor(b.y / 2 ** (b.z - a.z)) === a.y;
const noOverlap = (tiles: TileAddress[]) => tiles.every((a) => tiles.every((b) => !isAncestor(a, b)));

test("a top-down view at zoom 17.5 draws only the finest tiles", () => {
  const t = selectMixedTiles(all, bounds, view({}), { limit: 200 });
  assert.ok(t.length > 0 && t.every((x) => x.z === 17), t.map(key).join(" "));
});

test("a view at zoom 14 draws only the coarsest tiles", () => {
  const t = selectMixedTiles(all, bounds, view({ zoom: 14 }), { limit: 200 });
  assert.ok(t.length > 0 && t.every((x) => x.z === 15));
});

test("a steeply tilted view mixes zooms: fine near the camera, coarse far away, no tile covering another", () => {
  const t = selectMixedTiles(all, bounds, view({ zoom: 16.8, pitch: 80, bearing: 0 }), { limit: 200 });
  const zs = new Set(t.map((x) => x.z));
  assert.ok(zs.size >= 2, `zooms ${[...zs].join(",")}`);
  assert.ok(noOverlap(t));
  // The camera looks north: the tiles nearest the camera (south) are the finest.
  const southmost = t.reduce((a, b) => (centreOf(a)[1] < centreOf(b)[1] ? a : b));
  const northmost = t.reduce((a, b) => (centreOf(a)[1] > centreOf(b)[1] ? a : b));
  assert.ok(southmost.z >= northmost.z, `south z${southmost.z}, north z${northmost.z}`);
});

test("a tile is kept when any of the finer tiles replacing it is missing", () => {
  const missing = key({ z: 17, x: 116122, y: 52010 });
  const partial = all.filter((x) => key(x) !== missing);
  const t = selectMixedTiles(partial, bounds, view({}), { limit: 200 });
  assert.ok(noOverlap(t));
  assert.ok(t.some((x) => x.z === 16), "the parent of the missing tile stays");
  assert.ok(!t.some((x) => key(x) === missing));
});

test("the limit keeps the tiles nearest the centre, and maxZoom stops at a coarser zoom", () => {
  const few = selectMixedTiles(all, bounds, view({}), { limit: 3 });
  assert.equal(few.length, 3);
  const coarse = selectMixedTiles(all, bounds, view({}), { limit: 200, maxZoom: 16 });
  assert.ok(coarse.length > 0 && coarse.every((x) => x.z <= 16));
});

test("only tiles that intersect the bounds are chosen", () => {
  const small: [number, number, number, number] = [lng - 0.0001, lat - 0.0001, lng + 0.0001, lat + 0.0001];
  const t = selectMixedTiles(all, small, view({}), { limit: 200 });
  assert.ok(t.length >= 1 && t.length <= 4);
});

test("no candidates gives no tiles", () => {
  assert.deepEqual(selectMixedTiles([], bounds, view({}), { limit: 9 }), []);
});

import { visibleBounds } from "../demo/src/camera.js";

test("visibleBounds: a top-down view sees about the screen's ground area; a tilted view sees farther ahead than behind", () => {
  const top = visibleBounds(view({ zoom: 17, pitch: 0, bearing: 0 }));
  const widthM = (top[2] - top[0]) / 360 * 40075016.7 * Math.cos((lat * Math.PI) / 180);
  // 800 px at zoom 17 is 800 / (512 * 2^17 / (C cos lat)) metres, about 392 m.
  assert.ok(widthM > 350 && widthM < 430, `width ${widthM}`);
  const tilted = visibleBounds(view({ zoom: 17, pitch: 75, bearing: 0 }));
  assert.ok(tilted[3] - lat > lat - tilted[1], "more ground to the north (ahead) than to the south");
  assert.ok(tilted[3] > top[3]);
});
