/**
 * Build a tileset from a LAS point cloud of any size, streaming: the file is
 * read in chunks into one VoxelAccumulator per voxel size, then the pyramid
 * is built from the accumulated Gaussians (buildPyramidFrom). Memory depends
 * on the number of voxels, not points.
 *
 * Usage: node build-tileset.mjs <file.las[,file2.las ...]> <zone> <name> <maxzoom> [aggregated zoom ...]
 * Several files (comma-separated) are merged into the same voxels, for example
 * an MMS and an airborne mesh of the same area; the local origin is the centre of
 * the union of their bounds. Each file's points count in the voxel fits as they are.
 * Output: demo/tiles/<name>/z/x/y.mlt, tilejson.json, manifest.json and
 * demo/tiles/dorayaki-<name>.pmtiles. One level per tile (no refinement);
 * the finest cells are tile width / 512 at the maxzoom (the `coarse` rule).
 * A file may be followed by filters, `file.las@c2+1@first`: `@c<n>[+<n>...]`
 * keeps only those classifications, `@first` / `@last` only first / last returns.
 * Adaptive merging of the Gaussians of every zoom (E005, src/pointcloud/adaptive.ts),
 * when DORAYAKI_ADAPTIVE_LEVELS is set: that many merge levels (cells double);
 * DORAYAKI_ADAPTIVE_REFINE (default 0) starts from cells 2^refine times finer
 * than the maxzoom's; DORAYAKI_ADAPTIVE_THICKNESS (metres, default 0.05) and
 * DORAYAKI_ADAPTIVE_COLOR (default 0.1) are the merge limits;
 * DORAYAKI_ADAPTIVE_SPARSE (default 0 = off) also merges children that all have
 * fewer points than that (E008); DORAYAKI_ADAPTIVE_SPARSE_SCALE (default 1) multiplies that
 * threshold for each zoom below the maxzoom (E009).
 * Local frame as in build-numazu-demo.ts: east/north from the header centre,
 * up = LAS Z (orthometric height).
 */
import { closeSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

import { encodeDemoTile } from "../demo/src/demo-tile.js";
import { encodeClassPlane } from "../src/class-plane.js";
import { PLANE_CLASS_SLOTS, planeClassSlot, planeOpacityOf, planeSlotToCode } from "../src/pointcloud/class-slots.js";
import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { PmtilesCompression, PmtilesTileType, writePmtiles } from "../src/pmtiles.js";
import { adaptiveGaussians } from "../src/pointcloud/adaptive.js";
import { forEachLasRecord, parseLasHeader } from "../src/pointcloud/las.js";
import { parseLasSpec } from "../src/pointcloud/las-spec.js";
import { buildPyramidFrom, pyramidVoxelSizes, type PyramidConfig } from "../src/pointcloud/pyramid.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";
import { tileLatitude, tileLongitude, type TileAddress } from "../src/tile-geometry.js";

const [file, zoneArg, name, maxzoomArg, ...aggArgs] = process.argv.slice(2);
if (!file || !zoneArg || !name || !maxzoomArg) throw new Error("usage: build-tileset <file.las> <zone> <name> <maxzoom> [aggregated zoom ...]");
const config: PyramidConfig = {
  aggregatedZooms: aggArgs.map(Number), maxzoom: Number(maxzoomArg), levels: 1, minRefinementSupport: 1,
};
const OUT = `demo/tiles/${name}`;
/** DORAYAKI_BLOCK_VERSION=6 writes version 6 blocks (12-byte records, E016); the default is version 5. */
const blockVersion = process.env.DORAYAKI_BLOCK_VERSION === "6" ? (6 as const) : undefined;

const specs = file.split(",").map(parseLasSpec);
const files = specs.map((s) => s.path);
const heads = files.map((f) => {
  const fd = openSync(f, "r");
  const head = new Uint8Array(375);
  readSync(fd, head, 0, 375, 0);
  closeSync(fd);
  const header = parseLasHeader(head);
  if (header.rgbOffset === undefined) throw new Error(`expected RGB points in ${f}`);
  return header;
});
const minE = Math.min(...heads.map((h) => h.min[0])), maxE = Math.max(...heads.map((h) => h.max[0]));
const minN = Math.min(...heads.map((h) => h.min[1])), maxN = Math.max(...heads.map((h) => h.max[1]));
const e0 = (minE + maxE) / 2;
const n0 = (minN + maxN) / 2;
const origin = jprcsToLatLng(Number(zoneArg), n0, e0);

/**
 * DORAYAKI_CLASS_ALPHA=1 (E020, analysis only): count the points of every voxel by class and store the dominant class and its
 * purity in the splat's opacity byte: class slot * 32 + round(share * 31). Slots: LAS class 0..5; 6 = class 1 on a pulse with
 * several returns (airborne canopy); 7 = any other class.
 */
const classAlphaAnalysis = process.env.DORAYAKI_CLASS_ALPHA === "1";
/**
 * DORAYAKI_CLASS_PLANE=1 (E021): count the points of every voxel by class and write the dominant class of every splat as a class
 * plane beside the block (documents/class-plane.md). Slots: LAS class 0..15; 16 = class 1 on a pulse with several returns (derived
 * canopy, code 64); 17 = any other class (stored as 1). The class travels through the pipeline in the opacity byte of the splat
 * (slot / 255) and is moved into the plane when the tile is written; the block's opacity is then the usual 0.95.
 */
const classPlane = process.env.DORAYAKI_CLASS_PLANE === "1";
const classAlpha = classAlphaAnalysis || classPlane;
if (classPlane && process.env.DORAYAKI_ADAPTIVE_LEVELS === undefined) {
  // The class travels through the adaptive merge (in the splats' opacity); without it every splat would keep the default opacity byte.
  throw new Error("DORAYAKI_CLASS_PLANE=1 needs DORAYAKI_ADAPTIVE_LEVELS (the class is carried by the adaptive merge)");
}
const CLASS_SLOTS = classPlane ? PLANE_CLASS_SLOTS : 8;
const classSlot = classPlane
  ? planeClassSlot
  : (cls: number, returns: number): number => (cls === 1 && ((returns >> 3) & 7) > 1 ? 6 : cls <= 5 ? cls : 7);
const opacityOf = (counts: readonly number[]): number => {
  if (classPlane) return planeOpacityOf(counts);
  let total = 0, best = 0;
  counts.forEach((c, i) => { total += c; if (c > counts[best]!) best = i; });
  return (best * 32 + Math.round((counts[best]! / total) * 31)) / 255;
};
const sizes = pyramidVoxelSizes(origin, config);
const accs = new Map(sizes.map((s) => [s, new VoxelAccumulator(s, 16, classAlpha ? CLASS_SLOTS : 0)]));
const finestSize = sizes[sizes.length - 1]!;
if (process.env.DORAYAKI_ADAPTIVE_COLOUR !== undefined) {
  // Renamed with the spelling of colour to color (2026-11-17); the old name would be ignored and the default limit used without a sign.
  throw new Error("DORAYAKI_ADAPTIVE_COLOUR is now DORAYAKI_ADAPTIVE_COLOR");
}
const adaptive = process.env.DORAYAKI_ADAPTIVE_LEVELS === undefined ? undefined : {
  maxLevel: Number(process.env.DORAYAKI_ADAPTIVE_LEVELS),
  thickness: Number(process.env.DORAYAKI_ADAPTIVE_THICKNESS ?? 0.05),
  colorTolerance: Number(process.env.DORAYAKI_ADAPTIVE_COLOR ?? 0.1),
  sparseSupport: Number(process.env.DORAYAKI_ADAPTIVE_SPARSE ?? 0),
  ...(classAlpha ? { opacityOf } : {}),
};
// The sparse threshold is multiplied by this for each zoom below the maxzoom (cells there are 4 times
// the area, so they hold about 4 times the points); 1 keeps one threshold for every zoom (E009).
const sparseScale = Number(process.env.DORAYAKI_ADAPTIVE_SPARSE_SCALE ?? 1);
const zoomOfSize = new Map(sizes.map((v, i) => [v, i < config.aggregatedZooms.length ? config.aggregatedZooms[i]! : config.maxzoom]));
const baseSize = finestSize / 2 ** Number(process.env.DORAYAKI_ADAPTIVE_REFINE ?? 0);
const baseAcc = adaptive ? (accs.get(baseSize) ?? new VoxelAccumulator(baseSize, 16, classAlpha ? CLASS_SLOTS : 0)) : undefined;
if (baseAcc) accs.set(baseSize, baseAcc);
let adaptiveLevels: number[] | undefined;
const list = [...accs.values()];

const t0 = Date.now();
let done = 0;
for (const [fi, f] of files.entries()) {
  const header = heads[fi]!;
  const fd = openSync(f, "r");
  const CHUNK_RECORDS = Math.floor(64_000_000 / header.recordLength);
  const buf = new Uint8Array(CHUNK_RECORDS * header.recordLength);
  let fileDone = 0;
  while (fileDone < header.count) {
    const n = Math.min(CHUNK_RECORDS, header.count - fileDone);
    const want = n * header.recordLength;
    let got = 0;
    while (got < want) {
      const r = readSync(fd, buf, got, want - got, header.offsetToPoints + fileDone * header.recordLength + got);
      if (r === 0) throw new Error(`${f} ended after ${fileDone} records`);
      got += r;
    }
    const keep = specs[fi]!.keep;
    forEachLasRecord(buf, header, n, (x, y, z, c, r, g, b, returns) => {
      if (!keep(c, returns)) return;
      const lx = x - e0, ly = y - n0;
      const cr = (r >> 8) / 255, cg = (g >> 8) / 255, cb = (b >> 8) / 255;
      const slot = classAlpha ? classSlot(c, returns) : -1;
      for (const a of list) a.add(lx, ly, z, cr, cg, cb, slot);
    });
    fileDone += n;
  }
  closeSync(fd);
  done += fileDone;
}
const tAccumulated = (Date.now() - t0) / 1000;

const pyramid = buildPyramidFrom(
  (voxel) => {
    if (adaptive) {
      // Every zoom is merged by the same rule; only the maxzoom may start from finer cells.
      const sparseSupport = adaptive.sparseSupport * sparseScale ** (config.maxzoom - (zoomOfSize.get(voxel) ?? config.maxzoom));
      const r = adaptiveGaussians(voxel === finestSize ? baseAcc! : accs.get(voxel)!, { ...adaptive, sparseSupport });
      if (voxel === finestSize) adaptiveLevels = r.perLevel;
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
for (const { tile, splats: tileSplats, levels } of pyramid.tiles) {
  let splats = tileSplats;
  const path = `${OUT}/${tile.z}/${tile.x}/${tile.y}.mlt`;
  mkdirSync(dirname(path), { recursive: true });
  let plane: Uint8Array | undefined;
  if (classPlane) {
    // Move the class out of the opacity byte into the plane; the block keeps the usual opacity.
    plane = encodeClassPlane(Uint8Array.from(splats, (s) => planeSlotToCode(s.a)), (bytes) => new Uint8Array(gzipSync(bytes, { level: 9 })));
    splats = splats.map((s) => ({ ...s, a: 242 }));
  }
  const data = encodeDemoTile(splats, levels, blockVersion, plane);
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
// PMTiles tile compression: raw by default, because Martin 1.14 (stars) cannot read gzip
// MLT tiles; DORAYAKI_TILE_COMPRESSION=gzip compresses them (the byte-plane layout of
// Surfel Block v5 compresses well).
const gzipTiles = process.env.DORAYAKI_TILE_COMPRESSION === "gzip";
const archive = writePmtiles(gzipTiles ? archiveTiles.map((t) => ({ ...t, data: new Uint8Array(gzipSync(t.data, { level: 9 })) })) : archiveTiles, {
  tileType: PmtilesTileType.Mlt, bounds, ...(gzipTiles ? { tileCompression: PmtilesCompression.Gzip } : {}), center: [origin.lng, origin.lat, config.maxzoom],
  internal: { compression: PmtilesCompression.Gzip, compress: (b) => new Uint8Array(gzipSync(b)) },
  metadata: { name: manifest.name, attribution: manifest.attribution, dorayaki: manifest },
});
writeFileSync(`demo/tiles/dorayaki-${name}.pmtiles`, archive);
console.log(JSON.stringify({ ...stats, pmtilesBytes: archive.byteLength }, null, 2));
