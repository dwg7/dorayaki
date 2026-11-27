/**
 * Surfel Block codec (experimental; version 6 only since the compaction of 2026-11-27: earlier versions are not read).
 *
 * Each record is a quantized anisotropic Gaussian splat of 12 bytes, the kind of primitive 3D Gaussian Splatting
 * uses. See documents/surfel-block-format.md for the byte layout. All multi-byte values are little-endian. This
 * module has no dependency on MapLibre, MLT, or any runtime other than ECMAScript typed arrays.
 */

/**
 * A circular surfel: a flat disc. This is a convenience description used
 * by the synthetic fixtures; it is not what a block stores. Convert with
 * `surfelToSplat` (src/splat.ts) before encoding.
 *
 * Frame: x, y tile-local (x east, y south); z orthometric height (標高,
 * metres above the geoid); the normal is a unit vector in the local
 * metric frame (east, south, up); radius is metres.
 */
export interface Surfel {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** Metres. */
  radius: number;
  /** Color channels, each an integer in 0..255. */
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * What a block stores: an anisotropic Gaussian splat.
 *
 * x, y are tile-local in [0, 1) (x east, y south), z is orthometric height
 * in metres. (sx, sy, sz) are standard deviations in metres along the three
 * local axes, and (qw, qx, qy, qz) is the unit quaternion that rotates the
 * local axes into the tile's metric frame (east, south, up). A splat is
 * drawn as the 2-sigma ellipse in the plane of its two longer axes; the
 * shortest axis is its normal. Equal scales mean no preferred orientation
 * (a round blob).
 */
export interface Splat {
  /** Tile-local, 0 = west edge, 1 = east edge (exclusive). */
  x: number;
  /** Tile-local, 0 = north edge, 1 = south edge (exclusive). */
  y: number;
  /** Orthometric height (標高): metres above the geoid. */
  z: number;
  /** Standard deviations in metres along the local axes. */
  sx: number;
  sy: number;
  sz: number;
  /** Unit quaternion, local axes -> (east, south, up). */
  qw: number;
  qx: number;
  qy: number;
  qz: number;
  /** Color channels, each an integer in 0..255. a is opacity. */
  r: number;
  g: number;
  b: number;
  a: number;
}

/** ASCII "DSRF". */
export const SURFEL_BLOCK_MAGIC = Uint8Array.of(0x44, 0x53, 0x52, 0x46);
/** The one version written and read. Versions 1 to 5 are in Git history (tag pre-compaction-2026-11-27). */
export const SURFEL_BLOCK_VERSION = 6;
/** Fixed part of the header; the level table (4 bytes per level) follows it. */
export const SURFEL_BLOCK_HEADER_BYTES = 40;
/** Bytes per record. */
export const SURFEL_RECORD_BYTES = 12;
/** Bit offset and width of each field of a record, counted from the least significant bit of the little-endian record. */
export const RECORD_FIELDS = {
  x: { off: 0, len: 13 }, y: { off: 13, len: 13 }, z: { off: 26, len: 14 },
  sx: { off: 40, len: 7 }, sy: { off: 47, len: 7 }, sz: { off: 54, len: 7 },
  quat: { off: 61, len: 17 },
  r: { off: 78, len: 6 }, g: { off: 84, len: 6 }, b: { off: 90, len: 6 },
} as const;
/** Scale code c (0..127) means 2^(scaleLog2Min + c / SCALE_STEPS_PER_OCTAVE) metres, scaleLog2Min from the header. */
export const SCALE_STEPS_PER_OCTAVE = 6;
/** Bits per stored quaternion component ("smallest three": 2 + 3 x 5 = 17 bits). */
export const QUAT_COMPONENT_BITS = 5;
/** Upper bound on the level table size (a sanity limit, not a format need). */
export const MAX_LEVELS = 64;
/** Smallest vertical step of the z grid, metres. Widened automatically for tall tiles. */
export const Z_STEP_METRES = 0.001;

const LITTLE_ENDIAN = true;
const MAX_COUNT = 0xffffffff;
/** Largest value of a quaternion component other than the largest one. */
const QUAT_RANGE = Math.SQRT1_2;

export type SurfelBlockErrorCode =
  | "TRUNCATED_HEADER"
  | "BAD_MAGIC"
  | "UNSUPPORTED_VERSION"
  | "BAD_RECORD_SIZE"
  | "TRUNCATED_RECORDS"
  | "TRAILING_BYTES"
  | "INVALID_VALUE"
  | "TOO_MANY_SURFELS"
  | "BAD_LEVELS";

export class SurfelBlockError extends Error {
  readonly code: SurfelBlockErrorCode;

  constructor(code: SurfelBlockErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "SurfelBlockError";
    this.code = code;
  }
}

/** Byte length of an encoded block holding `count` splats in `levelCount` levels. */
export function surfelBlockByteLength(count: number, levelCount = 1): number {
  return SURFEL_BLOCK_HEADER_BYTES + 4 * levelCount + SURFEL_RECORD_BYTES * count;
}

/** A decoded block: splats in stored order and the level table. */
export interface SurfelBlock {
  splats: Splat[];
  /**
   * Splat count per level, in stored order; they sum to splats.length.
   * Levels are consecutive runs of records: level 0 first. A reader may
   * draw any prefix of whole levels, or ignore the table and draw all.
   */
  levels: number[];
}

function checkLevels(levels: readonly number[], count: number): void {
  if (levels.length < 1 || levels.length > MAX_LEVELS) {
    throw new SurfelBlockError("BAD_LEVELS", `level count ${levels.length} not in 1..${MAX_LEVELS}`);
  }
  let sum = 0;
  for (const n of levels) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) throw new SurfelBlockError("BAD_LEVELS", `invalid level size ${n}`);
    sum += n;
  }
  if (sum !== count) throw new SurfelBlockError("BAD_LEVELS", `level sizes sum to ${sum}, count is ${count}`);
}

function validateSplat(s: Splat, index: number): void {
  for (const field of ["x", "y", "z", "sx", "sy", "sz", "qw", "qx", "qy", "qz"] as const) {
    if (typeof s[field] !== "number" || !Number.isFinite(s[field])) {
      throw new SurfelBlockError("INVALID_VALUE", `splat ${index}: ${field} must be a finite number`);
    }
  }
  if (!(s.x >= 0 && s.x < 1 && s.y >= 0 && s.y < 1)) {
    throw new SurfelBlockError("INVALID_VALUE", `splat ${index}: x, y must be in [0, 1), got (${s.x}, ${s.y})`);
  }
  if (!(s.sx > 0 && s.sy > 0 && s.sz > 0)) {
    throw new SurfelBlockError("INVALID_VALUE", `splat ${index}: scales must be > 0`);
  }
  if (!(Math.hypot(s.qw, s.qx, s.qy, s.qz) > 0)) {
    throw new SurfelBlockError("INVALID_VALUE", `splat ${index}: quaternion must be non-zero`);
  }
  for (const field of ["r", "g", "b", "a"] as const) {
    const v = s[field];
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new SurfelBlockError("INVALID_VALUE", `splat ${index}: ${field} must be an integer in 0..255`);
    }
  }
}

/**
 * Pack a unit quaternion ("smallest three"): bits 0-1 hold the index of the largest component, then the other three
 * (w, x, y, z order, largest skipped) at `componentBits` bits each: codes 0..2h over [-1/sqrt2, 1/sqrt2] with h =
 * 2^(componentBits - 1) - 1 and code h = 0 (so the identity and every axis-aligned rotation are exact). q and -q are the
 * same rotation, so the largest component is made non-negative.
 */
export function packQuaternion(qw: number, qx: number, qy: number, qz: number, componentBits: number = QUAT_COMPONENT_BITS): number {
  const half = 2 ** (componentBits - 1) - 1;
  const len = Math.hypot(qw, qx, qy, qz);
  const q = [qw / len, qx / len, qy / len, qz / len];
  let largest = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]!) > Math.abs(q[largest]!)) largest = i;
  const sign = q[largest]! < 0 ? -1 : 1;
  // The three stored components, scaled to code units, and the target they approximate.
  const others = [0, 1, 2, 3].filter((i) => i !== largest);
  const target = others.map((i) => sign * q[i]!);
  const exact = target.map((v) => Math.min(QUAT_RANGE, Math.max(-QUAT_RANGE, v)) / QUAT_RANGE * half + half);
  // Rounding each code up or down gives 8 candidates. The largest component is rebuilt from the other three, so its
  // error can be several times theirs when it is small (for example all four components near 0.5). Keep the candidate
  // whose rebuilt quaternion is closest to the target.
  let bestDot = -Infinity;
  let bestCodes = [0, 0, 0];
  for (let mask = 0; mask < 8; mask++) {
    const codes = exact.map((c, k) => Math.min(2 * half, Math.max(0, Math.floor(c) + ((mask >> k) & 1))));
    const vals = codes.map((c) => ((c - half) / half) * QUAT_RANGE);
    const big = Math.sqrt(Math.max(0, 1 - vals[0]! ** 2 - vals[1]! ** 2 - vals[2]! ** 2));
    const norm = Math.hypot(big, vals[0]!, vals[1]!, vals[2]!);
    const dot = (big * Math.abs(q[largest]!) + vals[0]! * target[0]! + vals[1]! * target[1]! + vals[2]! * target[2]!) / norm;
    if (dot > bestDot) { bestDot = dot; bestCodes = codes; }
  }
  let bits = largest;
  let shift = 2;
  for (const code of bestCodes) {
    bits |= code << shift;
    shift += componentBits;
  }
  return bits;
}

/** Inverse of packQuaternion. Throws on an unused code. */
export function unpackQuaternion(bits: number, componentBits: number = QUAT_COMPONENT_BITS): [number, number, number, number] {
  const half = 2 ** (componentBits - 1) - 1;
  const largest = bits & 3;
  const q = [0, 0, 0, 0];
  let shift = 2;
  let sumSq = 0;
  for (let i = 0; i < 4; i++) {
    if (i === largest) continue;
    const code = (bits >> shift) & ((1 << componentBits) - 1);
    if (code > 2 * half) throw new SurfelBlockError("INVALID_VALUE", `quaternion code ${code} is unused`);
    const v = ((code - half) / half) * QUAT_RANGE;
    q[i] = v;
    sumSq += v * v;
    shift += componentBits;
  }
  q[largest] = Math.sqrt(Math.max(0, 1 - sumSq));
  const len = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
  return [q[0]! / len, q[1]! / len, q[2]! / len, q[3]! / len];
}

function putBits(buf: Uint8Array, base: number, off: number, len: number, value: number): void {
  for (let i = 0; i < len; i++) if ((value >> i) & 1) buf[base + ((off + i) >> 3)]! |= 1 << ((off + i) & 7);
}

/** `len` bits at bit `off` of the record starting at byte `base` (little-endian, least significant bit first). */
export function readBits(buf: Uint8Array, base: number, off: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v |= ((buf[base + ((off + i) >> 3)]! >> ((off + i) & 7)) & 1) << i;
  return v;
}

/**
 * Encode splats into a Surfel Block. `levels` is the level table (splat count per level, in order; default one level).
 *
 * Quantization (documents/surfel-block-format.md): x, y to 1/8192 of the tile; z to a per-block step of at least 1 mm,
 * wide enough for 14 bits, from the block's lowest z; scales to 6 steps per octave from the block's smallest scale (7 bits;
 * larger scales clamp at 21 octaves above it); rotation to 17 bits; color to 6 bits per channel; one opacity for the whole
 * block (splats with different opacities are rejected). Decoding returns values within those tolerances, not the input.
 */
export function encodeSurfelBlock(splats: readonly Splat[], levels: readonly number[] = [splats.length]): Uint8Array {
  const count = splats.length;
  if (count > MAX_COUNT) throw new SurfelBlockError("TOO_MANY_SURFELS", `count ${count} exceeds uint32`);
  checkLevels(levels, count);
  splats.forEach(validateSplat);
  const alpha = count > 0 ? splats[0]!.a : 255;
  if (splats.some((s) => s.a !== alpha)) throw new SurfelBlockError("INVALID_VALUE", "a block stores one opacity; the splats differ");

  let zMin = Infinity, zMax = -Infinity, minLog2 = Infinity;
  for (const s of splats) {
    if (s.z < zMin) zMin = s.z;
    if (s.z > zMax) zMax = s.z;
    minLog2 = Math.min(minLog2, Math.log2(s.sx), Math.log2(s.sy), Math.log2(s.sz));
  }
  if (count === 0) { zMin = zMax = 0; minLog2 = 0; }
  const F = RECORD_FIELDS;
  const zSteps = 2 ** F.z.len - 1;
  const zStep = Math.max(Z_STEP_METRES, Math.ceil(((zMax - zMin) / zSteps) * 1000 + 1e-9) / 1000);
  const scaleBase = Math.fround(minLog2);

  const bytes = new Uint8Array(surfelBlockByteLength(count, levels.length));
  const view = new DataView(bytes.buffer);
  bytes.set(SURFEL_BLOCK_MAGIC, 0);
  view.setUint16(4, SURFEL_BLOCK_VERSION, LITTLE_ENDIAN);
  view.setUint16(6, SURFEL_RECORD_BYTES, LITTLE_ENDIAN);
  view.setUint32(8, count, LITTLE_ENDIAN);
  view.setUint32(12, levels.length, LITTLE_ENDIAN);
  view.setFloat64(16, zMin, LITTLE_ENDIAN);
  view.setFloat64(24, zStep, LITTLE_ENDIAN);
  view.setFloat32(32, scaleBase, LITTLE_ENDIAN);
  bytes[36] = alpha;
  levels.forEach((n, k) => view.setUint32(SURFEL_BLOCK_HEADER_BYTES + 4 * k, n, LITTLE_ENDIAN));

  const xyMax = 2 ** F.x.len - 1;
  const scaleMax = 2 ** F.sx.len - 1;
  const colorMax = 2 ** F.r.len - 1;
  const code = (metres: number) => Math.min(scaleMax, Math.max(0, Math.round((Math.log2(metres) - scaleBase) * SCALE_STEPS_PER_OCTAVE)));
  const color = (c: number) => Math.round((c * colorMax) / 255);
  const base = SURFEL_BLOCK_HEADER_BYTES + 4 * levels.length;
  splats.forEach((s, i) => {
    const o = base + i * SURFEL_RECORD_BYTES;
    putBits(bytes, o, F.x.off, F.x.len, Math.min(xyMax, Math.round(s.x * (xyMax + 1))));
    putBits(bytes, o, F.y.off, F.y.len, Math.min(xyMax, Math.round(s.y * (xyMax + 1))));
    putBits(bytes, o, F.z.off, F.z.len, Math.min(zSteps, Math.round((s.z - zMin) / zStep)));
    putBits(bytes, o, F.sx.off, F.sx.len, code(s.sx));
    putBits(bytes, o, F.sy.off, F.sy.len, code(s.sy));
    putBits(bytes, o, F.sz.off, F.sz.len, code(s.sz));
    putBits(bytes, o, F.quat.off, F.quat.len, packQuaternion(s.qw, s.qx, s.qy, s.qz));
    putBits(bytes, o, F.r.off, F.r.len, color(s.r));
    putBits(bytes, o, F.g.off, F.g.len, color(s.g));
    putBits(bytes, o, F.b.off, F.b.len, color(s.b));
  });
  return bytes;
}

/** A block's header, validated, with where its records start. */
export interface SurfelBlockLayout {
  count: number;
  levels: number[];
  zOrigin: number;
  zStep: number;
  /** Byte offset of the first record. */
  tableEnd: number;
  /** log2 of the metres of scale code 0. */
  scaleLog2Min: number;
  /** The block's one opacity, 0..255. */
  alpha: number;
}

/**
 * Validate a Surfel Block's header, level table and length. The input must contain exactly one block: header, level
 * table, and `count` records, with no trailing bytes. Any violation throws SurfelBlockError; nothing is read outside `bytes`.
 */
export function readSurfelBlockLayout(bytes: Uint8Array): SurfelBlockLayout {
  if (bytes.byteLength < 8) throw new SurfelBlockError("TRUNCATED_HEADER", `need ${SURFEL_BLOCK_HEADER_BYTES} header bytes, got ${bytes.byteLength}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < SURFEL_BLOCK_MAGIC.length; i++) {
    if (bytes[i] !== SURFEL_BLOCK_MAGIC[i]) throw new SurfelBlockError("BAD_MAGIC", "magic is not \"DSRF\"");
  }
  const version = view.getUint16(4, LITTLE_ENDIAN);
  if (version !== SURFEL_BLOCK_VERSION) throw new SurfelBlockError("UNSUPPORTED_VERSION", `version ${version}, expected ${SURFEL_BLOCK_VERSION}`);
  if (bytes.byteLength < SURFEL_BLOCK_HEADER_BYTES) {
    throw new SurfelBlockError("TRUNCATED_HEADER", `need ${SURFEL_BLOCK_HEADER_BYTES} header bytes, got ${bytes.byteLength}`);
  }
  const recordBytes = view.getUint16(6, LITTLE_ENDIAN);
  if (recordBytes !== SURFEL_RECORD_BYTES) throw new SurfelBlockError("BAD_RECORD_SIZE", `record size ${recordBytes}, expected ${SURFEL_RECORD_BYTES}`);
  const scaleLog2Min = view.getFloat32(32, LITTLE_ENDIAN);
  if (!Number.isFinite(scaleLog2Min)) throw new SurfelBlockError("INVALID_VALUE", `scale base ${scaleLog2Min} is invalid`);
  const alpha = bytes[36]!;
  const count = view.getUint32(8, LITTLE_ENDIAN);
  const levelCount = view.getUint32(12, LITTLE_ENDIAN);
  if (levelCount < 1 || levelCount > MAX_LEVELS) throw new SurfelBlockError("BAD_LEVELS", `level count ${levelCount} not in 1..${MAX_LEVELS}`);
  const zOrigin = view.getFloat64(16, LITTLE_ENDIAN);
  const zStep = view.getFloat64(24, LITTLE_ENDIAN);
  if (!Number.isFinite(zOrigin) || !(Number.isFinite(zStep) && zStep > 0)) {
    throw new SurfelBlockError("INVALID_VALUE", `z origin ${zOrigin} or step ${zStep} is invalid`);
  }
  const tableEnd = SURFEL_BLOCK_HEADER_BYTES + 4 * levelCount;
  if (bytes.byteLength < tableEnd) throw new SurfelBlockError("TRUNCATED_HEADER", `level table needs ${tableEnd} bytes, got ${bytes.byteLength}`);
  const levels = Array.from({ length: levelCount }, (_, k) => view.getUint32(SURFEL_BLOCK_HEADER_BYTES + 4 * k, LITTLE_ENDIAN));
  const expected = surfelBlockByteLength(count, levelCount);
  if (bytes.byteLength < expected) throw new SurfelBlockError("TRUNCATED_RECORDS", `count ${count} needs ${expected} bytes, got ${bytes.byteLength}`);
  if (bytes.byteLength > expected) throw new SurfelBlockError("TRAILING_BYTES", `count ${count} needs ${expected} bytes, got ${bytes.byteLength}`);
  checkLevels(levels, count);
  return { count, levels, zOrigin, zStep, tableEnd, scaleLog2Min, alpha };
}

/** Decode a Surfel Block, ignoring its level table. */
export function decodeSurfelBlock(bytes: Uint8Array): Splat[] {
  return decodeSurfelBlockWithLevels(bytes).splats;
}

/** Decode a Surfel Block with its level table (see readSurfelBlockLayout for what is validated). */
export function decodeSurfelBlockWithLevels(bytes: Uint8Array): SurfelBlock {
  const { count, levels, zOrigin, zStep, tableEnd, scaleLog2Min, alpha } = readSurfelBlockLayout(bytes);
  const F = RECORD_FIELDS;
  const xyScale = 2 ** F.x.len;
  const colorMax = 2 ** F.r.len - 1;
  const splats: Splat[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = tableEnd + i * SURFEL_RECORD_BYTES;
    const [qw, qx, qy, qz] = unpackQuaternion(readBits(bytes, o, F.quat.off, F.quat.len));
    const scale = (f: { off: number; len: number }) => 2 ** (scaleLog2Min + readBits(bytes, o, f.off, f.len) / SCALE_STEPS_PER_OCTAVE);
    const color = (f: { off: number; len: number }) => Math.round((readBits(bytes, o, f.off, f.len) * 255) / colorMax);
    splats[i] = {
      x: readBits(bytes, o, F.x.off, F.x.len) / xyScale,
      y: readBits(bytes, o, F.y.off, F.y.len) / xyScale,
      z: Math.fround(zOrigin + readBits(bytes, o, F.z.off, F.z.len) * zStep),
      sx: scale(F.sx), sy: scale(F.sy), sz: scale(F.sz),
      qw, qx, qy, qz,
      r: color(F.r), g: color(F.g), b: color(F.b), a: alpha,
    };
  }
  return { splats, levels };
}

/** A block's records as they are (for uploading to the GPU without making Splat objects). */
export interface PackedBlock {
  count: number;
  levels: number[];
  zOrigin: number;
  zStep: number;
  /** log2 of the metres of scale code 0. */
  scaleLog2Min: number;
  /** count x SURFEL_RECORD_BYTES bytes (RECORD_FIELDS). */
  records: Uint8Array;
}

export function packedSurfelBlock(bytes: Uint8Array): PackedBlock {
  const { count, levels, zOrigin, zStep, tableEnd, scaleLog2Min } = readSurfelBlockLayout(bytes);
  return { count, levels, zOrigin, zStep, scaleLog2Min, records: bytes.slice(tableEnd, tableEnd + count * SURFEL_RECORD_BYTES) };
}
