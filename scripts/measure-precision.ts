/**
 * E016: which precision reductions are visually free. Decodes the tiles of one zoom, requantizes one field at a time
 * (position, height step, scale steps per octave, rotation bits, color bits), renders the original and the
 * requantized splats from fixed cameras (demo/src/cpu-render.ts) and compares them (demo/src/image-metrics.ts).
 *
 *   npm run measure:precision -- <tileset dir> <zoom> [--views lng,lat,zoom,bearing,pitch;...]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { renderTiles, type TileInstances, type View } from "../demo/src/cpu-render.js";
import { decodeSurfelTileWithLevels } from "../demo/src/decode-tile.js";
import { compareImages } from "../demo/src/image-metrics.js";
import { splatInstances } from "../demo/src/splat-instances.js";
import type { Splat } from "../src/surfel-block.js";

const args = process.argv.slice(2);
const vi = args.indexOf("--views");
const viewsArg = vi >= 0 ? args.splice(vi, 2)[1] : undefined;
const [dir, zoomArg] = args;
if (!dir || !zoomArg) { console.error("usage: measure-precision <tileset dir> <zoom> [--views ...]"); process.exit(1); }
const z = Number(zoomArg);

const tiles: Array<{ x: number; y: number; splats: Splat[] }> = [];
for (const xs of readdirSync(join(dir, zoomArg))) for (const f of readdirSync(join(dir, zoomArg, xs))) {
  if (f.endsWith(".mlt")) tiles.push({ x: Number(xs), y: Number(f.slice(0, -4)), splats: decodeSurfelTileWithLevels(new Uint8Array(readFileSync(join(dir, zoomArg, xs, f)))).splats });
}

const QR = Math.SQRT1_2;
/** Quantize the three smaller components of a unit quaternion to `bits` bits each (smallest three), as the block does at 7. */
function quantQuat(s: Splat, bits: number): Splat {
  const q = [s.qw, s.qx, s.qy, s.qz];
  const len = Math.hypot(...q);
  const u = q.map((v) => v / len);
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(u[i]!) > Math.abs(u[big]!)) big = i;
  const sign = u[big]! < 0 ? -1 : 1;
  const half = 2 ** (bits - 1) - 1;
  const out = u.map((v, i) => (i === big ? 0 : (Math.round((Math.max(-QR, Math.min(QR, sign * v)) / QR) * half) / half) * QR));
  out[big] = Math.sqrt(Math.max(0, 1 - out.reduce((a, v) => a + v * v, 0)));
  return { ...s, qw: out[0]!, qx: out[1]!, qy: out[2]!, qz: out[3]! };
}
const quantScale = (v: number, perOctave: number) => 2 ** (Math.round(Math.log2(v) * perOctave) / perOctave);
const quantColor = (v: number, bits: number) => Math.round((Math.round((v / 255) * (2 ** bits - 1)) / (2 ** bits - 1)) * 255);

interface Variant { name: string; bitsSaved: string; apply: (s: Splat, zMin: number) => Splat }
const variants: Variant[] = [
  { name: "original", bitsSaved: "0", apply: (s) => s },
  ...[12, 11, 10].map((b): Variant => ({ name: `position x,y ${b} bits`, bitsSaved: `${2 * (16 - b)}`, apply: (s) => ({ ...s, x: Math.min((2 ** b - 1) / 2 ** b, Math.round(s.x * 2 ** b) / 2 ** b), y: Math.min((2 ** b - 1) / 2 ** b, Math.round(s.y * 2 ** b) / 2 ** b) }) })),
  ...[0.02, 0.05, 0.1].map((m): Variant => ({ name: `height step ${m * 100} cm`, bitsSaved: `${Math.log2(m / 0.004).toFixed(1)}`, apply: (s, zMin) => ({ ...s, z: zMin + Math.round((s.z - zMin) / m) * m }) })),
  ...[6, 4, 3].map((k): Variant => ({ name: `scale ${k} steps/octave`, bitsSaved: `${(3 * Math.log2(10 / k)).toFixed(1)}`, apply: (s) => ({ ...s, sx: quantScale(s.sx, k), sy: quantScale(s.sy, k), sz: quantScale(s.sz, k) }) })),
  ...[5, 4, 3].map((b): Variant => ({ name: `rotation ${b} bits/component`, bitsSaved: `${3 * (7 - b)}`, apply: (s) => quantQuat(s, b) })),
  ...[6, 5, 4].map((b): Variant => ({ name: `color ${b} bits/channel`, bitsSaved: `${3 * (8 - b)}`, apply: (s) => ({ ...s, r: quantColor(s.r, b), g: quantColor(s.g, b), b: quantColor(s.b, b) }) })),
  // The reductions together (the 96-bit record of E016): the biggest single errors were position and rotation.
  ...[12, 13].map((b): Variant => ({
    name: `combined: position ${b} bits, height 2 cm, scale 6/octave, rotation 5 bits, color 6 bits`, bitsSaved: `${2 * (16 - b) + 2.3 + 2.2 + 6 + 6}`,
    apply: (s, zMin) => {
      const q = quantQuat(s, 5);
      const pos = (v: number) => Math.min((2 ** b - 1) / 2 ** b, Math.round(v * 2 ** b) / 2 ** b);
      return { ...q, x: pos(s.x), y: pos(s.y), z: zMin + Math.round((s.z - zMin) / 0.02) * 0.02,
        sx: quantScale(s.sx, 6), sy: quantScale(s.sy, 6), sz: quantScale(s.sz, 6),
        r: quantColor(s.r, 6), g: quantColor(s.g, 6), b: quantColor(s.b, 6) };
    },
  })),
  // Making room for a class in the 96-bit record (E020): the combined variant above (position 13 bits) is the base; each of
  // these frees 2 or 3 bits from one field of it.
  ...[
    { name: "base for class bits: position 13, height 2 cm, scale 6/octave, rotation 5, color 6", pos: 13, zStep: 0.02, quat: 5, color: 6, freed: 0 },
    { name: "frees 2 bits: position 12 bits", pos: 12, zStep: 0.02, quat: 5, color: 6, freed: 2 },
    { name: "frees 3 bits: color 5 bits per channel", pos: 13, zStep: 0.02, quat: 5, color: 5, freed: 3 },
    { name: "frees 3 bits: rotation 4 bits per component", pos: 13, zStep: 0.02, quat: 4, color: 6, freed: 3 },
    { name: "frees 3 bits: position 12 bits, height 4 cm", pos: 12, zStep: 0.04, quat: 5, color: 6, freed: 3 },
  ].map((v): Variant => ({
    name: `class room: ${v.name}`, bitsSaved: `${v.freed}`,
    apply: (s, zMin) => {
      const q = quantQuat(s, v.quat);
      const pos = (x: number) => Math.min((2 ** v.pos - 1) / 2 ** v.pos, Math.round(x * 2 ** v.pos) / 2 ** v.pos);
      return { ...q, x: pos(s.x), y: pos(s.y), z: zMin + Math.round((s.z - zMin) / v.zStep) * v.zStep,
        sx: quantScale(s.sx, 6), sy: quantScale(s.sy, 6), sz: quantScale(s.sz, 6),
        r: quantColor(s.r, v.color), g: quantColor(s.g, v.color), b: quantColor(s.b, v.color) };
    },
  })),
];

// Range of the scale codes (10 steps per octave) per tile: how many octaves a block's three scales span.
{
  const lg = (v: number) => Math.log2(v);
  const rows = tiles.map((t) => {
    const all = t.splats.flatMap((p) => [lg(p.sx), lg(p.sy), lg(p.sz)]).sort((a, b) => a - b);
    const at = (f: number) => all[Math.min(all.length - 1, Math.floor(f * all.length))]!;
    return { tile: `${z}/${t.x}/${t.y}`, "min log2 m": +all[0]!.toFixed(1), "p0.1": +at(0.001).toFixed(1), "p99.9": +at(0.999).toFixed(1), "max": +all[all.length - 1]!.toFixed(1), "octaves (min..max)": +(all[all.length - 1]! - all[0]!).toFixed(1) };
  });
  console.log("scale range per tile (log2 of metres):");
  console.table(rows);
}

const defaultViews = "138.939214,34.790766,16.63,128.7,67;138.9392956,34.7917627,18.5,-30,60;138.9392956,34.7917627,17.5,0,0";
const viewSpecs = (viewsArg ?? defaultViews).split(";").map((v) => v.split(",").map(Number) as [number, number, number, number, number]);

const build = (v: Variant): TileInstances[] => tiles.map((t) => {
  let zMin = Infinity;
  for (const s of t.splats) if (s.z < zMin) zMin = s.z;
  return { tile: { z, x: t.x, y: t.y }, instances: splatInstances(t.splats.map((s) => v.apply(s, zMin))) };
});

// Camera height: the median height of the original splats near the view centre (as measure-quality does, roughly).
const heights = tiles.flatMap((t) => t.splats.map((s) => s.z)).sort((a, b) => a - b);
const centreZ = heights[heights.length >> 1]!;
const views: View[] = viewSpecs.map(([lng, lat, zoom, bearing, pitch]) => ({ lng, lat, zoom, bearing, pitch, width: 800, height: 600, centreZ }));
const base = build(variants[0]!);
const refs = views.map((v) => renderTiles(base, v));

const rows: Array<Record<string, string | number>> = [];
for (const variant of variants.slice(1)) {
  const inst = build(variant);
  const per = views.map((v, i) => compareImages(refs[i]!, renderTiles(inst, v), 4));
  rows.push({
    variant: variant.name, "bits saved per splat": variant.bitsSaved,
    "mae (worst of views)": +Math.max(...per.map((c) => c.mae)).toFixed(2),
    "psnr dB (worst)": +Math.min(...per.map((c) => c.psnr)).toFixed(1),
    "holes % (worst)": +(100 * Math.max(...per.map((c) => c.holes))).toFixed(2),
  });
}
console.log(`${dir} z${zoomArg}: ${tiles.length} tiles, ${tiles.reduce((n, t) => n + t.splats.length, 0)} splats, ${views.length} views, block 4, centre height ${centreZ.toFixed(1)} m`);
console.table(rows);
