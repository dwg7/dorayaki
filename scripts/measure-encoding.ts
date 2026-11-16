/**
 * E016: where the bytes of a tile go, and what a better encoding could save. For every tile of one zoom of a tileset
 * it reports, per field, the zero-order entropy (bits per splat; an adaptive entropy coder per tile would approach it)
 * of the stored value and of simple transforms of it, and the size of the whole block under gzip and brotli as stored
 * and with the fields rearranged for a general-purpose compressor.
 *
 *   npm run measure:encoding -- <tileset dir> <zoom>
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

import { extractSurfelBlocks } from "../src/mlt-frame.js";
import { packedSurfelBlock, unpackQuaternion } from "../src/surfel-block.js";

const [dir, zoomArg] = process.argv.slice(2);
if (!dir || !zoomArg) { console.error("usage: measure-encoding <tileset dir> <zoom>"); process.exit(1); }

/** Zero-order entropy in bits of a symbol sequence, in total (not per symbol). */
function entropyBits(symbols: ArrayLike<number>): number {
  const counts = new Map<number, number>();
  for (let i = 0; i < symbols.length; i++) counts.set(symbols[i]!, (counts.get(symbols[i]!) ?? 0) + 1);
  let bits = 0;
  const n = symbols.length;
  for (const c of counts.values()) bits -= c * Math.log2(c / n);
  return bits;
}
const gz = (b: Uint8Array) => gzipSync(b, { level: 9 }).byteLength;
const br = (b: Uint8Array) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: b.byteLength } }).byteLength;

const files: string[] = [];
const zdir = join(dir, zoomArg);
for (const xs of readdirSync(zdir)) for (const f of readdirSync(join(zdir, xs))) if (f.endsWith(".mlt")) files.push(join(zdir, xs, f));

const fields = ["x row (y >> 7)", "x col (x >> 7)", "y sub-cell (y & 127)", "x sub-cell (x & 127)", "row delta", "col delta (same row: delta, else col)",
  "z (u16)", "z delta to previous", "scale x", "scale y", "scale z", "scale y - x", "scale z - x", "quat largest", "quat a", "quat b", "quat c",
  "r", "g", "b", "g - r", "b - r", "alpha"] as const;
const bits = new Map<string, number>(fields.map((f) => [f, 0]));
let splats = 0, rawBytes = 0, asStoredGz = 0, asStoredBr = 0, rearrangedGz = 0, rearrangedBr = 0;
const planeBits = new Array<number>(16).fill(0);

for (const f of files) {
  const tile = new Uint8Array(readFileSync(f));
  const p = packedSurfelBlock(extractSurfelBlocks(tile)[0]!);
  const n = p.count, r = p.records;
  splats += n; rawBytes += tile.byteLength;
  const get = (i: number, b: number) => r[i * 16 + b]!;
  const X = new Uint16Array(n), Y = new Uint16Array(n), Z = new Uint16Array(n);
  for (let i = 0; i < n; i++) { X[i] = get(i, 0) | (get(i, 1) << 8); Y[i] = get(i, 2) | (get(i, 3) << 8); Z[i] = get(i, 4) | (get(i, 5) << 8); }
  const col = (name: string, a: ArrayLike<number>) => bits.set(name, bits.get(name)! + entropyBits(a));

  const row = Y.map((v) => v >> 7), cl = X.map((v) => v >> 7);
  const rowDelta = new Int32Array(n), colDelta = new Int32Array(n), zDelta = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    rowDelta[i] = i ? row[i]! - row[i - 1]! : row[i]!;
    colDelta[i] = i && row[i] === row[i - 1] ? cl[i]! - cl[i - 1]! : cl[i]!;
    zDelta[i] = i ? Z[i]! - Z[i - 1]! : Z[i]!;
  }
  col("x row (y >> 7)", row); col("x col (x >> 7)", cl);
  col("y sub-cell (y & 127)", Y.map((v) => v & 127)); col("x sub-cell (x & 127)", X.map((v) => v & 127));
  col("row delta", rowDelta); col("col delta (same row: delta, else col)", colDelta);
  col("z (u16)", Z); col("z delta to previous", zDelta);
  const sx = new Uint8Array(n), sy = new Uint8Array(n), sz = new Uint8Array(n);
  const qL = new Uint8Array(n), qa = new Uint8Array(n), qb = new Uint8Array(n), qc = new Uint8Array(n);
  const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n), A = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    sx[i] = get(i, 6); sy[i] = get(i, 7); sz[i] = get(i, 8);
    const q = get(i, 9) | (get(i, 10) << 8) | (get(i, 11) << 16);
    qL[i] = q & 3; qa[i] = (q >> 2) & 127; qb[i] = (q >> 9) & 127; qc[i] = (q >> 16) & 127;
    R[i] = get(i, 12); G[i] = get(i, 13); B[i] = get(i, 14); A[i] = get(i, 15);
  }
  void unpackQuaternion;
  col("scale x", sx); col("scale y", sy); col("scale z", sz);
  col("scale y - x", sy.map((v, i) => (v - sx[i]!) & 255)); col("scale z - x", sz.map((v, i) => (v - sx[i]!) & 255));
  col("quat largest", qL); col("quat a", qa); col("quat b", qb); col("quat c", qc);
  col("r", R); col("g", G); col("b", B); col("g - r", G.map((v, i) => (v - R[i]!) & 255)); col("b - r", B.map((v, i) => (v - R[i]!) & 255)); col("alpha", A);
  for (let b = 0; b < 16; b++) planeBits[b]! += entropyBits(Uint8Array.from({ length: n }, (_, i) => get(i, b)));

  // The block as stored (planes), and the same fields rearranged for a general-purpose compressor.
  asStoredGz += gz(tile); asStoredBr += br(tile);
  const planes: Uint8Array[] = [
    Uint8Array.from(rowDelta, (v) => v & 255), Uint8Array.from(colDelta, (v) => v & 255),
    Uint8Array.from(Y, (v) => v & 127), Uint8Array.from(X, (v) => v & 127),
    Uint8Array.from(zDelta, (v) => v & 255), Uint8Array.from(zDelta, (v) => (v >> 8) & 255),
    sx, sy.map((v, i) => (v - sx[i]!) & 255), sz.map((v, i) => (v - sx[i]!) & 255),
    qL, qa, qb, qc, R, G.map((v, i) => (v - R[i]!) & 255), B.map((v, i) => (v - R[i]!) & 255),
  ];
  const joined = new Uint8Array(planes.reduce((s, a) => s + a.length, 0));
  let o = 0; for (const a of planes) { joined.set(a, o); o += a.length; }
  rearrangedGz += gz(joined); rearrangedBr += br(joined);
}

const per = (b: number) => +(b / splats).toFixed(2);
console.log(`${dir} z${zoomArg}: ${files.length} tiles, ${splats} splats, ${rawBytes} bytes stored (${(rawBytes / splats).toFixed(2)} bytes per splat)`);
console.table([...bits.entries()].map(([field, b]) => ({ field, "bits per splat": per(b) })));
console.log("stored byte planes, zero-order entropy per plane (bits per byte):", planeBits.map((b) => +(b / splats).toFixed(2)).join(" "));
const sum = (names: string[]) => names.reduce((s, nme) => s + bits.get(nme)!, 0) / splats;
console.log("ideal bits per splat (zero-order, per tile):");
console.log("  as stored fields (x,y,z as u16 bytes; scales; quat; rgb; alpha):", +(planeBits.reduce((a, b) => a + b, 0) / splats).toFixed(1), "of 128");
console.log("  rearranged (row delta, col delta, sub-cell x y, z delta, scale x and differences, quat fields, r, g-r, b-r, alpha):",
  +sum(["row delta", "col delta (same row: delta, else col)", "y sub-cell (y & 127)", "x sub-cell (x & 127)", "z delta to previous", "scale x", "scale y - x", "scale z - x", "quat largest", "quat a", "quat b", "quat c", "r", "g - r", "b - r", "alpha"]).toFixed(1), "bits");
console.table([
  { form: "as stored (planes)", gzip: asStoredGz, "gzip bytes/splat": +(asStoredGz / splats).toFixed(2), brotli: asStoredBr, "brotli bytes/splat": +(asStoredBr / splats).toFixed(2) },
  { form: "rearranged planes", gzip: rearrangedGz, "gzip bytes/splat": +(rearrangedGz / splats).toFixed(2), brotli: rearrangedBr, "brotli bytes/splat": +(rearrangedBr / splats).toFixed(2) },
]);
