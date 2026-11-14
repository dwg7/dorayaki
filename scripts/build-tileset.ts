/**
 * Build a tileset from a LAS point cloud of any size, streaming: the file is
 * read in chunks into one VoxelAccumulator per voxel size, then the pyramid
 * is built from the accumulated Gaussians (buildPyramidFrom). Memory depends
 * on the number of voxels, not points.
 *
 * Usage: node build-tileset.mjs <file.las> <zone> <name> <maxzoom> [aggregated zoom ...]
 * Output: demo/tiles/<name>/z/x/y.mlt, tilejson.json, manifest.json and
 * demo/tiles/dorayaki-<name>.pmtiles. One level per tile (no refinement);
 * the finest cells are tile width / 512 at the maxzoom (the `coarse` rule).
 * Adaptive merging of the maxzoom Gaussians (E005, src/pointcloud/adaptive.ts),
 * when DORAYAKI_ADAPTIVE_LEVELS is set: that many merge levels (cells double);
 * DORAYAKI_ADAPTIVE_REFINE (default 0) starts from cells 2^refine times finer
 * than the maxzoom's; DORAYAKI_ADAPTIVE_THICKNESS (metres, default 0.05) and
 * DORAYAKI_ADAPTIVE_COLOUR (default 0.1) are the merge limits.
 * Local frame as in build-numazu-demo.ts: east/north from the header centre,
 * up = LAS Z (orthometric height).
 */
import { closeSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

import { encodeDemoTile } from "../demo/src/demo-tile.js";
import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { PmtilesCompression, PmtilesTileType, writePmtiles } from "../src/pmtiles.js";
import { adaptiveGaussians } from "../src/pointcloud/adaptive.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { buildPyramidFrom, pyramidVoxelSizes, type PyramidConfig } from "../src/pointcloud/pyramid.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";
import { tileLatitude, tileLongitude, type TileAddress } from "../src/tile-geometry.js";

const [file, zoneArg, name, maxzoomArg, ...aggArgs] = process.argv.slice(2);
if (!file || !zoneArg || !name || !maxzoomArg) throw new Error("usage: build-tileset <file.las> <zone> <name> <maxzoom> [aggregated zoom ...]");
const config: PyramidConfig = {
  aggregatedZooms: aggArgs.map(Number), maxzoom: Number(maxzoomArg), levels: 1, minRefinementSupport: 1,
};
const OUT = `demo/tiles/${name}`;

const fd = openSync(file, "r");
const head = new Uint8Array(375);
readSync(fd, head, 0, 375, 0);
const header = parseLasHeader(head);
if (header.rgbOffset === undefined) throw new Error("expected RGB points");
const e0 = (header.min[0] + header.max[0]) / 2;
const n0 = (header.min[1] + header.max[1]) / 2;
const origin = jprcsToLatLng(Number(zoneArg), n0, e0);

const sizes = pyramidVoxelSizes(origin, config);
const accs = new Map(sizes.map((s) => [s, new VoxelAccumulator(s)]));
const finestSize = sizes[sizes.length - 1]!;
const adaptive = process.env.DORAYAKI_ADAPTIVE_LEVELS === undefined ? undefined : {
  maxLevel: Number(process.env.DORAYAKI_ADAPTIVE_LEVELS),
  thickness: Number(process.env.DORAYAKI_ADAPTIVE_THICKNESS ?? 0.05),
  colourTolerance: Number(process.env.DORAYAKI_ADAPTIVE_COLOUR ?? 0.1),
};
const baseSize = finestSize / 2 ** Number(process.env.DORAYAKI_ADAPTIVE_REFINE ?? 0);
const baseAcc = adaptive ? (accs.get(baseSize) ?? new VoxelAccumulator(baseSize)) : undefined;
if (baseAcc) accs.set(baseSize, baseAcc);
let adaptiveLevels: number[] | undefined;

const list = [...accs.values()];
const CHUNK_RECORDS = Math.floor(64_000_000 / header.recordLength);
const buf = new Uint8Array(CHUNK_RECORDS * header.recordLength);
const t0 = Date.now();
let done = 0;
while (done < header.count) {
  const n = Math.min(CHUNK_RECORDS, header.count - done);
  const want = n * header.recordLength;
  let got = 0;
  while (got < want) {
    const r = readSync(fd, buf, got, want - got, header.offsetToPoints + done * header.recordLength + got);
    if (r === 0) throw new Error(`file ended after ${done} records`);
    got += r;
  }
  forEachLasRecord(buf, header, n, (x, y, z, _c, r, g, b) => {
    const lx = x - e0, ly = y - n0;
    const cr = (r >> 8) / 255, cg = (g >> 8) / 255, cb = (b >> 8) / 255;
    for (const a of list) a.add(lx, ly, z, cr, cg, cb);
  });
  done += n;
}
closeSync(fd);
const tAccumulated = (Date.now() - t0) / 1000;

const pyramid = buildPyramidFrom(
  (voxel) => {
    if (adaptive && baseAcc && voxel === finestSize) {
      const r = adaptiveGaussians(baseAcc, adaptive);
      adaptiveLevels = r.perLevel;
      return r.gaussians;
    }
    return accs.get(voxel)!.toGaussians({ minPoints: 1, minScale: 0.001, degenerateScale: voxel / 4 });
  },
  origin, config,
);

mkdirSync(OUT, { recursive: true });
interface ManifestTile extends TileAddress { levels: number[]; bytes: number }
const manifestTiles: ManifestTile[] = [];
const archiveTiles: Array<{ z: number; x: number; y: number; data: Uint8Array }> = [];
const perZoom: Record<number, { gaussians: number; splats: number; bytes: number }> = {};
for (const [z, g] of Object.entries(pyramid.gaussiansPerZoom)) perZoom[Number(z)] = { gaussians: g, splats: 0, bytes: 0 };
for (const { tile, splats, levels } of pyramid.tiles) {
  const path = `${OUT}/${tile.z}/${tile.x}/${tile.y}.mlt`;
  mkdirSync(dirname(path), { recursive: true });
  const data = encodeDemoTile(splats, levels);
  writeFileSync(path, data);
  archiveTiles.push({ ...tile, data });
  manifestTiles.push({ ...tile, levels, bytes: data.byteLength });
  perZoom[tile.z]!.splats += splats.length;
  perZoom[tile.z]!.bytes += data.byteLength;
}

const top = manifestTiles.filter((t) => t.z === config.maxzoom);
const xs = top.map((a) => a.x), ys = top.map((a) => a.y);
const minX = xs.reduce((a, b) => Math.min(a, b)), maxX = xs.reduce((a, b) => Math.max(a, b));
const minY = ys.reduce((a, b) => Math.min(a, b)), maxY = ys.reduce((a, b) => Math.max(a, b));
const o = { z: config.maxzoom, x: minX, y: minY };
const bounds: [number, number, number, number] = [tileLongitude(o, 0), tileLatitude(o, maxY - minY + 1), tileLongitude(o, maxX - minX + 1), tileLatitude(o, 0)];
const stats = {
  file, points: done, config, voxelMetres: sizes, perZoom, adaptive, baseVoxelMetres: adaptive ? baseSize : undefined, adaptiveLevels,
  tileBytes: manifestTiles.reduce((n, t) => n + t.bytes, 0),
  tiles: manifestTiles.length, maxzoomTiles: top.length,
  accumulateSeconds: tAccumulated, totalSeconds: (Date.now() - t0) / 1000,
  rssGB: process.memoryUsage().rss / 1e9,
};
const manifest = {
  name: `${name}: aggregated z${config.aggregatedZooms.join(",")}, maxzoom z${config.maxzoom}`,
  attribution: "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY) を加工して作成",
  verticalDatum: "orthometric height (標高), metres, as in the source LAS",
  centre: [origin.lng, origin.lat], maxzoom: config.maxzoom, tiles: manifestTiles, bounds, stats,
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(`${OUT}/tilejson.json`, JSON.stringify({
  tilejson: "3.0.0", name: manifest.name, attribution: manifest.attribution, tiles: ["{z}/{x}/{y}.mlt"],
  minzoom: Math.min(...config.aggregatedZooms, config.maxzoom), maxzoom: config.maxzoom, bounds,
  center: [origin.lng, origin.lat, config.maxzoom],
}, null, 2) + "\n");
const archive = writePmtiles(archiveTiles, {
  tileType: PmtilesTileType.Mlt, bounds, center: [origin.lng, origin.lat, config.maxzoom],
  internal: { compression: PmtilesCompression.Gzip, compress: (b) => new Uint8Array(gzipSync(b)) },
  metadata: { name: manifest.name, attribution: manifest.attribution, dorayaki: manifest },
});
writeFileSync(`demo/tiles/dorayaki-${name}.pmtiles`, archive);
console.log(JSON.stringify({ ...stats, pmtilesBytes: archive.byteLength }, null, 2));
