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
import { TileFramer, exactTileUnits, tileUnits } from "../src/geodesy/tile-frame.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { adaptiveGaussians } from "../src/pointcloud/adaptive.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";
import { EARTH_CIRCUMFERENCE_METRES, tileWidthMetres } from "../src/tile-geometry.js";

const [file, zoneArg, maxArg] = process.argv.slice(2);
if (!file || !zoneArg) { console.error("usage: prototype-tile-scatter <file.las> <zone> [maxpoints]"); process.exit(1); }
const ZONE = Number(zoneArg);
const Z = 17;
const N = 2 ** Z;

const toTileUnits = (lat: number, lng: number): [number, number] => tileUnits(lat, lng, Z);
const exactUnits = (e: number, n: number): [number, number] => exactTileUnits(ZONE, Z, e, n);
const framer = new TileFramer(ZONE, Z);

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
    const loc = framer.locate(e, nn);
    if (loc.clamped) outside++;
    const tx = loc.x, ty = loc.y;
    const key = `${tx},${ty}`;
    perTile.set(key, (perTile.get(key) ?? 0) + 1);
    const xm = loc.east, ym = loc.south;
    if (index % SAMPLE_EVERY === 0) {
      const [ue, ve] = exactUnits(e, nn);
      const dE = loc.east - (ue - tx) * loc.widthMetres, dN = loc.south - (ve - ty) * loc.widthMetres;
      const eT = Math.hypot(dE, dN); errTile += eT; errTileMax = Math.max(errTileMax, eT);
      // The present way: units from the file's centre, east/north metres scaled to tile units.
      const uo = ou + (e - e0) * oldPerMetre, vo = ov - (nn - n0) * oldPerMetre;
      const eO = Math.hypot((uo - ue) * loc.widthMetres, (vo - ve) * loc.widthMetres); errOld += eO; errOldMax = Math.max(errOldMax, eO);
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
console.log(`${file}: ${done} points in ${seconds.toFixed(1)} s (${(done / seconds / 1e6).toFixed(2)} million points per second, including ${sampled} exact checks); ${perTile.size} z17 tiles; points clamped into their tile after stepping: ${outside}`);
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
