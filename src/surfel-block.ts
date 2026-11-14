/**
 * Surfel Block codec (experimental, version 4).
 *
 * Each record is a quantized anisotropic Gaussian splat (16 bytes), the
 * kind of primitive 3D Gaussian Splatting uses, instead of the circular
 * disc of versions 1-3. See documents/surfel-block-format.md for the byte
 * layout. All multi-byte values are little-endian. This module has no
 * dependency on MapLibre, MLT, or any runtime other than ECMAScript typed
 * arrays.
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
  /** Colour channels, each an integer in 0..255. */
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
  /** Colour channels, each an integer in 0..255. a is opacity. */
  r: number;
  g: number;
  b: number;
  a: number;
}

/** ASCII "DSRF". */
export const SURFEL_BLOCK_MAGIC = Uint8Array.of(0x44, 0x53, 0x52, 0x46);
export const SURFEL_BLOCK_VERSION = 4;
/** Fixed part of the header; the level table (4 bytes per level) follows it. */
export const SURFEL_BLOCK_HEADER_BYTES = 32;
export const SURFEL_RECORD_BYTES = 16;
/** Upper bound on the level table size (a sanity limit, not a format need). */
export const MAX_LEVELS = 64;

/** Default vertical step of the z grid, metres. Widened automatically for tall tiles. */
export const Z_STEP_METRES = 0.001;
/** Scale code b (0..255) means 2^(SCALE_LOG2_MIN + b / SCALE_STEPS_PER_OCTAVE) metres. */
export const SCALE_LOG2_MIN = -16;
export const SCALE_STEPS_PER_OCTAVE = 10;
/** Representable scale range in metres: about 15 µm .. 724 m. */
export const SCALE_MIN = 2 ** SCALE_LOG2_MIN;
export const SCALE_MAX = 2 ** (SCALE_LOG2_MIN + 255 / SCALE_STEPS_PER_OCTAVE);

const LITTLE_ENDIAN = true;
const MAX_COUNT = 0xffffffff;
/** Largest value of a quaternion component other than the largest one. */
const QUAT_RANGE = Math.SQRT1_2;
/** Codes 0..126 map to [-1/sqrt2, 1/sqrt2] with code 63 = 0; code 127 is unused. */
const QUAT_HALF_STEPS = 63;

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

const COLOR_FIELDS = ["r", "g", "b", "a"] as const;

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
  for (const field of COLOR_FIELDS) {
    const v = s[field];
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new SurfelBlockError("INVALID_VALUE", `splat ${index}: ${field} must be an integer in 0..255`);
    }
  }
}

/** Log-quantize a scale in metres to a code 0..255 (clamped to the representable range). */
export function encodeScale(metres: number): number {
  const code = Math.round((Math.log2(metres) - SCALE_LOG2_MIN) * SCALE_STEPS_PER_OCTAVE);
  return Math.min(255, Math.max(0, code));
}

export function decodeScale(code: number): number {
  return 2 ** (SCALE_LOG2_MIN + code / SCALE_STEPS_PER_OCTAVE);
}

/**
 * Pack a unit quaternion into 24 bits ("smallest three"): bits 0-1 hold
 * the index of the largest component, bits 2-22 the other three components
 * (w, x, y, z order, largest skipped) at 7 bits each: codes 0..126 over
 * [-1/sqrt2, 1/sqrt2] with code 63 = 0 (so the identity and every
 * axis-aligned rotation are exact); bit 23 is zero. q and -q are the same
 * rotation, so the largest component is made non-negative.
 */
export function packQuaternion(qw: number, qx: number, qy: number, qz: number): number {
  const len = Math.hypot(qw, qx, qy, qz);
  const q = [qw / len, qx / len, qy / len, qz / len];
  let largest = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]!) > Math.abs(q[largest]!)) largest = i;
  const sign = q[largest]! < 0 ? -1 : 1;
  // The three stored components, scaled to code units (0..126, 63 = 0), and the target they approximate.
  const others = [0, 1, 2, 3].filter((i) => i !== largest);
  const target = others.map((i) => sign * q[i]!);
  const exact = target.map((v) => Math.min(QUAT_RANGE, Math.max(-QUAT_RANGE, v)) / QUAT_RANGE * QUAT_HALF_STEPS + QUAT_HALF_STEPS);
  // Rounding each code up or down gives 8 candidates. The largest component is
  // rebuilt from the other three, so its error can be several times theirs when
  // it is small (for example all four components near 0.5). Keep the candidate
  // whose rebuilt quaternion is closest to the target.
  let bestDot = -Infinity;
  let bestCodes = [0, 0, 0];
  for (let mask = 0; mask < 8; mask++) {
    const codes = exact.map((c, k) => Math.min(2 * QUAT_HALF_STEPS, Math.max(0, Math.floor(c) + ((mask >> k) & 1))));
    const vals = codes.map((c) => ((c - QUAT_HALF_STEPS) / QUAT_HALF_STEPS) * QUAT_RANGE);
    const big = Math.sqrt(Math.max(0, 1 - vals[0]! ** 2 - vals[1]! ** 2 - vals[2]! ** 2));
    const norm = Math.hypot(big, vals[0]!, vals[1]!, vals[2]!);
    const dot = (big * Math.abs(q[largest]!) + vals[0]! * target[0]! + vals[1]! * target[1]! + vals[2]! * target[2]!) / norm;
    if (dot > bestDot) { bestDot = dot; bestCodes = codes; }
  }
  let bits = largest;
  let shift = 2;
  for (const code of bestCodes) {
    bits |= code << shift;
    shift += 7;
  }
  return bits;
}

/** Inverse of packQuaternion. Throws if the reserved bit 23 is set or a code is 127. */
export function unpackQuaternion(bits: number): [number, number, number, number] {
  if (bits & 0x800000) throw new SurfelBlockError("INVALID_VALUE", "reserved quaternion bit is set");
  const largest = bits & 3;
  const q = [0, 0, 0, 0];
  let shift = 2;
  let sumSq = 0;
  for (let i = 0; i < 4; i++) {
    if (i === largest) continue;
    const code = (bits >> shift) & 0x7f;
    if (code > 2 * QUAT_HALF_STEPS) throw new SurfelBlockError("INVALID_VALUE", "quaternion code 127 is unused");
    const v = ((code - QUAT_HALF_STEPS) / QUAT_HALF_STEPS) * QUAT_RANGE;
    q[i] = v;
    sumSq += v * v;
    shift += 7;
  }
  q[largest] = Math.sqrt(Math.max(0, 1 - sumSq));
  const len = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
  return [q[0]! / len, q[1]! / len, q[2]! / len, q[3]! / len];
}

/**
 * Encode splats into a Surfel Block.
 *
 * `levels` is the level table (splat count per level, in order). It
 * defaults to a single level holding every splat.
 *
 * Quantization (documented in documents/surfel-block-format.md): x, y to
 * 1/65536 of the tile; z to a grid of Z_STEP_METRES (wider if the block's
 * z range exceeds 65,535 steps) from the block's lowest z; scales to a
 * log grid (clamped to 15 µm .. 724 m); rotation to 23 bits. Decoding
 * therefore returns values within those tolerances, not the exact input.
 */
export function encodeSurfelBlock(splats: readonly Splat[], levels: readonly number[] = [splats.length]): Uint8Array {
  const count = splats.length;
  if (count > MAX_COUNT) {
    throw new SurfelBlockError("TOO_MANY_SURFELS", `count ${count} exceeds uint32`);
  }
  checkLevels(levels, count);
  splats.forEach(validateSplat);

  let zMin = Infinity;
  let zMax = -Infinity;
  for (const s of splats) {
    if (s.z < zMin) zMin = s.z;
    if (s.z > zMax) zMax = s.z;
  }
  if (count === 0) zMin = zMax = 0;
  const zStep = Math.max(Z_STEP_METRES, Math.ceil(((zMax - zMin) / 65535) * 1000 + 1e-9) / 1000);

  const bytes = new Uint8Array(surfelBlockByteLength(count, levels.length));
  const view = new DataView(bytes.buffer);

  bytes.set(SURFEL_BLOCK_MAGIC, 0);
  view.setUint16(4, SURFEL_BLOCK_VERSION, LITTLE_ENDIAN);
  view.setUint16(6, SURFEL_RECORD_BYTES, LITTLE_ENDIAN);
  view.setUint32(8, count, LITTLE_ENDIAN);
  view.setUint32(12, levels.length, LITTLE_ENDIAN);
  view.setFloat64(16, zMin, LITTLE_ENDIAN);
  view.setFloat64(24, zStep, LITTLE_ENDIAN);
  levels.forEach((n, k) => view.setUint32(SURFEL_BLOCK_HEADER_BYTES + 4 * k, n, LITTLE_ENDIAN));

  let o = SURFEL_BLOCK_HEADER_BYTES + 4 * levels.length;
  for (const s of splats) {
    view.setUint16(o + 0, Math.min(65535, Math.round(s.x * 65536)), LITTLE_ENDIAN);
    view.setUint16(o + 2, Math.min(65535, Math.round(s.y * 65536)), LITTLE_ENDIAN);
    view.setUint16(o + 4, Math.min(65535, Math.round((s.z - zMin) / zStep)), LITTLE_ENDIAN);
    view.setUint8(o + 6, encodeScale(s.sx));
    view.setUint8(o + 7, encodeScale(s.sy));
    view.setUint8(o + 8, encodeScale(s.sz));
    const q = packQuaternion(s.qw, s.qx, s.qy, s.qz);
    view.setUint8(o + 9, q & 0xff);
    view.setUint8(o + 10, (q >> 8) & 0xff);
    view.setUint8(o + 11, (q >> 16) & 0xff);
    view.setUint8(o + 12, s.r);
    view.setUint8(o + 13, s.g);
    view.setUint8(o + 14, s.b);
    view.setUint8(o + 15, s.a);
    o += SURFEL_RECORD_BYTES;
  }
  return bytes;
}

/** Decode a Surfel Block, ignoring its level table. */
export function decodeSurfelBlock(bytes: Uint8Array): Splat[] {
  return decodeSurfelBlockWithLevels(bytes).splats;
}

/**
 * Decode a Surfel Block with its level table.
 *
 * The input must contain exactly one block: header, level table, and
 * `count` records, with no trailing bytes. Any violation throws
 * SurfelBlockError; the decoder never reads outside `bytes`.
 */
export function decodeSurfelBlockWithLevels(bytes: Uint8Array): SurfelBlock {
  if (bytes.byteLength < SURFEL_BLOCK_HEADER_BYTES) {
    throw new SurfelBlockError(
      "TRUNCATED_HEADER",
      `need ${SURFEL_BLOCK_HEADER_BYTES} header bytes, got ${bytes.byteLength}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < SURFEL_BLOCK_MAGIC.length; i++) {
    if (bytes[i] !== SURFEL_BLOCK_MAGIC[i]) {
      throw new SurfelBlockError("BAD_MAGIC", "magic is not \"DSRF\"");
    }
  }
  const version = view.getUint16(4, LITTLE_ENDIAN);
  if (version !== SURFEL_BLOCK_VERSION) {
    throw new SurfelBlockError("UNSUPPORTED_VERSION", `version ${version}, expected ${SURFEL_BLOCK_VERSION}`);
  }
  const recordBytes = view.getUint16(6, LITTLE_ENDIAN);
  if (recordBytes !== SURFEL_RECORD_BYTES) {
    throw new SurfelBlockError("BAD_RECORD_SIZE", `record size ${recordBytes}, expected ${SURFEL_RECORD_BYTES}`);
  }
  const count = view.getUint32(8, LITTLE_ENDIAN);
  const levelCount = view.getUint32(12, LITTLE_ENDIAN);
  if (levelCount < 1 || levelCount > MAX_LEVELS) {
    throw new SurfelBlockError("BAD_LEVELS", `level count ${levelCount} not in 1..${MAX_LEVELS}`);
  }
  const zOrigin = view.getFloat64(16, LITTLE_ENDIAN);
  const zStep = view.getFloat64(24, LITTLE_ENDIAN);
  if (!Number.isFinite(zOrigin) || !(Number.isFinite(zStep) && zStep > 0)) {
    throw new SurfelBlockError("INVALID_VALUE", `z origin ${zOrigin} or step ${zStep} is invalid`);
  }
  const tableEnd = SURFEL_BLOCK_HEADER_BYTES + 4 * levelCount;
  if (bytes.byteLength < tableEnd) {
    throw new SurfelBlockError("TRUNCATED_HEADER", `level table needs ${tableEnd} bytes, got ${bytes.byteLength}`);
  }
  const levels = Array.from({ length: levelCount }, (_, k) => view.getUint32(SURFEL_BLOCK_HEADER_BYTES + 4 * k, LITTLE_ENDIAN));
  const expected = surfelBlockByteLength(count, levelCount);
  if (bytes.byteLength < expected) {
    throw new SurfelBlockError(
      "TRUNCATED_RECORDS",
      `count ${count} needs ${expected} bytes, got ${bytes.byteLength}`,
    );
  }
  if (bytes.byteLength > expected) {
    throw new SurfelBlockError(
      "TRAILING_BYTES",
      `count ${count} needs ${expected} bytes, got ${bytes.byteLength}`,
    );
  }
  checkLevels(levels, count);

  const splats: Splat[] = new Array(count);
  let o = tableEnd;
  for (let i = 0; i < count; i++) {
    const packed = view.getUint8(o + 9) | (view.getUint8(o + 10) << 8) | (view.getUint8(o + 11) << 16);
    const [qw, qx, qy, qz] = unpackQuaternion(packed);
    splats[i] = {
      x: view.getUint16(o + 0, LITTLE_ENDIAN) / 65536,
      y: view.getUint16(o + 2, LITTLE_ENDIAN) / 65536,
      z: Math.fround(zOrigin + view.getUint16(o + 4, LITTLE_ENDIAN) * zStep),
      sx: decodeScale(view.getUint8(o + 6)),
      sy: decodeScale(view.getUint8(o + 7)),
      sz: decodeScale(view.getUint8(o + 8)),
      qw, qx, qy, qz,
      r: view.getUint8(o + 12),
      g: view.getUint8(o + 13),
      b: view.getUint8(o + 14),
      a: view.getUint8(o + 15),
    };
    o += SURFEL_RECORD_BYTES;
  }
  return { splats, levels };
}
