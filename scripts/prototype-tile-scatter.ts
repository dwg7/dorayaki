/**
 * E022 prototype: the first two stages of a tile-aligned build, on one LAS file.
 *
 *   npm run prototype:tile-scatter -- <file.las> <zone> [maxpoints]
 *
 * Stage 1 (scatter): every point (plane rectangular easting/northing, height) is projected into the frame of the z17 tile it falls in:
 * metres from the tile's north-west corner, east and south, so that voxels can be cut on a grid that lines up with the tile
 * edges. The projection of a tile is an affine map from the plane coordinates, fitted from three exact conversions
 * (src/geodesy/jprcs.ts) at a plane point near the tile's centre. The script reports how accurate that is against the exact
 * conversion, how far the build's present way of placing points (a flat frame around the file's centre, no grid convergence) is
 * from the exact position, the throughput, and the points per tile.
 *
 * Stage 2 (one tile): the densest tile's points are accumulated on the tile-aligned grid (cell = tile width / 512) and merged with the
 * adaptive rule of the Kawazu recipe; the script reports the time and memory of one tile.
 */
import { closeSync, openSync, readSync } from "node:fs";

import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { adaptiveGaussians } from "../src/pointcloud/adaptive.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";
import { EARTH_CIRCUMFERENCE_METRES, tileWidthMetres } from "../src/tile-geometry.js";

const [file, zoneArg, maxArg] = process.argv.slice(2);
if (!file || !zoneArg) { console.error("usage: prototype-tile-scatter <file.las> <zone> [maxpoints]"); process.exit(1); }
const ZONE = Number(zoneArg);
const Z = 17;
const N = 2 ** Z;

/** Mercator tile units (x east, y south) of a latitude and longitude at zoom Z. */
const toTileUnits = (lat: number, lng: number): [number, number] => {
  const phi = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * N, ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * N];
};
const exactUnits = (e: number, n: number): [number, number] => { const g = jprcsToLatLng(ZONE, n, e); return toTileUnits(g.lat, g.lng); };

/** An affine map from plane coordinates (e, n) to tile units, fitted at (e0, n0) from three exact conversions 100 m apart. */
interface Frame { e0: number; n0: number; u0: number; v0: number; ue: number; un: number; ve: number; vn: number }
function fitFrame(e0: number, n0: number): Frame {
  const h = 100;
  const [u0, v0] = exactUnits(e0, n0), [ue, ve] = exactUnits(e0 + h, n0), [un, vn] = exactUnits(e0, n0 + h);
  return { e0, n0, u0, v0, ue: (ue - u0) / h, ve: (ve - v0) / h, un: (un - u0) / h, vn: (vn - v0) / h };
}
const apply = (f: Frame, e: number, n: number): [number, number] => [f.u0 + f.ue * (e - f.e0) + f.un * (n - f.n0), f.v0 + f.ve * (e - f.e0) + f.vn * (n - f.n0)];

// Coarse frames on a 1 km grid of the plane coordinates choose the tile; the tile's own frame (anchored near its centre) gives the position.
const coarse = new Map<string, Frame>();
const coarseFrame = (e: number, n: number): Frame => {
  const k = `${Math.floor(e / 1000)},${Math.floor(n / 1000)}`;
  let f = coarse.get(k);
  if (!f) coarse.set(k, (f = fitFrame((Math.floor(e / 1000) + 0.5) * 1000, (Math.floor(n / 1000) + 0.5) * 1000)));
  return f;
};
const tileFrames = new Map<string, { frame: Frame; widthM: number }>();
function tileFrame(tx: number, ty: number): { frame: Frame; widthM: number } {
  const k = `${tx},${ty}`;
  let t = tileFrames.get(k);
  if (!t) {
    // The plane point at the tile's centre, by inverting the coarse frame around it (two Newton steps with the exact conversion).
    const cu = tx + 0.5, cv = ty + 0.5;
    let f = coarseFrame(0, 0);
    // Start from a plane point guess: the coarse frame of the tile's neighbourhood is found by walking from the last one.
    let [e, n] = lastPlane;
    for (let i = 0; i < 4; i++) {
      f = fitFrame(e, n);
      const du = cu - f.u0, dv = cv - f.v0;
      const det = f.ue * f.vn - f.un * f.ve;
      e = f.e0 + (du * f.vn - dv * f.un) / det;
      n = f.n0 + (dv * f.ue - du * f.ve) / det;
    }
    f = fitFrame(e, n);
    t = { frame: f, widthM: tileWidthMetres({ z: Z, x: tx, y: ty }) };
    tileFrames.set(k, t);
  }
  return t;
}
let lastPlane: [number, number] = [0, 0];

const fd = openSync(file, "r");
const head = new Uint8Array(375); readSync(fd, head, 0, 375, 0);
const header = parseLasHeader(head);
const total = Math.min(header.count, maxArg ? Number(maxArg) : header.count);
const e0 = (header.min[0] + header.max[0]) / 2, n0 = (header.min[1] + header.max[1]) / 2;

// The build's present placement: a flat frame at the file's centre (east and north metres, no rotation), as placeGaussians does.
const oc = jprcsToLatLng(ZONE, n0, e0);
const lat0 = (oc.lat * Math.PI) / 180;
const [ou, ov] = toTileUnits(oc.lat, oc.lng);
const oldPerMetre = N / (EARTH_CIRCUMFERENCE_METRES * Math.cos(lat0));

const perTile = new Map<string, number>();
const points: Array<{ tile: string; x: number; y: number; z: number; r: number; g: number; b: number }> = [];
const keep = new Map<string, Array<[number, number, number, number, number, number]>>();
let errTile = 0, errTileMax = 0, errOld = 0, errOldMax = 0, sampled = 0, outside = 0;
const SAMPLE_EVERY = Math.max(1, Math.floor(total / 4000));
const CHUNK_RECORDS = Math.floor(64_000_000 / header.recordLength);
const buf = new Uint8Array(CHUNK_RECORDS * header.recordLength);
const t0 = performance.now();
let done = 0, index = 0;
while (done < total) {
  const n = Math.min(CHUNK_RECORDS, total - done);
  let got = 0; const want = n * header.recordLength;
  while (got < want) { const r = readSync(fd, buf, got, want - got, header.offsetToPoints + done * header.recordLength + got); if (r === 0) throw new Error("short file"); got += r; }
  forEachLasRecord(buf, header, n, (e, nn, z, _c, r, g, b) => {
    index++;
    lastPlane = [e, nn];
    // Choose the tile with the coarse frame, then take the position from the tile's own frame; step to a neighbour if it falls outside.
    let [u, v] = apply(coarseFrame(e, nn), e, nn);
    let tx = Math.floor(u), ty = Math.floor(v);
    let tf = tileFrame(tx, ty);
    let [uu, vv] = apply(tf.frame, e, nn);
    for (let guard = 0; guard < 3 && (uu < tx || uu >= tx + 1 || vv < ty || vv >= ty + 1); guard++) {
      tx = Math.floor(uu); ty = Math.floor(vv);
      tf = tileFrame(tx, ty);
      [uu, vv] = apply(tf.frame, e, nn);
    }
    if (uu < tx || uu >= tx + 1 || vv < ty || vv >= ty + 1) outside++;
    const key = `${tx},${ty}`;
    perTile.set(key, (perTile.get(key) ?? 0) + 1);
    const xm = (uu - tx) * tf.widthM, ym = (vv - ty) * tf.widthM;
    if (index % SAMPLE_EVERY === 0) {
      const [ue, ve] = exactUnits(e, nn);
      const dE = (uu - ue) * tf.widthM, dN = (vv - ve) * tf.widthM;
      const eT = Math.hypot(dE, dN); errTile += eT; errTileMax = Math.max(errTileMax, eT);
      // The present way: units from the file's centre, east/north metres scaled to tile units.
      const uo = ou + (e - e0) * oldPerMetre, vo = ov - (nn - n0) * oldPerMetre;
      const eO = Math.hypot((uo - ue) * tf.widthM, (vo - ve) * tf.widthM); errOld += eO; errOldMax = Math.max(errOldMax, eO);
      sampled++;
    }
    let arr = keep.get(key);
    if (!arr) keep.set(key, (arr = []));
    if (arr.length < 3_000_000) arr.push([xm, ym, z, (r >> 8) / 255, (g >> 8) / 255, (b >> 8) / 255]);
  });
  done += n;
}
closeSync(fd);
const seconds = (performance.now() - t0) / 1000;
console.log(`${file}: ${done} points in ${seconds.toFixed(1)} s (${(done / seconds / 1e6).toFixed(2)} million points per second, including ${sampled} exact checks); ${perTile.size} z17 tiles; points outside their tile after stepping: ${outside}`);
console.log(`position error against the exact conversion (metres, mean / max over ${sampled} points): tile frame ${(errTile / sampled * 1000).toFixed(2)} mm / ${(errTileMax * 1000).toFixed(2)} mm; the present flat frame around the file's centre ${(errOld / sampled).toFixed(3)} m / ${errOldMax.toFixed(3)} m`);
console.table([...perTile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tile, count]) => ({ tile: `${Z}/${tile.replace(",", "/")}`, points: count })));

// Stage 2 on the densest tile.
const [densest] = [...perTile.entries()].sort((a, b) => b[1] - a[1])[0]!;
const [dx, dy] = densest.split(",").map(Number) as [number, number];
const w = tileWidthMetres({ z: Z, x: dx, y: dy });
const cell = w / 512;
const pts = keep.get(densest)!;
const m0 = process.memoryUsage().rss;
const s0 = performance.now();
const acc = new VoxelAccumulator(cell);
for (const [x, y, z, r, g, b] of pts) acc.add(x, y, z, r, g, b);
const s1 = performance.now();
const res = adaptiveGaussians(acc, { maxLevel: 3, thickness: 0.2, colorTolerance: 0.2, sparseSupport: 24 });
const s2 = performance.now();
console.log(`stage 2 on tile ${Z}/${dx}/${dy}: ${pts.length} points, cell ${(cell * 100).toFixed(2)} cm; accumulate ${((s1 - s0) / 1000).toFixed(1)} s (${acc.voxels} voxels), adaptive merge ${((s2 - s1) / 1000).toFixed(1)} s -> ${res.gaussians.length} Gaussians; rss ${(m0 / 1e9).toFixed(2)} -> ${(process.memoryUsage().rss / 1e9).toFixed(2)} GB`);
void points;
