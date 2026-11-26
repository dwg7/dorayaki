import assert from "node:assert/strict";
import { test } from "node:test";

import type { View } from "../demo/src/camera.js";
import { selectBudgetedTiles, selectMixedTiles } from "../demo/src/mixed-selection.js";
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

// ---- selectBudgetedTiles (E024)
const MB = 1e6;
const prior = (z: number): number => (z >= 17 ? 1.5 * MB : 0.7 * MB);
const budget = (maxBytes: number, over: object = {}) => ({ maxBytes, maxSplats: 1e9, priorBytes: prior, ...over });
const cost = (tiles: TileAddress[]): number => tiles.reduce((n, t) => n + prior(t.z), 0);
const intersectsBounds = (t: TileAddress): boolean => !(tileLongitude(t, 1) <= bounds[0] || tileLongitude(t, 0) >= bounds[2] || tileLatitude(t, 0) <= bounds[1] || tileLatitude(t, 1) >= bounds[3]);

test("budget: a coarse tile with only some children (the data's edge) is still refined to the children that exist", () => {
  // Only the north-west z16 child of each z15 tile exists, with all of its z17 tiles.
  const edge = all.filter((x) => x.z === 15 || (x.z === 16 && x.x % 2 === 0 && x.y % 2 === 0) || (x.z === 17 && Math.floor(x.x / 2) % 2 === 0 && Math.floor(x.y / 2) % 2 === 0));
  const t = selectBudgetedTiles(edge, bounds, view({}), budget(1e12));
  assert.ok(t.length > 0 && t.every((x) => x.z === 17), t.map(key).join(" "));
});

test("budget: with room for everything it chooses what selectMixedTiles chooses", () => {
  const v = view({ zoom: 16.8, pitch: 80 });
  const plain = selectMixedTiles(all, bounds, v, { limit: 1000 }).map(key).sort();
  const b = selectBudgetedTiles(all, bounds, v, budget(1e12)).map(key).sort();
  assert.deepEqual(b, plain);
});

test("budget: a tiny budget still covers the whole view with the coarsest tiles", () => {
  const t = selectBudgetedTiles(all, bounds, view({}), budget(1));
  const coarse = all.filter((x) => x.z === 15 && intersectsBounds(x)).map(key).sort();
  assert.deepEqual(t.map(key).sort(), coarse);
});

test("budget: every coarse tile in view is covered by itself or by tiles under it, nothing overlaps, and the bytes stay within the budget", () => {
  const v = view({ zoom: 16.8, pitch: 80 });
  for (const limit of [3 * MB, 6 * MB, 12 * MB, 25 * MB]) {
    const t = selectBudgetedTiles(all, bounds, v, budget(limit));
    assert.ok(noOverlap(t));
    for (const c of all.filter((x) => x.z === 15 && intersectsBounds(x))) {
      assert.ok(t.some((x) => key(x) === key(c) || isAncestor(c, x)), `${key(c)} uncovered at ${limit}`);
    }
    const coarsest = cost(all.filter((x) => x.z === 15 && intersectsBounds(x)));
    assert.ok(cost(t) <= Math.max(limit, coarsest), `${cost(t)} > ${limit}`);
  }
});

test("budget: the refinements go to the nearest tiles first (a tilted view looking north)", () => {
  const v = view({ zoom: 16.8, pitch: 80, bearing: 0 });
  const t = selectBudgetedTiles(all, bounds, v, budget(8 * MB));
  const zs = new Set(t.map((x) => x.z));
  assert.ok(zs.size >= 2, `zooms ${[...zs].join(",")}`);
  const southmost = t.reduce((a, b) => (centreOf(a)[1] < centreOf(b)[1] ? a : b));
  const northmost = t.reduce((a, b) => (centreOf(a)[1] > centreOf(b)[1] ? a : b));
  assert.ok(southmost.z >= northmost.z);
});

test("budget: a tile known to be huge is not refined into bigger ones, and known sizes replace the guess", () => {
  const v = view({});
  const huge = new Set(all.filter((x) => x.z === 16).map(key));
  const t = selectBudgetedTiles(all, bounds, v, budget(20 * MB, { knownBytes: (x: TileAddress) => (huge.has(key(x)) ? 50 * MB : undefined) }));
  assert.ok(t.every((x) => x.z <= 15), "the z16 children are too big for the budget, so nothing is refined");
});

test("budget: maxZoom, a missing child and the splat limit are respected, and no candidates gives none", () => {
  const v = view({});
  assert.ok(selectBudgetedTiles(all, bounds, v, budget(1e12, { maxZoom: 16 })).every((x) => x.z <= 16));
  // A missing child (no points there) is left out; its siblings still replace the parent.
  const missing = key({ z: 17, x: 116122, y: 52010 });
  const t = selectBudgetedTiles(all.filter((x) => key(x) !== missing), bounds, v, budget(1e12));
  assert.ok(noOverlap(t) && !t.some((x) => key(x) === missing));
  assert.ok(t.some((x) => x.z === 17 && x.x === 116123 && x.y === 52010), "a sibling of the missing tile is drawn");
  assert.ok(!t.some((x) => x.z === 16 && x.x === 58061 && x.y === 26005), "its parent is not kept");
  const few = selectBudgetedTiles(all, bounds, v, { maxBytes: 1e12, maxSplats: 1, bytesPerSplat: 12, priorBytes: prior });
  assert.ok(few.every((x) => x.z === 15));
  assert.deepEqual(selectBudgetedTiles([], bounds, v, budget(1)), []);
});
