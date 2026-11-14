/**
 * Build the `numazu` demo tileset from a VIRTUAL SHIZUOKA MMS point cloud.
 *
 * Input (not committed; see README "Numazu point cloud"):
 *   data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.las
 *   (LAS 1.2, point format 3, JGD2011 plane rectangular zone VIII,
 *   X = easting, Y = northing, metres; source: Shizuoka Prefecture,
 *   VIRTUAL SHIZUOKA, CC BY).
 *
 * Steps:
 * 1. local frame: east/north = plane coordinates minus the data centre,
 *    treated as east/north (grid convergence here is about 0.18°, < 3 cm
 *    over the 14 m extent); up = the LAS Z unchanged. Z is already
 *    orthometric height (標高): ground points near the centre have median
 *    7.78 m against 7.6 m from the GSI 1 m DEM there;
 * 2. a tile pyramid (documents/progressive-maxzoom.md): for z18 and z19, one
 *    aggregated Gaussian per voxel of tile width / 512; for maxzoom z20,
 *    the finest Gaussians (voxel = z20 tile width / 2048, i.e. z22 detail)
 *    in nested refinement order with a 3-level table (src/progressive.ts).
 *    The finest set is also written as a reference-3DGS PLY to data/;
 * 3. placement at the data centre's latitude and longitude (Gauss–Krüger
 *    inverse, src/geodesy/jprcs.ts), split onto tiles by centre ownership,
 *    written to demo/tiles/numazu/ with a manifest.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { encodeDemoTile } from "../demo/src/demo-tile.js";
import { TOY_GS_PROPERTIES } from "../src/fixtures/toy-gaussians.js";
import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { writePlyFloat32 } from "../src/gaussian/ply.js";
import { gaussianToDisc, placeGaussians } from "../src/gaussian/to-surfels.js";
import { BASE_CELLS, omitWeakRefinements, orderByRefinement, prefixCount } from "../src/progressive.js";
import { readLas } from "../src/pointcloud/las.js";
import { fitVoxelGaussians, gaussiansToPlyRows } from "../src/pointcloud/voxel-gaussians.js";
import { tileLatitude, tileLongitude, tileWidthMetres, type TileAddress } from "../src/tile-geometry.js";
import { splitByTile } from "../src/tiling.js";
import { surfelBlockByteLength } from "../src/surfel-block.js";
import { PmtilesCompression, PmtilesTileType, writePmtiles } from "../src/pmtiles.js";
import { gzipSync } from "node:zlib";

const MESH = "08NE2701";
const DIR = `data/virtual-shizuoka/2019-mms-${MESH}`;
const LAS_PATH = `${DIR}/${MESH}.las`;
const ZONE = 8;
/** Aggregated tiles below maxzoom (documents/progressive-maxzoom.md). */
const AGGREGATED_ZOOMS = [18, 19];
/** Maxzoom: the finest Gaussians, in nested refinement order. */
const MAXZOOM = 20;
/** Levels in a maxzoom tile: z20, z21, z22 cell sizes. */
const LEVELS = 3;
/**
 * Refinement levels (1 and later) keep only Gaussians fitted to at least
 * this many points; level 0 is kept whole (E002 in EXPERIMENTS.md). At 6,
 * the whole z18–z20 pyramid is smaller than the COPC of the same points.
 * Override with DORAYAKI_MIN_SUPPORT=1 to keep everything.
 */
const MIN_REFINEMENT_SUPPORT = Number(process.env.DORAYAKI_MIN_SUPPORT ?? 6);
const OUT = "demo/tiles/numazu";

const las = readLas(new Uint8Array(readFileSync(LAS_PATH)));
if (!las.rgb) throw new Error("expected RGB points");

const e0 = (las.min[0] + las.max[0]) / 2;
const n0 = (las.min[1] + las.max[1]) / 2;
let ground = Infinity;
for (let i = 0; i < las.count; i++) if (las.classification[i] === 2) ground = Math.min(ground, las.z[i]!);
const origin = jprcsToLatLng(ZONE, n0, e0);

const xyz = new Float64Array(las.count * 3);
const rgb = new Float32Array(las.count * 3);
for (let i = 0; i < las.count; i++) {
  xyz[i * 3] = las.x[i]! - e0;
  xyz[i * 3 + 1] = las.y[i]! - n0;
  xyz[i * 3 + 2] = las.z[i]!; // orthometric height, as delivered
  for (let k = 0; k < 3; k++) rgb[i * 3 + k] = (las.rgb[i * 3 + k]! >> 8) / 255;
}

const t0 = Date.now();
const points = { count: las.count, xyz, rgb };
/** Tile width at the data's latitude for a zoom (any tile of the row; x does not matter). */
const widthAt = (z: number): number => {
  const n = 2 ** z;
  const y = Math.floor(((1 - Math.asinh(Math.tan((origin.lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return tileWidthMetres({ z, x: 0, y });
};
/**
 * One Gaussian per occupied voxel. Voxels with fewer than 3 points get
 * scales of a quarter voxel; others are floored at 1 mm only, so planar
 * voxels keep their thin axis (E003).
 */
const fit = (voxel: number) =>
  fitVoxelGaussians(points, { voxelSize: voxel, minPoints: 1, minScale: 0.001, degenerateScale: voxel / 4 });

mkdirSync(OUT, { recursive: true });
interface ManifestTile extends TileAddress { levels: number[]; bytes: number; levelBytes: number[] }
const manifestTiles: ManifestTile[] = [];
const archiveTiles: Array<{ z: number; x: number; y: number; data: Uint8Array }> = [];
const write = (tile: TileAddress, surfels: Parameters<typeof encodeDemoTile>[0], levels: number[]) => {
  const path = `${OUT}/${tile.z}/${tile.x}/${tile.y}.mlt`;
  mkdirSync(dirname(path), { recursive: true });
  const data = encodeDemoTile(surfels, levels);
  writeFileSync(path, data);
  archiveTiles.push({ ...tile, data });
  // Bytes needed for each prefix of whole levels (frame overhead included in the last entry only).
  const levelBytes = levels.map((_, k) => surfelBlockByteLength(prefixCount(levels, k + 1), levels.length));
  manifestTiles.push({ ...tile, levels, bytes: data.byteLength, levelBytes });
  console.log(`wrote ${path} (${data.byteLength} bytes, ${surfels.length} surfels, levels ${levels.join("/")})`);
};

const perZoom: Record<number, { gaussians: number; bytes: number }> = {};
for (const z of AGGREGATED_ZOOMS) {
  const voxel = widthAt(z) / BASE_CELLS;
  const gaussians = fit(voxel);
  const { block, splats } = placeGaussians(gaussians, origin, z);
  for (const t of splitByTile(splats, block)) if (t.surfels.length > 0) write(t.tile, t.surfels, [t.surfels.length]);
  perZoom[z] = { gaussians: gaussians.length, bytes: 0 };
}

const finestVoxel = widthAt(MAXZOOM) / (BASE_CELLS * 2 ** (LEVELS - 1));
const finest = fit(finestVoxel);
const plyPath = `${DIR}/${MESH}-finest-${(finestVoxel * 100).toFixed(2)}cm.ply`;
const ply = writePlyFloat32(TOY_GS_PROPERTIES, gaussiansToPlyRows(finest));
writeFileSync(plyPath, ply);
const finestDiscs = finest.map(gaussianToDisc);
{
  // Each placed splat carries its Gaussian's point support through
  // splitByTile and orderByRefinement.
  const { block, splats } = placeGaussians(finest, origin, MAXZOOM);
  for (const t of splitByTile(splats, block)) {
    if (t.surfels.length === 0) continue;
    const ordered = omitWeakRefinements(
      orderByRefinement(t.surfels, tileWidthMetres(t.tile), LEVELS),
      (q) => (q.support ?? 0) >= MIN_REFINEMENT_SUPPORT,
    );
    write(t.tile, ordered.surfels, ordered.levels);
  }
}
for (const t of manifestTiles) {
  perZoom[t.z] ??= { gaussians: 0, bytes: 0 };
  perZoom[t.z]!.bytes += t.bytes;
}
perZoom[MAXZOOM]!.gaussians = finestDiscs.length;

const quantile = (arr: number[], q: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const maxTiles = manifestTiles.filter((t) => t.z === MAXZOOM);
const levelTotals = Array.from({ length: LEVELS }, (_, k) => maxTiles.reduce((n, t) => n + (t.levelBytes[k] ?? 0), 0));
const stats = {
  points: las.count,
  lowestGroundElevation: ground,
  finestVoxelMetres: finestVoxel,
  finestGaussians: finestDiscs.length,
  minRefinementSupport: MIN_REFINEMENT_SUPPORT,
  maxzoomGaussiansKept: manifestTiles.filter((t) => t.z === MAXZOOM).reduce((a, t) => a + t.levels.reduce((x, y) => x + y, 0), 0),
  finestFlatShare: finestDiscs.filter((d) => d.flatness < 0.3).length / finestDiscs.length,
  finestRadiusP50: quantile(finestDiscs.map((d) => d.radius), 0.5),
  perZoom,
  maxzoomPrefixBytes: levelTotals,
  seconds: (Date.now() - t0) / 1000,
};

const all = manifestTiles;
const manifest = {
  name: `VIRTUAL SHIZUOKA MMS ${MESH} (Numazu): aggregated z${AGGREGATED_ZOOMS.join(",")}, progressive z${MAXZOOM} (${LEVELS} levels, refinement support >= ${MIN_REFINEMENT_SUPPORT})`,
  attribution: "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY) を加工して作成",
  verticalDatum: "orthometric height (標高), metres, as in the source LAS",
  centre: [origin.lng, origin.lat],
  maxzoom: MAXZOOM,
  tiles: all,
  bounds: (() => {
    const t = all.filter((a) => a.z === MAXZOOM);
    const xs = t.map((a) => a.x), ys = t.map((a) => a.y);
    const o = { z: MAXZOOM, x: Math.min(...xs), y: Math.min(...ys) };
    return [tileLongitude(o, 0), tileLatitude(o, Math.max(...ys) - o.y + 1), tileLongitude(o, Math.max(...xs) - o.x + 1), tileLatitude(o, 0)];
  })(),
  stats,
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
// TileJSON for the demo's local dev server, with the same fields Martin
// returns for a PMTiles source (tiles relative to this file).
const tilejson = {
  tilejson: "3.0.0",
  name: manifest.name,
  attribution: manifest.attribution,
  tiles: ["{z}/{x}/{y}.mlt"],
  minzoom: Math.min(...AGGREGATED_ZOOMS),
  maxzoom: MAXZOOM,
  bounds: manifest.bounds,
  center: [origin.lng, origin.lat, MAXZOOM],
};
writeFileSync(`${OUT}/tilejson.json`, JSON.stringify(tilejson, null, 2) + "\n");

// The same tiles as one PMTiles archive (MLT tile type), with the manifest
// in its metadata, for hosting on a Range-capable server (README).
// File name as hosted on stars (source id = file stem).
const archivePath = "demo/tiles/dorayaki-numazu.pmtiles";
const archive = writePmtiles(archiveTiles, {
  tileType: PmtilesTileType.Mlt,
  bounds: manifest.bounds as [number, number, number, number],
  center: [origin.lng, origin.lat, MAXZOOM],
  // Same shape as stars' existing MLT archives: gzip directories, raw tiles.
  internal: { compression: PmtilesCompression.Gzip, compress: (b) => new Uint8Array(gzipSync(b)) },
  metadata: {
    name: manifest.name,
    attribution: manifest.attribution,
    description: "Dorayaki experimental surfel tiles (Surfel Block in an experimental MLT frame, tag 0xD0). Not a standard.",
    dorayaki: manifest,
  },
});
writeFileSync(archivePath, archive);
console.log(`wrote ${plyPath} (${ply.byteLength} bytes), ${OUT}/manifest.json, and ${archivePath} (${archive.byteLength} bytes)`);
console.log(JSON.stringify(stats, null, 2));
