import assert from "node:assert/strict";
import { test } from "node:test";

import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { TileFramer, exactTileUnits, fitAffine, applyAffine, planePointOfTileUnits, type TileFrame } from "../src/geodesy/tile-frame.js";
import { tileWidthMetres } from "../src/tile-geometry.js";

/** A small deterministic generator, so the points are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Kawazu, zone VIII: easting about 39 to 42 km, northing about -135 to -132 km.
const KAWAZU = { zone: 8, e: [39000, 42000], n: [-135000, -132000] } as const;
const points = (count: number, seed: number, box: { e: readonly number[]; n: readonly number[] } = KAWAZU) => {
  const r = rng(seed);
  return Array.from({ length: count }, () => ({ e: box.e[0]! + r() * (box.e[1]! - box.e[0]!), n: box.n[0]! + r() * (box.n[1]! - box.n[0]!) }));
};

test("the affine fit reproduces the exact conversion at its anchor and within 3 mm over 200 m", () => {
  const f = fitAffine(8, 17, 40200, -133950);
  const [u0, v0] = exactTileUnits(8, 17, 40200, -133950);
  assert.ok(Math.abs(f.u0 - u0) < 1e-12 && Math.abs(f.v0 - v0) < 1e-12);
  const w = tileWidthMetres({ z: 17, x: Math.floor(u0), y: Math.floor(v0) });
  for (const [de, dn] of [[100, 0], [0, 100], [-100, -100], [100, 100], [-150, 120]] as const) {
    const [ua, va] = applyAffine(f, 40200 + de, -133950 + dn);
    const [ue, ve] = exactTileUnits(8, 17, 40200 + de, -133950 + dn);
    assert.ok(Math.hypot((ua - ue) * w, (va - ve) * w) < 0.003, `${de},${dn}`);
  }
});

test("planePointOfTileUnits finds the plane point of a tile centre to better than a micrometre", () => {
  for (const [x, y] of [[116122, 52009], [116125, 52010], [116119, 52005]] as const) {
    const [e, n] = planePointOfTileUnits(8, 17, x + 0.5, y + 0.5);
    const [u, v] = exactTileUnits(8, 17, e, n);
    assert.ok(Math.abs(u - (x + 0.5)) * 250 < 1e-6 && Math.abs(v - (y + 0.5)) * 250 < 1e-6, `${x}/${y}`);
    assert.ok(e > KAWAZU.e[0] - 2000 && e < KAWAZU.e[1] + 2000 && n > KAWAZU.n[0] - 2000 && n < KAWAZU.n[1] + 2000, "inside the area around Kawazu");
  }
});

test("locate: the tile is the one the exact conversion gives and the position is within 5 mm of the exact one", () => {
  const framer = new TileFramer(8, 17);
  let worst = 0, mismatched = 0, nearEdge = 0;
  for (const p of points(3000, 1)) {
    const loc = framer.locate(p.e, p.n);
    const [u, v] = exactTileUnits(8, 17, p.e, p.n);
    const w = loc.widthMetres;
    assert.equal(w, tileWidthMetres({ z: 17, x: loc.x, y: loc.y }));
    assert.ok(loc.east >= 0 && loc.east < w && loc.south >= 0 && loc.south < w);
    if (loc.x !== Math.floor(u) || loc.y !== Math.floor(v)) {
      // Only within a few millimetres of an edge may the two disagree about the tile.
      mismatched++;
      const edge = Math.min(u - Math.floor(u), Math.ceil(u) - u, v - Math.floor(v), Math.ceil(v) - v) * w;
      assert.ok(edge < 0.01, `tile mismatch ${edge} m from an edge`);
      continue;
    }
    if (Math.min(u - Math.floor(u), 1 - (u - Math.floor(u)), v - Math.floor(v), 1 - (v - Math.floor(v))) * w < 0.01) nearEdge++;
    worst = Math.max(worst, Math.hypot(loc.east - (u - loc.x) * w, loc.south - (v - loc.y) * w));
  }
  assert.ok(worst < 0.005, `worst error ${worst} m`);
  assert.ok(mismatched <= 3, `${mismatched} points disagreed about their tile`);
  void nearEdge;
});

test("the same point in the frames of the tile on each side of an edge differs by millimetres: no gap, no overlap", () => {
  const framer = new TileFramer(8, 17);
  const a = framer.frameOf(116122, 52009), b = framer.frameOf(116123, 52009); // east neighbours
  for (let i = 0; i < 50; i++) {
    const [e, n] = planePointOfTileUnits(8, 17, 116123 + 1e-9, 52009.1 + i * 0.016);
    const [ua, va] = applyAffine(a.affine, e, n), [ub, vb] = applyAffine(b.affine, e, n);
    assert.ok(Math.hypot((ua - ub) * a.widthMetres, (va - vb) * a.widthMetres) < 0.005, `edge point ${i}`);
  }
});

test("every point is assigned to exactly one tile, also along an edge, and the result does not depend on the order of the points", () => {
  const [e0, n0] = planePointOfTileUnits(8, 17, 116123, 52009.5); // the middle of the west edge of tile 116123
  const edgePoints = Array.from({ length: 400 }, (_, i) => ({ e: e0 + (i - 200) * 0.0005, n: n0 + (i % 40) * 0.5 }));
  const forward = new TileFramer(8, 17), backward = new TileFramer(8, 17);
  const a = edgePoints.map((p) => forward.locate(p.e, p.n));
  const b = edgePoints.slice().reverse().map((p) => backward.locate(p.e, p.n)).reverse();
  assert.deepEqual(a, b, "a framer that has seen the points in another order gives the same locations");
  assert.ok(new Set(a.map((l) => l.x)).size === 2, "the points of an edge fall in the two tiles on its sides");
  assert.ok(a.every((l) => l.east >= 0 && l.east < l.widthMetres && l.south >= 0 && l.south < l.widthMetres));
});

test("a point that its frame puts outside the tile after three steps is clamped into the last tile, never lost", () => {
  // A framer whose frame of every tile puts every point half a tile west of that tile moves the point one tile west at every step and never finds it inside.
  class Shifted extends TileFramer {
    protected override tileFrame(x: number, y: number): TileFrame {
      const f = super.tileFrame(x, y);
      return { ...f, affine: { ...f.affine, ue: 0, un: 0, u0: x - 0.5 } };
    }
  }
  const loc = new Shifted(8, 17).locate(40200, -133950);
  assert.equal(loc.clamped, true);
  assert.ok(loc.east >= 0 && loc.east < loc.widthMetres && loc.south >= 0 && loc.south < loc.widthMetres);
  assert.equal(new TileFramer(8, 17).locate(40200, -133950).clamped, false);
});

test("other zoom and zone: z15 is the parent of z17 and agrees in metres; zone XII and a point at the zone origin", () => {
  const f17 = new TileFramer(8, 17), f15 = new TileFramer(8, 15);
  for (const p of points(300, 7)) {
    const a = f17.locate(p.e, p.n), b = f15.locate(p.e, p.n);
    const [u, v] = exactTileUnits(8, 17, p.e, p.n);
    const near = Math.min(u % 4, 4 - (u % 4), v % 4, 4 - (v % 4)) * a.widthMetres; // distance to a z15 tile edge, metres
    if (near < 0.05) continue;
    assert.equal(b.x, a.x >> 2); assert.equal(b.y, a.y >> 2);
    const eastInParent = ((a.x & 3) + a.east / a.widthMetres) * (b.widthMetres / 4), southInParent = ((a.y & 3) + a.south / a.widthMetres) * (b.widthMetres / 4);
    // A z15 tile is 1 km wide, so its affine frame is centimetres off at its corners (the error grows with the square of the width); z17 is millimetres.
    assert.ok(Math.hypot(b.east - eastInParent, b.south - southInParent) < 0.05, `z15 against z17: ${Math.hypot(b.east - eastInParent, b.south - southInParent)} m`);
  }
  // Zone XII (Hokkaido): the zone origin is 44 N, 142.25 E.
  const f12 = new TileFramer(12, 17);
  const loc = f12.locate(0, 0);
  const g = jprcsToLatLng(12, 0, 0);
  assert.ok(Math.abs(g.lat - 44) < 1e-6 && Math.abs(g.lng - 142.25) < 1e-6);
  const [u, v] = exactTileUnits(12, 17, 0, 0);
  assert.equal(loc.x, Math.floor(u)); assert.equal(loc.y, Math.floor(v));
  assert.ok(Math.hypot(loc.east - (u - loc.x) * loc.widthMetres, loc.south - (v - loc.y) * loc.widthMetres) < 0.005);
});

test("the present flat frame around a mesh centre is hundreds of millimetres off; the tile frame is millimetres off (the reason for the frame)", () => {
  // The flat frame places east/north metres around a centre as if grid north were true north.
  const framer = new TileFramer(8, 17);
  const centre = { e: 40200, n: -133950 };
  const gc = jprcsToLatLng(8, centre.n, centre.e);
  const [uc, vc] = exactTileUnits(8, 17, centre.e, centre.n);
  const w = tileWidthMetres({ z: 17, x: Math.floor(uc), y: Math.floor(vc) });
  const perMetre = 1 / w;
  void gc;
  let flatWorst = 0, tileWorst = 0;
  for (const p of points(500, 3, { e: [40000, 40400], n: [-134100, -133800] })) {
    const [ue, ve] = exactTileUnits(8, 17, p.e, p.n);
    const flat = Math.hypot((uc + (p.e - centre.e) * perMetre - ue) * w, (vc - (p.n - centre.n) * perMetre - ve) * w);
    const loc = framer.locate(p.e, p.n);
    const tile = Math.hypot(loc.east - (ue - loc.x) * loc.widthMetres, loc.south - (ve - loc.y) * loc.widthMetres);
    flatWorst = Math.max(flatWorst, flat); tileWorst = Math.max(tileWorst, tile);
  }
  assert.ok(flatWorst > 0.5, `flat frame worst ${flatWorst} m`);
  assert.ok(tileWorst < 0.005, `tile frame worst ${tileWorst} m`);
});

test("constructor and conversion refuse an unknown zone or a silly zoom", () => {
  assert.throws(() => new TileFramer(20, 17), RangeError);
  assert.throws(() => new TileFramer(8, 30), RangeError);
  assert.throws(() => new TileFramer(8, 1.5), RangeError);
});
