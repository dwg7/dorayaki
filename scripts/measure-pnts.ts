/**
 * Size of a LAS file's points as 3D Tiles point tiles would carry them (documents/size-vs-3d-tiles.md).
 *
 * Takes 3 x 3 cells of 256 m x 256 m (about a z17 tile) in the middle of the file's extent and, per point, counts
 * the bytes of: LAS format 2; the `.pnts` layout the public Open Nagasaki 3D Tiles use (POSITION float32 x 3 plus RGB 8 bits x 3, 15 bytes,
 * measured on that dataset); the same with 16-bit quantized positions (9 bytes); each raw, gzip -6 and brotli 9, in file order and in Morton
 * order. It builds the arrays in memory per cell and compresses them; it does not write tiles and does not run Draco or meshopt.
 *
 * Usage: node measure-pnts.mjs <file.las> [cell metres, default 256]
 */
import { readFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

import { readLas } from "../src/pointcloud/las.js";

const [file, cellArg] = process.argv.slice(2);
if (!file) throw new Error("usage: measure-pnts <file.las> [cell metres]");
const cell = cellArg ? Number(cellArg) : 256;
const p = readLas(new Uint8Array(readFileSync(file)));
if (!p.rgb) throw new Error("the file has no RGB");

/** 3 x 10 bits interleaved. */
function morton(x: number, y: number, z: number): bigint {
  let k = 0n;
  for (let b = 0; b < 10; b++) {
    k |= (BigInt((x >> b) & 1) << BigInt(3 * b)) | (BigInt((y >> b) & 1) << BigInt(3 * b + 1)) | (BigInt((z >> b) & 1) << BigInt(3 * b + 2));
  }
  return k;
}
const brotli = (b: Uint8Array) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;

const lasRecordBytes = ({ 0: 20, 1: 28, 2: 26, 3: 34 } as Record<number, number>)[p.pointFormat]!;
const x0 = p.min[0] + 20, y0 = p.min[1] + 20;
const total: Record<string, number> = {};
const add = (name: string, bytes: number): void => { total[name] = (total[name] ?? 0) + bytes; };
let points = 0, cells = 0;
for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) {
  const xa = x0 + cx * cell, ya = y0 + cy * cell;
  const idx: number[] = [];
  for (let i = 0; i < p.count; i++) if (p.x[i]! >= xa && p.x[i]! < xa + cell && p.y[i]! >= ya && p.y[i]! < ya + cell) idx.push(i);
  if (idx.length < 1000) continue;
  cells++;
  const n = idx.length;
  let zmin = Infinity, zmax = -Infinity;
  for (const i of idx) { zmin = Math.min(zmin, p.z[i]!); zmax = Math.max(zmax, p.z[i]!); }
  const zr = Math.max(zmax - zmin, 1e-6);
  const key = (i: number) => morton(Math.floor(((p.x[i]! - xa) / cell) * 1023), Math.floor(((p.y[i]! - ya) / cell) * 1023), Math.floor(((p.z[i]! - zmin) / zr) * 1023));
  const keyed = idx.map((i) => ({ i, k: key(i) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((e) => e.i);
  const rgbOf = (order: number[]) => { const rgb = new Uint8Array(n * 3); order.forEach((i, k) => { rgb[3 * k] = p.rgb![3 * i]! >> 8; rgb[3 * k + 1] = p.rgb![3 * i + 1]! >> 8; rgb[3 * k + 2] = p.rgb![3 * i + 2]! >> 8; }); return rgb; };
  const pnts = (order: number[]) => {
    const pos = new Float32Array(n * 3);
    order.forEach((i, k) => { pos[3 * k] = p.x[i]! - xa; pos[3 * k + 1] = p.y[i]! - ya; pos[3 * k + 2] = p.z[i]! - zmin; });
    const out = new Uint8Array(n * 15); out.set(new Uint8Array(pos.buffer), 0); out.set(rgbOf(order), n * 12); return out;
  };
  const quant = (order: number[]) => {
    const pos = new Uint16Array(n * 3);
    order.forEach((i, k) => { pos[3 * k] = Math.round(((p.x[i]! - xa) / cell) * 65535); pos[3 * k + 1] = Math.round(((p.y[i]! - ya) / cell) * 65535); pos[3 * k + 2] = Math.round(((p.z[i]! - zmin) / zr) * 65535); });
    const out = new Uint8Array(n * 9); out.set(new Uint8Array(pos.buffer), 0); out.set(rgbOf(order), n * 6); return out;
  };
  points += n;
  add(`LAS format ${p.pointFormat}`, n * lasRecordBytes);
  for (const [label, build] of [["pnts float32+rgb", pnts], ["u16+rgb", quant]] as const) {
    const file = build(idx), sorted = build(keyed);
    add(`${label} raw`, file.length);
    add(`${label} + gzip -6`, gzipSync(file, { level: 6 }).length);
    add(`${label} + brotli 9`, brotli(file));
    add(`${label} + gzip -6, Morton order`, gzipSync(sorted, { level: 6 }).length);
    add(`${label} + brotli 9, Morton order`, brotli(sorted));
  }
}
console.log(`${file}: ${cells} cells of ${cell} m, ${points} points`);
for (const [name, bytes] of Object.entries(total)) console.log(`${name.padEnd(40)} ${(bytes / points).toFixed(2)} B/pt`);
