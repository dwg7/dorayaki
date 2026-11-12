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
import { gaussianToDisc, placeDiscs } from "../src/gaussian/to-surfels.js";
import { BASE_CELLS, orderByRefinement, prefixCount } from "../src/progressive.js";
import { readLas } from "../src/pointcloud/las.js";
import { fitVoxelGaussians, gaussiansToPlyRows } from "../src/pointcloud/voxel-gaussians.js";
import { tileLatitude, tileLongitude, tileWidthMetres, type TileAddress } from "../src/tile-geometry.js";
import { splitByTile } from "../src/tiling.js";

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
/** One Gaussian per occupied voxel; a lone point gets scales of a quarter voxel. */
const fit = (voxel: number) => fitVoxelGaussians(points, { voxelSize: voxel, minPoints: 1, minScale: voxel / 4 });

mkdirSync(OUT, { recursive: true });
interface ManifestTile extends TileAddress { levels: number[]; bytes: number; levelBytes: number[] }
const manifestTiles: ManifestTile[] = [];
const write = (tile: TileAddress, surfels: Parameters<typeof encodeDemoTile>[0], levels: number[]) => {
  const path = `${OUT}/${tile.z}/${tile.x}/${tile.y}.mlt`;
  mkdirSync(dirname(path), { recursive: true });
  const data = encodeDemoTile(surfels, levels);
  writeFileSync(path, data);
  // Bytes needed for each prefix of whole levels (frame overhead included in the last entry only).
  const levelBytes = levels.map((_, k) => 16 + 4 * levels.length + 32 * prefixCount(levels, k + 1));
  manifestTiles.push({ ...tile, levels, bytes: data.byteLength, levelBytes });
  console.log(`wrote ${path} (${data.byteLength} bytes, ${surfels.length} surfels, levels ${levels.join("/")})`);
};

const perZoom: Record<number, { gaussians: number; bytes: number }> = {};
for (const z of AGGREGATED_ZOOMS) {
  const voxel = widthAt(z) / BASE_CELLS;
  const discs = fit(voxel).map(gaussianToDisc);
  const { block, surfels } = placeDiscs(discs, origin, z);
  for (const t of splitByTile(surfels, block)) if (t.surfels.length > 0) write(t.tile, t.surfels, [t.surfels.length]);
  perZoom[z] = { gaussians: discs.length, bytes: 0 };
}

const finestVoxel = widthAt(MAXZOOM) / (BASE_CELLS * 2 ** (LEVELS - 1));
const finest = fit(finestVoxel);
const plyPath = `${DIR}/${MESH}-finest-${(finestVoxel * 100).toFixed(2)}cm.ply`;
const ply = writePlyFloat32(TOY_GS_PROPERTIES, gaussiansToPlyRows(finest));
writeFileSync(plyPath, ply);
const finestDiscs = finest.map(gaussianToDisc);
{
  const { block, surfels } = placeDiscs(finestDiscs, origin, MAXZOOM);
  for (const t of splitByTile(surfels, block)) {
    if (t.surfels.length === 0) continue;
    const ordered = orderByRefinement(t.surfels, tileWidthMetres(t.tile), LEVELS);
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
  finestFlatShare: finestDiscs.filter((d) => d.flatness < 0.3).length / finestDiscs.length,
  finestRadiusP50: quantile(finestDiscs.map((d) => d.radius), 0.5),
  perZoom,
  maxzoomPrefixBytes: levelTotals,
  seconds: (Date.now() - t0) / 1000,
};

const all = manifestTiles;
const manifest = {
  name: `VIRTUAL SHIZUOKA MMS ${MESH} (Numazu): aggregated z${AGGREGATED_ZOOMS.join(",")}, progressive z${MAXZOOM} (${LEVELS} levels)`,
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
console.log(`wrote ${plyPath} (${ply.byteLength} bytes) and ${OUT}/manifest.json`);
console.log(JSON.stringify(stats, null, 2));
