/**
 * Surfel Block codec (experimental; writes version 5 or 6, reads 4, 5 and 6).
 *
 * Each record is a quantized anisotropic Gaussian splat (16 bytes in versions 4 and 5, 12 in version 6), the
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
/** Version written by the encoder: records stored as byte planes. */
export const SURFEL_BLOCK_VERSION = 5;
/** Version 4 (whole 16-byte records, Array of Structures) is still read. */
export const SURFEL_BLOCK_VERSION_AOS = 4;
/** Fixed part of the header; the level table (4 bytes per level) follows it. */
export const SURFEL_BLOCK_HEADER_BYTES = 32;
export const SURFEL_RECORD_BYTES = 16;

/** Version 6: whole 12-byte records of bit-packed fields (see V6_FIELDS), a 40-byte header, one opacity per block. */
export const SURFEL_BLOCK_VERSION_V6 = 6;
export const SURFEL_BLOCK_HEADER_BYTES_V6 = 40;
export const SURFEL_RECORD_BYTES_V6 = 12;
/** Bit offset and width of each field in a version 6 record, counted from the least significant bit of the little-endian record. */
export const V6_FIELDS = {
  x: { off: 0, len: 13 }, y: { off: 13, len: 13 }, z: { off: 26, len: 14 },
  sx: { off: 40, len: 7 }, sy: { off: 47, len: 7 }, sz: { off: 54, len: 7 },
  quat: { off: 61, len: 17 },
  r: { off: 78, len: 6 }, g: { off: 84, len: 6 }, b: { off: 90, len: 6 },
} as const;
/** Version 6 scale code c (0..127) means 2^(scaleLog2Min + c / V6_SCALE_STEPS_PER_OCTAVE) metres. */
export const V6_SCALE_STEPS_PER_OCTAVE = 6;
/** Bits per stored quaternion component in version 6. */
export const V6_QUAT_COMPONENT_BITS = 5;
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
export function surfelBlockByteLength(count: number, levelCount = 1, version: number = SURFEL_BLOCK_VERSION): number {
  return version === SURFEL_BLOCK_VERSION_V6
    ? SURFEL_BLOCK_HEADER_BYTES_V6 + 4 * levelCount + SURFEL_RECORD_BYTES_V6 * count
    : SURFEL_BLOCK_HEADER_BYTES + 4 * levelCount + SURFEL_RECORD_BYTES * count;
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
  return packQuaternionBits(qw, qx, qy, qz, 7);
}

/**
 * packQuaternion with `componentBits` bits per stored component (codes 0..2 * half over [-1/sqrt2, 1/sqrt2], half =
 * 2^(componentBits - 1) - 1, code half = 0), so 2 + 3 * componentBits bits in all: 7 bits is the 24-bit form of versions
 * 4 and 5, 5 bits the 17-bit form of version 6.
 */
export function packQuaternionBits(qw: number, qx: number, qy: number, qz: number, componentBits: number): number {
  const QUAT_HALF_STEPS = 2 ** (componentBits - 1) - 1;
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
    shift += componentBits;
  }
  return bits;
}

/** Inverse of packQuaternion. Throws if the reserved bit 23 is set or a code is 127. */
export function unpackQuaternion(bits: number): [number, number, number, number] {
  if (bits & 0x800000) throw new SurfelBlockError("INVALID_VALUE", "reserved quaternion bit is set");
  return unpackQuaternionBits(bits, 7);
}

/** Inverse of packQuaternionBits (no reserved bit check). */
export function unpackQuaternionBits(bits: number, componentBits: number): [number, number, number, number] {
  const QUAT_HALF_STEPS = 2 ** (componentBits - 1) - 1;
  const largest = bits & 3;
  const q = [0, 0, 0, 0];
  let shift = 2;
  let sumSq = 0;
  for (let i = 0; i < 4; i++) {
    if (i === largest) continue;
    const code = (bits >> shift) & ((1 << componentBits) - 1);
    if (code > 2 * QUAT_HALF_STEPS) throw new SurfelBlockError("INVALID_VALUE", `quaternion code ${code} is unused`);
    const v = ((code - QUAT_HALF_STEPS) / QUAT_HALF_STEPS) * QUAT_RANGE;
    q[i] = v;
    sumSq += v * v;
    shift += componentBits;
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
export function encodeSurfelBlock(splats: readonly Splat[], levels: readonly number[] = [splats.length], options: { version?: 5 | 6 } = {}): Uint8Array {
  if (options.version === 6) return encodeSurfelBlockV6(splats, levels);
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

  // Records are stored as byte planes: plane b holds byte b of every record
  // (version 5), so that general-purpose compression sees like bytes together.
  const base = SURFEL_BLOCK_HEADER_BYTES + 4 * levels.length;
  const put = (plane: number, i: number, v: number): void => {
    bytes[base + plane * count + i] = v;
  };
  splats.forEach((s, i) => {
    const x = Math.min(65535, Math.round(s.x * 65536));
    const y = Math.min(65535, Math.round(s.y * 65536));
    const z = Math.min(65535, Math.round((s.z - zMin) / zStep));
    put(0, i, x & 0xff); put(1, i, x >> 8);
    put(2, i, y & 0xff); put(3, i, y >> 8);
    put(4, i, z & 0xff); put(5, i, z >> 8);
    put(6, i, encodeScale(s.sx));
    put(7, i, encodeScale(s.sy));
    put(8, i, encodeScale(s.sz));
    const q = packQuaternion(s.qw, s.qx, s.qy, s.qz);
    put(9, i, q & 0xff); put(10, i, (q >> 8) & 0xff); put(11, i, (q >> 16) & 0xff);
    put(12, i, s.r); put(13, i, s.g); put(14, i, s.b); put(15, i, s.a);
  });
  return bytes;
}

/** Decode a Surfel Block, ignoring its level table. */
export function decodeSurfelBlock(bytes: Uint8Array): Splat[] {
  return decodeSurfelBlockWithLevels(bytes).splats;
}

/** A block's header, validated, with where its records start. */
export interface SurfelBlockLayout {
  version: number;
  count: number;
  levels: number[];
  zOrigin: number;
  zStep: number;
  /** Byte offset of the first record (or plane). */
  tableEnd: number;
  /** True for version 5 (byte planes), false for versions 4 and 6 (whole records). */
  planar: boolean;
  /** 16 for versions 4 and 5, 12 for version 6. */
  recordBytes: number;
  /** Version 6: log2 of the metres of scale code 0 (0 otherwise). */
  scaleLog2Min: number;
  /** Version 6: the block's one opacity, 0..255 (255 otherwise: those versions store one per record). */
  alpha: number;
}

/**
 * Validate a Surfel Block's header, level table and length.
 *
 * The input must contain exactly one block: header, level table, and
 * `count` records, with no trailing bytes. Any violation throws
 * SurfelBlockError; nothing is read outside `bytes`.
 */
export function readSurfelBlockLayout(bytes: Uint8Array): SurfelBlockLayout {
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
  if (version !== SURFEL_BLOCK_VERSION && version !== SURFEL_BLOCK_VERSION_AOS && version !== SURFEL_BLOCK_VERSION_V6) {
    throw new SurfelBlockError("UNSUPPORTED_VERSION", `version ${version}, expected ${SURFEL_BLOCK_VERSION_AOS}, ${SURFEL_BLOCK_VERSION} or ${SURFEL_BLOCK_VERSION_V6}`);
  }
  const v6 = version === SURFEL_BLOCK_VERSION_V6;
  const headerBytes = v6 ? SURFEL_BLOCK_HEADER_BYTES_V6 : SURFEL_BLOCK_HEADER_BYTES;
  const recordSize = v6 ? SURFEL_RECORD_BYTES_V6 : SURFEL_RECORD_BYTES;
  if (bytes.byteLength < headerBytes) {
    throw new SurfelBlockError("TRUNCATED_HEADER", `need ${headerBytes} header bytes, got ${bytes.byteLength}`);
  }
  const recordBytes = view.getUint16(6, LITTLE_ENDIAN);
  if (recordBytes !== recordSize) {
    throw new SurfelBlockError("BAD_RECORD_SIZE", `record size ${recordBytes}, expected ${recordSize}`);
  }
  const scaleLog2Min = v6 ? view.getFloat32(32, LITTLE_ENDIAN) : 0;
  const alpha = v6 ? bytes[36]! : 255;
  if (!Number.isFinite(scaleLog2Min)) throw new SurfelBlockError("INVALID_VALUE", `scale base ${scaleLog2Min} is invalid`);
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
  const tableEnd = headerBytes + 4 * levelCount;
  if (bytes.byteLength < tableEnd) {
    throw new SurfelBlockError("TRUNCATED_HEADER", `level table needs ${tableEnd} bytes, got ${bytes.byteLength}`);
  }
  const levels = Array.from({ length: levelCount }, (_, k) => view.getUint32(headerBytes + 4 * k, LITTLE_ENDIAN));
  const expected = surfelBlockByteLength(count, levelCount, version);
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

  return { version, count, levels, zOrigin, zStep, tableEnd, planar: version === SURFEL_BLOCK_VERSION, recordBytes, scaleLog2Min, alpha };
}

/**
 * Decode a Surfel Block with its level table (see readSurfelBlockLayout for what is
 * validated).
 */
export function decodeSurfelBlockWithLevels(bytes: Uint8Array): SurfelBlock {
  const layout = readSurfelBlockLayout(bytes);
  if (layout.version === SURFEL_BLOCK_VERSION_V6) return decodeSurfelBlockV6(bytes, layout);
  const { count, levels, zOrigin, zStep, tableEnd, planar } = layout;
  const splats: Splat[] = new Array(count);
  const get = planar
    ? (plane: number, i: number): number => bytes[tableEnd + plane * count + i]!
    : (plane: number, i: number): number => bytes[tableEnd + i * SURFEL_RECORD_BYTES + plane]!;
  for (let i = 0; i < count; i++) {
    const packed = get(9, i) | (get(10, i) << 8) | (get(11, i) << 16);
    const [qw, qx, qy, qz] = unpackQuaternion(packed);
    splats[i] = {
      x: (get(0, i) | (get(1, i) << 8)) / 65536,
      y: (get(2, i) | (get(3, i) << 8)) / 65536,
      z: Math.fround(zOrigin + (get(4, i) | (get(5, i) << 8)) * zStep),
      sx: decodeScale(get(6, i)),
      sy: decodeScale(get(7, i)),
      sz: decodeScale(get(8, i)),
      qw, qx, qy, qz,
      r: get(12, i),
      g: get(13, i),
      b: get(14, i),
      a: get(15, i),
    };
  }
  return { splats, levels };
}

/** A block's records as whole records (16 bytes for versions 4 and 5, 12 for version 6), without making Splat objects (for uploading to the GPU as they are). */
export interface PackedBlock {
  count: number;
  levels: number[];
  zOrigin: number;
  zStep: number;
  /** 16: the wire record of version 4 (x, y, z as u16, 3 scale codes, 3 rotation bytes, r, g, b, a); 12: the bit-packed record of version 6 (V6_FIELDS). */
  recordBytes: 16 | 12;
  /** Version 6: log2 of the metres of scale code 0 (0 for the 16-byte records). */
  scaleLog2Min: number;
  /** count x recordBytes bytes. */
  records: Uint8Array;
}

export function packedSurfelBlock(bytes: Uint8Array): PackedBlock {
  const layout = readSurfelBlockLayout(bytes);
  const { count, levels, zOrigin, zStep, tableEnd, planar } = layout;
  if (layout.version === SURFEL_BLOCK_VERSION_V6) {
    return { count, levels, zOrigin, zStep, recordBytes: 12, scaleLog2Min: layout.scaleLog2Min, records: bytes.slice(tableEnd, tableEnd + count * SURFEL_RECORD_BYTES_V6) };
  }
  if (!planar) return { count, levels, zOrigin, zStep, recordBytes: 16, scaleLog2Min: 0, records: bytes.slice(tableEnd, tableEnd + count * SURFEL_RECORD_BYTES) };
  const records = new Uint8Array(count * SURFEL_RECORD_BYTES);
  for (let plane = 0; plane < SURFEL_RECORD_BYTES; plane++) {
    const from = tableEnd + plane * count;
    for (let i = 0; i < count; i++) records[i * SURFEL_RECORD_BYTES + plane] = bytes[from + i]!;
  }
  return { count, levels, zOrigin, zStep, recordBytes: 16, scaleLog2Min: 0, records };
}

// ---- Version 6: 12-byte bit-packed records ----------------------------------------------------------------------

function putBits(buf: Uint8Array, base: number, off: number, len: number, value: number): void {
  for (let i = 0; i < len; i++) if ((value >> i) & 1) buf[base + ((off + i) >> 3)]! |= 1 << ((off + i) & 7);
}

function getBits(buf: Uint8Array, base: number, off: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v |= ((buf[base + ((off + i) >> 3)]! >> ((off + i) & 7)) & 1) << i;
  return v;
}

/**
 * Encode splats as a version 6 block: 12-byte records, positions to 1/8192 of the tile, heights to a per-block step
 * (at least 1 mm, wide enough for 14 bits), scales to 6 steps per octave from the block's smallest scale (7 bits;
 * larger scales clamp at 21 octaves above it), rotation to 17 bits, colour to 6 bits per channel, one opacity for the
 * whole block (splats with different opacities are rejected). Lossier than version 5 (E016); a deliberate break.
 */
function encodeSurfelBlockV6(splats: readonly Splat[], levels: readonly number[]): Uint8Array {
  const count = splats.length;
  if (count > MAX_COUNT) throw new SurfelBlockError("TOO_MANY_SURFELS", `count ${count} exceeds uint32`);
  checkLevels(levels, count);
  splats.forEach(validateSplat);
  const alpha = count > 0 ? splats[0]!.a : 255;
  if (splats.some((s) => s.a !== alpha)) throw new SurfelBlockError("INVALID_VALUE", "version 6 stores one opacity per block; the splats differ");

  let zMin = Infinity, zMax = -Infinity, minLog2 = Infinity;
  for (const s of splats) {
    if (s.z < zMin) zMin = s.z;
    if (s.z > zMax) zMax = s.z;
    minLog2 = Math.min(minLog2, Math.log2(s.sx), Math.log2(s.sy), Math.log2(s.sz));
  }
  if (count === 0) { zMin = zMax = 0; minLog2 = 0; }
  const zSteps = 2 ** V6_FIELDS.z.len - 1;
  const zStep = Math.max(Z_STEP_METRES, Math.ceil(((zMax - zMin) / zSteps) * 1000 + 1e-9) / 1000);
  const scaleBase = Math.fround(minLog2);

  const bytes = new Uint8Array(surfelBlockByteLength(count, levels.length, SURFEL_BLOCK_VERSION_V6));
  const view = new DataView(bytes.buffer);
  bytes.set(SURFEL_BLOCK_MAGIC, 0);
  view.setUint16(4, SURFEL_BLOCK_VERSION_V6, LITTLE_ENDIAN);
  view.setUint16(6, SURFEL_RECORD_BYTES_V6, LITTLE_ENDIAN);
  view.setUint32(8, count, LITTLE_ENDIAN);
  view.setUint32(12, levels.length, LITTLE_ENDIAN);
  view.setFloat64(16, zMin, LITTLE_ENDIAN);
  view.setFloat64(24, zStep, LITTLE_ENDIAN);
  view.setFloat32(32, scaleBase, LITTLE_ENDIAN);
  bytes[36] = alpha;
  levels.forEach((n, k) => view.setUint32(SURFEL_BLOCK_HEADER_BYTES_V6 + 4 * k, n, LITTLE_ENDIAN));

  const F = V6_FIELDS;
  const xyMax = 2 ** F.x.len - 1;
  const scaleMax = 2 ** F.sx.len - 1;
  const colourMax = 2 ** F.r.len - 1;
  const code = (metres: number) => Math.min(scaleMax, Math.max(0, Math.round((Math.log2(metres) - scaleBase) * V6_SCALE_STEPS_PER_OCTAVE)));
  const colour = (c: number) => Math.round((c * colourMax) / 255);
  const base = SURFEL_BLOCK_HEADER_BYTES_V6 + 4 * levels.length;
  splats.forEach((s, i) => {
    const o = base + i * SURFEL_RECORD_BYTES_V6;
    putBits(bytes, o, F.x.off, F.x.len, Math.min(xyMax, Math.round(s.x * (xyMax + 1))));
    putBits(bytes, o, F.y.off, F.y.len, Math.min(xyMax, Math.round(s.y * (xyMax + 1))));
    putBits(bytes, o, F.z.off, F.z.len, Math.min(zSteps, Math.round((s.z - zMin) / zStep)));
    putBits(bytes, o, F.sx.off, F.sx.len, code(s.sx));
    putBits(bytes, o, F.sy.off, F.sy.len, code(s.sy));
    putBits(bytes, o, F.sz.off, F.sz.len, code(s.sz));
    putBits(bytes, o, F.quat.off, F.quat.len, packQuaternionBits(s.qw, s.qx, s.qy, s.qz, V6_QUAT_COMPONENT_BITS));
    putBits(bytes, o, F.r.off, F.r.len, colour(s.r));
    putBits(bytes, o, F.g.off, F.g.len, colour(s.g));
    putBits(bytes, o, F.b.off, F.b.len, colour(s.b));
  });
  return bytes;
}

function decodeSurfelBlockV6(bytes: Uint8Array, layout: SurfelBlockLayout): SurfelBlock {
  const { count, levels, zOrigin, zStep, tableEnd, scaleLog2Min, alpha } = layout;
  const F = V6_FIELDS;
  const xyScale = 2 ** F.x.len;
  const colourMax = 2 ** F.r.len - 1;
  const splats: Splat[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = tableEnd + i * SURFEL_RECORD_BYTES_V6;
    const [qw, qx, qy, qz] = unpackQuaternionBits(getBits(bytes, o, F.quat.off, F.quat.len), V6_QUAT_COMPONENT_BITS);
    const scale = (f: { off: number; len: number }) => 2 ** (scaleLog2Min + getBits(bytes, o, f.off, f.len) / V6_SCALE_STEPS_PER_OCTAVE);
    const colour = (f: { off: number; len: number }) => Math.round((getBits(bytes, o, f.off, f.len) * 255) / colourMax);
    splats[i] = {
      x: getBits(bytes, o, F.x.off, F.x.len) / xyScale,
      y: getBits(bytes, o, F.y.off, F.y.len) / xyScale,
      z: Math.fround(zOrigin + getBits(bytes, o, F.z.off, F.z.len) * zStep),
      sx: scale(F.sx), sy: scale(F.sy), sz: scale(F.sz),
      qw, qx, qy, qz,
      r: colour(F.r), g: colour(F.g), b: colour(F.b), a: alpha,
    };
  }
  return { splats, levels };
}
