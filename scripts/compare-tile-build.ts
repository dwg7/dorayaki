/**
 * E022 step 2: the tile-local build against the present build, on the points of one z17 tile of one LAS file.
 *
 *   npm run compare:tile-build -- <file.las> <zone> [x y]     (default: the file's densest z17 tile)
 *
 * New: the points go through TileFramer into the tile's frame, and buildTilePieces makes the z17, z16 and z15 pieces on the tile's own grid.
 * Present: the same points go through the build-tileset.ts path (a flat east/north frame around the file's centre, voxel grid of the
 * latitude-dependent width / 512, every zoom merged by the same rule), and each Gaussian's position is carried back to plane coordinates and
 * into the tile's frame with TileFramer ("undoing the rotation"), so that both sets lie in one frame. The recipe is the Kawazu one (documents/kawazu-demo.md).
 * Reported per zoom: splat counts, the distance of each splat to the nearest splat of the other build (both ways), and the color and height of
 * matched pairs. The two grids differ in phase, so the distance is not expected to reach zero; the cell size is printed as the scale.
 */
import { closeSync, openSync, readSync } from "node:fs";

import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { TileFramer } from "../src/geodesy/tile-frame.js";
import { adaptiveGaussians } from "../src/pointcloud/adaptive.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { pyramidVoxelSizes } from "../src/pointcloud/pyramid.js";
import { buildTilePieces } from "../src/pointcloud/tile-build.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";
import { tileWidthMetres } from "../src/tile-geometry.js";

const [file, zoneArg, xArg, yArg] = process.argv.slice(2);
if (!file || !zoneArg) { console.error("usage: compare-tile-build <file.las> <zone> [x y]"); process.exit(1); }
const ZONE = Number(zoneArg);
const framer = new TileFramer(ZONE, 17);
const fd = openSync(file, "r");
const head = new Uint8Array(375); readSync(fd, head, 0, 375, 0);
const header = parseLasHeader(head);
const e0 = (header.min[0] + header.max[0]) / 2, n0 = (header.min[1] + header.max[1]) / 2;
const origin = jprcsToLatLng(ZONE, n0, e0);
const CHUNK = Math.floor(64_000_000 / header.recordLength);
const buf = new Uint8Array(CHUNK * header.recordLength);
function pass(each: (e: number, n: number, z: number, r: number, g: number, b: number) => void): void {
  let done = 0;
  while (done < header.count) {
    const n = Math.min(CHUNK, header.count - done), want = n * header.recordLength;
    let got = 0;
    while (got < want) { const r = readSync(fd, buf, got, want - got, header.offsetToPoints + done * header.recordLength + got); if (r === 0) throw new Error("short file"); got += r; }
    forEachLasRecord(buf, header, n, (e, nn, z, _c, r, g, b) => each(e, nn, z, (r >> 8) / 255, (g >> 8) / 255, (b >> 8) / 255));
    done += n;
  }
}

let tx: number, ty: number;
if (xArg && yArg) { tx = Number(xArg); ty = Number(yArg); } else {
  const counts = new Map<string, number>();
  pass((e, n) => { const l = framer.locate(e, n); const k = `${l.x},${l.y}`; counts.set(k, (counts.get(k) ?? 0) + 1); });
  [tx, ty] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0].split(",").map(Number) as [number, number];
}
const tile = { z: 17, x: tx!, y: ty! };
const W = tileWidthMetres(tile);
const pts: Array<[number, number, number, number, number, number, number, number]> = []; // e, n, up, r, g, b, east, south
pass((e, n, z, r, g, b) => { const l = framer.locate(e, n); if (l.x === tx && l.y === ty) pts.push([e, n, z, r, g, b, l.east, l.south]); });
closeSync(fd);
console.log(`${file}: tile 17/${tx}/${ty}, ${pts.length} points, width ${W.toFixed(3)} m, cell ${(W / 512 * 100).toFixed(2)} cm`);

const adaptive = { maxLevel: 3, thickness: 0.2, colorTolerance: 0.2, sparseSupport: 24 };
const SCALE = 10;
const t0 = performance.now();
const pieces = buildTilePieces((add) => { for (const p of pts) add(p[6], p[7], p[2], p[3], p[4], p[5]); }, tile, { adaptive: { ...adaptive, sparseScale: SCALE } });
const tNew = (performance.now() - t0) / 1000;

interface P { e: number; s: number; z: number; r: number; g: number; b: number }
const newSet = pieces.map((p) => {
  const d = 17 - p.tile.z, ox = tx! - (p.tile.x << d), oy = ty! - (p.tile.y << d);
  return p.splats.map((s): P => ({ e: (s.x * 2 ** d - ox) * W, s: (s.y * 2 ** d - oy) * W, z: s.z, r: s.r, g: s.g, b: s.b }));
});

const zooms = [17, 16, 15];
const sizes = pyramidVoxelSizes(origin, { aggregatedZooms: [16, 15], maxzoom: 17, levels: 1, minRefinementSupport: 1 }); // z16, z15, z17
const sizeOf = new Map([[16, sizes[0]!], [15, sizes[1]!], [17, sizes[2]!]]);
const t1 = performance.now();
const oldSet = zooms.map((z) => {
  const acc = new VoxelAccumulator(sizeOf.get(z)!);
  for (const p of pts) acc.add(p[0] - e0, p[1] - n0, p[2], p[3], p[4], p[5]);
  const sparse = adaptive.sparseSupport * SCALE ** (17 - z);
  return adaptiveGaussians(acc, { ...adaptive, sparseSupport: sparse }).gaussians.map((g): P => {
    const l = framer.locate(e0 + g.position[0], n0 + g.position[1]); // back to the plane, then into the exact tile frame
    // Positions in the frame of the target tile: a neighbour's frame is shifted by whole tile widths.
    return { e: l.east + (l.x - tx!) * W, s: l.south + (l.y - ty!) * W, z: g.position[2], r: g.color[0] * 255, g: g.color[1] * 255, b: g.color[2] * 255 };
  });
});
const tOld = (performance.now() - t1) / 1000;

/** Nearest neighbour in the other set (3D, hash grid of 4 m cells): distances and the matched index. */
function nearest(from: P[], to: P[]): Array<{ d: number; j: number }> {
  const H = 4, map = new Map<string, number[]>();
  const key = (e: number, s: number, z: number) => `${Math.floor(e / H)},${Math.floor(s / H)},${Math.floor(z / H)}`;
  to.forEach((p, j) => { const k = key(p.e, p.s, p.z); (map.get(k) ?? map.set(k, []).get(k)!).push(j); });
  return from.map((p) => {
    let best = Infinity, bj = -1;
    const [ci, cj, ck] = [Math.floor(p.e / H), Math.floor(p.s / H), Math.floor(p.z / H)];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const j of map.get(`${ci + a},${cj + b},${ck + c}`) ?? []) {
        const q = to[j]!; const d = Math.hypot(p.e - q.e, p.s - q.s, p.z - q.z);
        if (d < best) { best = d; bj = j; }
      }
    }
    return { d: best, j: bj };
  });
}
const pct = (v: number[], q: number) => { const a = v.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))]! : NaN; };
const rows = zooms.map((z, i) => {
  const a = newSet[i]!, b = oldSet[i]!;
  const ab = nearest(a, b), ba = nearest(b, a);
  const pairs = ab.flatMap((m, k) => (m.j >= 0 ? [[a[k]!, b[m.j]!] as const] : []));
  const dc = pairs.map(([p, q]) => (Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b)) / 3);
  const dz = pairs.map(([p, q]) => Math.abs(p.z - q.z));
  const unmatched = ab.length - pairs.length;
  const cell = (z === 17 ? 1 : 2 ** (17 - z)) * W / 512;
  return {
    zoom: z, "cell cm": +(cell * 100).toFixed(1), "new splats": a.length, "present splats": b.length, "new/present": +(a.length / b.length).toFixed(3),
    "dist new→present median/p90 cm": `${(pct(ab.map((m) => m.d), 0.5) * 100).toFixed(0)}/${(pct(ab.map((m) => m.d), 0.9) * 100).toFixed(0)}`,
    "dist present→new median/p90 cm": `${(pct(ba.map((m) => m.d), 0.5) * 100).toFixed(0)}/${(pct(ba.map((m) => m.d), 0.9) * 100).toFixed(0)}`,
    "color diff mean (0-255)": +(dc.reduce((s, v) => s + v, 0) / Math.max(1, dc.length)).toFixed(2),
    "height diff median cm": +(pct(dz, 0.5) * 100).toFixed(1), "no neighbor within 4 m": unmatched,
  };
});
console.table(rows);
const mean = (v: P[], f: (p: P) => number) => v.reduce((s, p) => s + f(p), 0) / Math.max(1, v.length);
console.log(`mean color (r,g,b): ` + zooms.map((z, i) => `z${z} new ${[0, 1, 2].map((c) => mean(newSet[i]!, (p) => [p.r, p.g, p.b][c]!).toFixed(1))} present ${[0, 1, 2].map((c) => mean(oldSet[i]!, (p) => [p.r, p.g, p.b][c]!).toFixed(1))}`).join("; "));
console.log(`time: new ${tNew.toFixed(1)} s (three zooms), present ${tOld.toFixed(1)} s; rss ${(process.memoryUsage().rss / 1e9).toFixed(2)} GB`);
