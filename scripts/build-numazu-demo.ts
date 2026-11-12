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
 * 2. one Gaussian per 0.25 m voxel (src/pointcloud/voxel-gaussians.ts),
 *    written as a reference-3DGS PLY to data/ (intermediate, not committed);
 * 3. that PLY read back through the 3DGS -> surfel path
 *    (src/gaussian/to-surfels.ts), placed at the data centre's latitude and
 *    longitude (Gauss–Krüger inverse, src/geodesy/jprcs.ts), split onto
 *    z18 tiles by centre ownership, written to demo/tiles/numazu/ with a
 *    manifest.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { encodeDemoTile } from "../demo/src/demo-tile.js";
import { TOY_GS_PROPERTIES } from "../src/fixtures/toy-gaussians.js";
import { jprcsToLatLng } from "../src/geodesy/jprcs.js";
import { readPly, writePlyFloat32 } from "../src/gaussian/ply.js";
import { gaussianToDisc, gaussiansFromPly, placeDiscs } from "../src/gaussian/to-surfels.js";
import { readLas } from "../src/pointcloud/las.js";
import { fitVoxelGaussians, gaussiansToPlyRows } from "../src/pointcloud/voxel-gaussians.js";
import { tileLatitude, tileLongitude } from "../src/tile-geometry.js";
import { splitByTile } from "../src/tiling.js";

const MESH = "08NE2701";
const DIR = `data/virtual-shizuoka/2019-mms-${MESH}`;
const LAS_PATH = `${DIR}/${MESH}.las`;
const ZONE = 8;
const VOXEL = 0.25;
const ZOOM = 18;
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
const gaussians = fitVoxelGaussians({ count: las.count, xyz, rgb }, { voxelSize: VOXEL });
const plyPath = `${DIR}/${MESH}-voxel${VOXEL * 100}cm.ply`;
const ply = writePlyFloat32(TOY_GS_PROPERTIES, gaussiansToPlyRows(gaussians));
writeFileSync(plyPath, ply);

const discs = gaussiansFromPly(readPly(ply)).map(gaussianToDisc);
const { block, surfels } = placeDiscs(discs, origin, ZOOM);
const tiles = splitByTile(surfels, block).filter((t) => t.surfels.length > 0);

mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const { tile, surfels: s } of tiles) {
  const path = `${OUT}/${tile.z}/${tile.x}/${tile.y}.mlt`;
  mkdirSync(dirname(path), { recursive: true });
  const data = encodeDemoTile(s);
  writeFileSync(path, data);
  bytes += data.byteLength;
  console.log(`wrote ${path} (${data.byteLength} bytes, ${s.length} surfels)`);
}

const quantile = (arr: number[], q: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const flat = discs.map((d) => d.flatness);
const aniso = discs.map((d) => d.anisotropy);
const radius = discs.map((d) => d.radius);
const stats = {
  points: las.count,
  gaussians: gaussians.length,
  voxelSize: VOXEL,
  lowestGroundElevation: ground,
  flatness: { p10: quantile(flat, 0.1), p50: quantile(flat, 0.5), p90: quantile(flat, 0.9), flatShare: flat.filter((f) => f < 0.3).length / flat.length, roundShare: flat.filter((f) => f > 0.6).length / flat.length },
  anisotropy: { p50: quantile(aniso, 0.5), p90: quantile(aniso, 0.9) },
  radiusMetres: { p10: quantile(radius, 0.1), p50: quantile(radius, 0.5), p90: quantile(radius, 0.9) },
  tileBytes: bytes,
  seconds: (Date.now() - t0) / 1000,
};

const manifest = {
  name: `VIRTUAL SHIZUOKA MMS ${MESH} (Numazu), voxel Gaussians ${VOXEL} m`,
  attribution: "点群: 静岡県 VIRTUAL SHIZUOKA (CC BY) を加工して作成",
  verticalDatum: "orthometric height (標高), metres, as in the source LAS",
  centre: [origin.lng, origin.lat],
  tiles: tiles.map((t) => t.tile),
  bounds: [tileLongitude(block.origin, 0), tileLatitude(block.origin, block.rows), tileLongitude(block.origin, block.cols), tileLatitude(block.origin, 0)],
  stats,
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${plyPath} (${ply.byteLength} bytes) and ${OUT}/manifest.json`);
console.log(JSON.stringify(stats, null, 2));
