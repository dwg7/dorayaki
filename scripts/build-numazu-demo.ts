/**
 * Build a Numazu demo tileset from a VIRTUAL SHIZUOKA MMS point cloud.
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
 * 2. a tile pyramid by profile (src/pointcloud/pyramid.ts,
 *    documents/progressive-maxzoom.md);
 * 3. placement at the data centre's latitude and longitude (Gauss–Krüger
 *    inverse, src/geodesy/jprcs.ts), split onto tiles by centre ownership,
 *    written to demo/tiles/<dir>/ with manifest.json and tilejson.json, and
 *    as one PMTiles archive (tile type MLT, gzip directories).
 *
 * Profiles (DORAYAKI_NUMAZU_PROFILE, default `medium`; sizes and the
 * comparison in EXPERIMENTS.md E004):
 * - medium: z18, z19 aggregated; z20 maxzoom, one level (6.1 cm cells).
 *           The default, published as dorayaki-numazu.pmtiles;
 * - fine:   z18, z19 aggregated; z20 maxzoom with 3 levels (6.1, 3.1, 1.5 cm
 *           cells), refinements with fewer than 6 points omitted (E002);
 * - coarse: z18 aggregated; z19 maxzoom, one level (12.2 cm cells).
 * DORAYAKI_MIN_SUPPORT overrides the omission threshold of `fine`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

import { encodeDemoTile } from "../demo/src/demo-tile.js";
import { TOY_GS_PROPERTIES } from "../src/fixtures/toy-gaussians.js";
import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { writePlyFloat32 } from "../src/gaussian/ply.js";
import { gaussianToDisc } from "../src/gaussian/to-surfels.js";
import { PmtilesCompression, PmtilesTileType, writePmtiles } from "../src/pmtiles.js";
import { readLas } from "../src/pointcloud/las.js";
import { buildPyramid, type PyramidConfig } from "../src/pointcloud/pyramid.js";
import { gaussiansToPlyRows } from "../src/pointcloud/voxel-gaussians.js";
import { prefixCount } from "../src/progressive.js";
import { surfelBlockByteLength } from "../src/surfel-block.js";
import { tileLatitude, tileLongitude, type TileAddress } from "../src/tile-geometry.js";

const MESH = "08NE2701";
const DIR = `data/virtual-shizuoka/2019-mms-${MESH}`;
const LAS_PATH = `${DIR}/${MESH}.las`;
const ZONE = 8;

interface Profile { config: PyramidConfig; dir: string; pmtiles: string }
const PROFILES: Record<string, Profile> = {
  medium: {
    config: { aggregatedZooms: [18, 19], maxzoom: 20, levels: 1, minRefinementSupport: 1 },
    dir: "numazu", pmtiles: "dorayaki-numazu.pmtiles",
  },
  fine: {
    config: { aggregatedZooms: [18, 19], maxzoom: 20, levels: 3, minRefinementSupport: Number(process.env.DORAYAKI_MIN_SUPPORT ?? 6) },
    dir: "numazu-fine", pmtiles: "dorayaki-numazu-fine.pmtiles",
  },
  coarse: {
    config: { aggregatedZooms: [18], maxzoom: 19, levels: 1, minRefinementSupport: 1 },
    dir: "numazu-coarse", pmtiles: "dorayaki-numazu-coarse.pmtiles",
  },
};
const profileName = process.env.DORAYAKI_NUMAZU_PROFILE ?? "medium";
const profile = PROFILES[profileName];
if (!profile) throw new Error(`unknown profile ${profileName}; use ${Object.keys(PROFILES).join(", ")}`);
const { config } = profile;
const OUT = `demo/tiles/${profile.dir}`;

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
const pyramid = buildPyramid({ count: las.count, xyz, rgb }, origin, config);

mkdirSync(OUT, { recursive: true });
interface ManifestTile extends TileAddress { levels: number[]; bytes: number; levelBytes: number[] }
const manifestTiles: ManifestTile[] = [];
const archiveTiles: Array<{ z: number; x: number; y: number; data: Uint8Array }> = [];
const perZoom: Record<number, { gaussians: number; splats: number; bytes: number }> = {};
for (const [z, gaussians] of Object.entries(pyramid.gaussiansPerZoom)) perZoom[Number(z)] = { gaussians, splats: 0, bytes: 0 };

for (const { tile, splats, levels } of pyramid.tiles) {
  const path = `${OUT}/${tile.z}/${tile.x}/${tile.y}.mlt`;
  mkdirSync(dirname(path), { recursive: true });
  const data = encodeDemoTile(splats, levels);
  writeFileSync(path, data);
  archiveTiles.push({ ...tile, data });
  // Bytes needed for each prefix of whole levels (block only, without MLT frames).
  const levelBytes = levels.map((_, k) => surfelBlockByteLength(prefixCount(levels, k + 1), levels.length));
  manifestTiles.push({ ...tile, levels, bytes: data.byteLength, levelBytes });
  perZoom[tile.z]!.splats += splats.length;
  perZoom[tile.z]!.bytes += data.byteLength;
  console.log(`wrote ${path} (${data.byteLength} bytes, ${splats.length} splats, levels ${levels.join("/")})`);
}

const finestVoxel = pyramid.finestVoxelMetres;
const plyPath = `${DIR}/${MESH}-${profileName}-finest-${(finestVoxel * 100).toFixed(2)}cm.ply`;
const ply = writePlyFloat32(TOY_GS_PROPERTIES, gaussiansToPlyRows(pyramid.finest));
writeFileSync(plyPath, ply);
const finestDiscs = pyramid.finest.map(gaussianToDisc);

const quantile = (arr: number[], q: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const maxTiles = manifestTiles.filter((t) => t.z === config.maxzoom);
const levelTotals = Array.from({ length: config.levels }, (_, k) => maxTiles.reduce((n, t) => n + (t.levelBytes[k] ?? 0), 0));
const stats = {
  profile: profileName,
  points: las.count,
  lowestGroundElevation: ground,
  config,
  finestVoxelMetres: finestVoxel,
  finestGaussians: pyramid.finest.length,
  finestFlatShare: finestDiscs.filter((d) => d.flatness < 0.3).length / finestDiscs.length,
  finestRadiusP50: quantile(finestDiscs.map((d) => d.radius), 0.5),
  perZoom,
  tileBytes: manifestTiles.reduce((n, t) => n + t.bytes, 0),
  maxzoomPrefixBytes: levelTotals,
  seconds: (Date.now() - t0) / 1000,
};

const all = manifestTiles;
const bounds = (() => {
  const t = all.filter((a) => a.z === config.maxzoom);
  const xs = t.map((a) => a.x), ys = t.map((a) => a.y);
  const o = { z: config.maxzoom, x: Math.min(...xs), y: Math.min(...ys) };
  return [tileLongitude(o, 0), tileLatitude(o, Math.max(...ys) - o.y + 1), tileLongitude(o, Math.max(...xs) - o.x + 1), tileLatitude(o, 0)];
})();
const manifest = {
  name: `VIRTUAL SHIZUOKA MMS ${MESH} (Numazu, ${profileName}): aggregated z${config.aggregatedZooms.join(",")}, maxzoom z${config.maxzoom} (${config.levels} level${config.levels > 1 ? "s" : ""}${config.levels > 1 ? `, refinement support >= ${config.minRefinementSupport}` : ""})`,
  attribution: "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY) を加工して作成",
  verticalDatum: "orthometric height (標高), metres, as in the source LAS",
  centre: [origin.lng, origin.lat],
  maxzoom: config.maxzoom,
  tiles: all,
  bounds,
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
  minzoom: Math.min(...config.aggregatedZooms, config.maxzoom),
  maxzoom: config.maxzoom,
  bounds,
  center: [origin.lng, origin.lat, config.maxzoom],
};
writeFileSync(`${OUT}/tilejson.json`, JSON.stringify(tilejson, null, 2) + "\n");

// The same tiles as one PMTiles archive (MLT tile type), with the manifest
// in its metadata, for hosting on a Range-capable server (README).
const archivePath = `demo/tiles/${profile.pmtiles}`;
const archive = writePmtiles(archiveTiles, {
  tileType: PmtilesTileType.Mlt,
  bounds: bounds as [number, number, number, number],
  center: [origin.lng, origin.lat, config.maxzoom],
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
console.log(`wrote ${plyPath} (${ply.byteLength} bytes), ${OUT}/manifest.json, ${OUT}/tilejson.json, and ${archivePath} (${archive.byteLength} bytes)`);
console.log(JSON.stringify(stats, null, 2));
