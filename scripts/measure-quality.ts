/**
 * E012: how much a coarser (or more merged) tile zoom differs, as seen from
 * fixed cameras, from a finer reference. Renders both with the software
 * renderer (demo/src/cpu-render.ts) and prints the comparison
 * (demo/src/image-metrics.ts).
 *
 *   npm run measure:quality -- <tileset dir> <reference zoom> <candidate zoom> [<candidate dir>] [--views lng,lat,zoom,bearing,pitch;...] [--out dir]
 *
 * The reference zoom is read from the first directory, the candidate zoom from
 * the candidate directory (default: the same one). With --out, writes PNGs of
 * both renderings of every view.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { renderTiles, type Image, type TileInstances, type View } from "../demo/src/cpu-render.js";
import { decodeSurfelTileWithLevels } from "../demo/src/decode-tile.js";
import { compareImages } from "../demo/src/image-metrics.js";
import { splatInstances } from "../demo/src/splat-instances.js";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
};
const viewsArg = flag("--views");
const outDir = flag("--out");
const [refDir, refZoomArg, candZoomArg, candDirArg] = args;
if (!refDir || !refZoomArg || !candZoomArg) {
  console.error("usage: measure-quality <tileset dir> <reference zoom> <candidate zoom> [<candidate dir>] [--views lng,lat,zoom,bearing,pitch;...] [--out dir]");
  process.exit(1);
}
const candDir = candDirArg ?? refDir;

function loadZoom(dir: string, z: number): { tiles: TileInstances[]; heights: Array<[number, number, number]> } {
  const tiles: TileInstances[] = [];
  const heights: Array<[number, number, number]> = []; // tile x, y fractions are not needed; keep world-ish samples
  const zdir = join(dir, String(z));
  if (!existsSync(zdir)) throw new Error(`${zdir} does not exist`);
  for (const xs of readdirSync(zdir)) {
    for (const f of readdirSync(join(zdir, xs))) {
      if (!f.endsWith(".mlt")) continue;
      const x = Number(xs), y = Number(f.slice(0, -4));
      const decoded = decodeSurfelTileWithLevels(new Uint8Array(readFileSync(join(zdir, xs, f))));
      tiles.push({ tile: { z, x, y }, instances: splatInstances(decoded.splats) });
    }
  }
  return { tiles, heights };
}

/** Median height of the splats within `radius` metres of a point, to aim the camera at the ground. */
function groundHeight(tiles: TileInstances[], lng: number, lat: number, radius = 30): number {
  const n = (z: number) => 2 ** z;
  const X = (lng + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const Y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  const K = 40075016.68557849 * Math.cos((lat * Math.PI) / 180);
  const zs: number[] = [];
  for (const { tile, instances: ins } of tiles) {
    for (let i = 0; i < ins.count; i++) {
      const dx = ((tile.x + ins.position[i * 3]!) / n(tile.z) - X) * K;
      const dy = ((tile.y + ins.position[i * 3 + 1]!) / n(tile.z) - Y) * K;
      if (dx * dx + dy * dy < radius * radius) zs.push(ins.position[i * 3 + 2]!);
    }
  }
  zs.sort((a, b) => a - b);
  return zs.length > 0 ? zs[Math.floor(zs.length / 2)]! : 0;
}

function png(image: Image): Uint8Array {
  const { width, height } = image;
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * width + x;
      const covered = image.depth[o] !== Infinity;
      for (let k = 0; k < 3; k++) raw[y * (width * 3 + 1) + 1 + x * 3 + k] = covered ? image.rgb[o * 3 + k]! : 235;
    }
  }
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "ascii");
    Buffer.from(data).copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

const defaultViews = "138.939214,34.790766,16.63,128.7,67;138.9392956,34.7917627,18.5,-30,60;138.9392956,34.7917627,17.5,0,0";
const viewSpecs = (viewsArg ?? defaultViews).split(";").map((v) => v.split(",").map(Number) as [number, number, number, number, number]);

const t0 = performance.now();
const ref = loadZoom(refDir, Number(refZoomArg));
const cand = loadZoom(candDir, Number(candZoomArg));
const count = (t: TileInstances[]) => t.reduce((n, x) => n + x.instances.count, 0);
console.log(`reference ${refDir} z${refZoomArg}: ${ref.tiles.length} tiles, ${count(ref.tiles)} splats; candidate ${candDir} z${candZoomArg}: ${cand.tiles.length} tiles, ${count(cand.tiles)} splats (loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
if (outDir) mkdirSync(outDir, { recursive: true });

const rows: Array<Record<string, number | string>> = [];
viewSpecs.forEach(([lng, lat, zoom, bearing, pitch], vi) => {
  const centreZ = groundHeight(ref.tiles, lng, lat);
  const view: View = { lng, lat, zoom, bearing, pitch, width: 800, height: 600, centreZ };
  const a = renderTiles(ref.tiles, view);
  const b = renderTiles(cand.tiles, view);
  for (const block of [1, 4]) {
    const c = compareImages(a, b, block);
    rows.push({
      view: `${vi + 1}: z${zoom} b${bearing} p${pitch}`, block, covered: c.referencePixels,
      holes: +c.holes.toFixed(4), extra: +c.extra.toFixed(4), mae: +c.mae.toFixed(2), psnr: +c.psnr.toFixed(2),
      depthMedian: +c.depthMedian.toFixed(3), depthP95: +c.depthP95.toFixed(3),
    });
  }
  if (outDir) {
    writeFileSync(join(outDir, `view${vi + 1}-reference.png`), png(a));
    writeFileSync(join(outDir, `view${vi + 1}-candidate.png`), png(b));
  }
});
console.table(rows);
