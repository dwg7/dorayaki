/**
 * Naive Surfel Block codec (experimental, version 3).
 *
 * See docs/surfel-block-format.md for the byte layout. All multi-byte
 * values are little-endian. This module has no dependency on MapLibre,
 * MLT, or any runtime other than ECMAScript typed arrays.
 */

/**
 * One circular surfel as held in memory.
 *
 * Coordinate frame (version 2, see docs/surfel-block-format.md):
 * x, y are tile-local in [0, 1] (x east, y south); z is orthometric
 * height (標高, metres above the geoid);
 * the normal is a unit vector in the local metric frame (east, south, up);
 * radius is metres.
 */
export interface Surfel {
  /** Tile-local, 0 = west edge, 1 = east edge. */
  x: number;
  /** Tile-local, 0 = north edge, 1 = south edge. */
  y: number;
  /** Orthometric height (標高): metres above the geoid. */
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

/** ASCII "DSRF". */
export const SURFEL_BLOCK_MAGIC = Uint8Array.of(0x44, 0x53, 0x52, 0x46);
export const SURFEL_BLOCK_VERSION = 3;
/** Fixed part of the header; the level table (4 bytes per level) follows it. */
export const SURFEL_BLOCK_HEADER_BYTES = 16;
export const SURFEL_RECORD_BYTES = 32;
/** Upper bound on the level table size (a sanity limit, not a format need). */
export const MAX_LEVELS = 64;

const LITTLE_ENDIAN = true;
const MAX_COUNT = 0xffffffff;

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

const FLOAT_FIELDS = ["x", "y", "z", "nx", "ny", "nz", "radius"] as const;
const COLOR_FIELDS = ["r", "g", "b", "a"] as const;

/** Byte length of an encoded block holding `count` surfels in `levelCount` levels. */
export function surfelBlockByteLength(count: number, levelCount = 1): number {
  return SURFEL_BLOCK_HEADER_BYTES + 4 * levelCount + SURFEL_RECORD_BYTES * count;
}

/** A decoded block: surfels in stored order and the level table. */
export interface SurfelBlock {
  surfels: Surfel[];
  /**
   * Surfel count per level, in stored order; they sum to surfels.length.
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

function validateSurfel(s: Surfel, index: number): void {
  for (const field of FLOAT_FIELDS) {
    const v = s[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new SurfelBlockError("INVALID_VALUE", `surfel ${index}: ${field} must be a finite number`);
    }
  }
  if (s.radius < 0) {
    throw new SurfelBlockError("INVALID_VALUE", `surfel ${index}: radius must be >= 0`);
  }
  for (const field of COLOR_FIELDS) {
    const v = s[field];
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new SurfelBlockError("INVALID_VALUE", `surfel ${index}: ${field} must be an integer in 0..255`);
    }
  }
}

/**
 * Encode surfels into a naive Surfel Block.
 *
 * `levels` is the level table (surfel count per level, in order). It
 * defaults to a single level holding every surfel.
 *
 * Float fields are stored as float32, so values that are not exactly
 * representable in float32 are rounded (as by Math.fround).
 */
export function encodeSurfelBlock(surfels: readonly Surfel[], levels: readonly number[] = [surfels.length]): Uint8Array {
  const count = surfels.length;
  if (count > MAX_COUNT) {
    throw new SurfelBlockError("TOO_MANY_SURFELS", `count ${count} exceeds uint32`);
  }
  checkLevels(levels, count);
  surfels.forEach(validateSurfel);

  const bytes = new Uint8Array(surfelBlockByteLength(count, levels.length));
  const view = new DataView(bytes.buffer);

  bytes.set(SURFEL_BLOCK_MAGIC, 0);
  view.setUint16(4, SURFEL_BLOCK_VERSION, LITTLE_ENDIAN);
  view.setUint16(6, SURFEL_RECORD_BYTES, LITTLE_ENDIAN);
  view.setUint32(8, count, LITTLE_ENDIAN);
  view.setUint32(12, levels.length, LITTLE_ENDIAN);
  levels.forEach((n, k) => view.setUint32(SURFEL_BLOCK_HEADER_BYTES + 4 * k, n, LITTLE_ENDIAN));

  let o = SURFEL_BLOCK_HEADER_BYTES + 4 * levels.length;
  for (const s of surfels) {
    view.setFloat32(o + 0, s.x, LITTLE_ENDIAN);
    view.setFloat32(o + 4, s.y, LITTLE_ENDIAN);
    view.setFloat32(o + 8, s.z, LITTLE_ENDIAN);
    view.setFloat32(o + 12, s.nx, LITTLE_ENDIAN);
    view.setFloat32(o + 16, s.ny, LITTLE_ENDIAN);
    view.setFloat32(o + 20, s.nz, LITTLE_ENDIAN);
    view.setFloat32(o + 24, s.radius, LITTLE_ENDIAN);
    view.setUint8(o + 28, s.r);
    view.setUint8(o + 29, s.g);
    view.setUint8(o + 30, s.b);
    view.setUint8(o + 31, s.a);
    o += SURFEL_RECORD_BYTES;
  }
  return bytes;
}

/** Decode a naive Surfel Block, ignoring its level table. */
export function decodeSurfelBlock(bytes: Uint8Array): Surfel[] {
  return decodeSurfelBlockWithLevels(bytes).surfels;
}

/**
 * Decode a naive Surfel Block with its level table.
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

  const surfels: Surfel[] = new Array(count);
  let o = tableEnd;
  for (let i = 0; i < count; i++) {
    const s: Surfel = {
      x: view.getFloat32(o + 0, LITTLE_ENDIAN),
      y: view.getFloat32(o + 4, LITTLE_ENDIAN),
      z: view.getFloat32(o + 8, LITTLE_ENDIAN),
      nx: view.getFloat32(o + 12, LITTLE_ENDIAN),
      ny: view.getFloat32(o + 16, LITTLE_ENDIAN),
      nz: view.getFloat32(o + 20, LITTLE_ENDIAN),
      radius: view.getFloat32(o + 24, LITTLE_ENDIAN),
      r: view.getUint8(o + 28),
      g: view.getUint8(o + 29),
      b: view.getUint8(o + 30),
      a: view.getUint8(o + 31),
    };
    validateSurfel(s, i);
    surfels[i] = s;
    o += SURFEL_RECORD_BYTES;
  }
  return { surfels, levels };
}
