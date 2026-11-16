/**
 * Class plane (experimental, version 1): one class code per splat, stored beside a Surfel Block in the same tile as a second
 * frame (src/mlt-frame.ts, tag 0xD1). See documents/class-plane.md.
 *
 * Body of the frame (little-endian):
 *
 *     offset 0   4   magic "DCLS"
 *     offset 4   1   version (1)
 *     offset 5   1   compression: 0 none, 1 gzip
 *     offset 6   2   reserved, zero
 *     offset 8   4   count: number of splats (must equal the Surfel Block's count)
 *     offset 12  ... payload: `count` class codes, one byte each, in the block's stored order; with compression 1, the gzip of them
 *
 * Class codes are 0 to 127: the ASPRS LAS classification codes (2 ground, 3 low vegetation, 4 medium vegetation, 5 high vegetation,
 * 6 building, 9 water, ...) and, from 64 up, codes that a build defines itself (`CLASS_DERIVED_CANOPY` is one). Codes 128 to 255 are
 * reserved and rejected. This module has no Node or DOM dependency: compression is passed in.
 */

export const CLASS_PLANE_MAGIC = Uint8Array.of(0x44, 0x43, 0x4c, 0x53); // "DCLS"
export const CLASS_PLANE_VERSION = 1;
export const CLASS_PLANE_HEADER_BYTES = 12;
export const CLASS_PLANE_COMPRESSION_NONE = 0;
export const CLASS_PLANE_COMPRESSION_GZIP = 1;
/** Class codes are below this (the demo hides classes with a 128-bit mask and has one palette entry per code). */
export const CLASS_CODE_LIMIT = 128;

/** ASPRS LAS classification codes used by the Kawazu data. */
export const CLASS_NEVER_CLASSIFIED = 0;
export const CLASS_UNCLASSIFIED = 1;
export const CLASS_GROUND = 2;
export const CLASS_LOW_VEGETATION = 3;
export const CLASS_MEDIUM_VEGETATION = 4;
export const CLASS_HIGH_VEGETATION = 5;
export const CLASS_BUILDING = 6;
export const CLASS_WATER = 9;
/**
 * Dorayaki build rule, not an ASPRS code: an airborne laser point that is unclassified but belongs to a pulse with several returns
 * (it reached through foliage), taken as vegetation.
 */
export const CLASS_DERIVED_CANOPY = 64;
/** The codes that count as vegetation. */
export const VEGETATION_CLASSES: readonly number[] = [CLASS_LOW_VEGETATION, CLASS_MEDIUM_VEGETATION, CLASS_HIGH_VEGETATION, CLASS_DERIVED_CANOPY];

export type ClassPlaneErrorCode =
  | "TRUNCATED_HEADER"
  | "BAD_MAGIC"
  | "UNSUPPORTED_VERSION"
  | "BAD_COMPRESSION"
  | "INVALID_CODE"
  | "LENGTH_MISMATCH";

export class ClassPlaneError extends Error {
  readonly code: ClassPlaneErrorCode;

  constructor(code: ClassPlaneErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ClassPlaneError";
    this.code = code;
  }
}

/** A parsed header and the payload, still compressed when `compression` is 1. */
export interface ClassPlane {
  count: number;
  compression: number;
  payload: Uint8Array;
}

/** Encode a class plane body. `gzip` compresses the codes (compression 1); without it they are stored as they are. */
export function encodeClassPlane(classes: Uint8Array, gzip?: (bytes: Uint8Array) => Uint8Array): Uint8Array {
  checkCodes(classes);
  const payload = gzip ? gzip(classes) : classes;
  const out = new Uint8Array(CLASS_PLANE_HEADER_BYTES + payload.byteLength);
  const view = new DataView(out.buffer);
  out.set(CLASS_PLANE_MAGIC, 0);
  view.setUint8(4, CLASS_PLANE_VERSION);
  view.setUint8(5, gzip ? CLASS_PLANE_COMPRESSION_GZIP : CLASS_PLANE_COMPRESSION_NONE);
  view.setUint32(8, classes.byteLength, true);
  out.set(payload, CLASS_PLANE_HEADER_BYTES);
  return out;
}

function checkCodes(codes: Uint8Array): void {
  for (let i = 0; i < codes.length; i++) {
    if (codes[i]! >= CLASS_CODE_LIMIT) throw new ClassPlaneError("INVALID_CODE", `class code ${codes[i]} at index ${i} is not below ${CLASS_CODE_LIMIT}`);
  }
}

/** Validate the header of a class plane body; for an uncompressed plane also the payload length. Never reads outside `body`. */
export function readClassPlane(body: Uint8Array): ClassPlane {
  if (body.byteLength < CLASS_PLANE_HEADER_BYTES) {
    throw new ClassPlaneError("TRUNCATED_HEADER", `need ${CLASS_PLANE_HEADER_BYTES} header bytes, got ${body.byteLength}`);
  }
  for (let i = 0; i < CLASS_PLANE_MAGIC.length; i++) {
    if (body[i] !== CLASS_PLANE_MAGIC[i]) throw new ClassPlaneError("BAD_MAGIC", "magic is not \"DCLS\"");
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const version = view.getUint8(4);
  if (version !== CLASS_PLANE_VERSION) throw new ClassPlaneError("UNSUPPORTED_VERSION", `version ${version}, expected ${CLASS_PLANE_VERSION}`);
  const compression = view.getUint8(5);
  if (compression !== CLASS_PLANE_COMPRESSION_NONE && compression !== CLASS_PLANE_COMPRESSION_GZIP) {
    throw new ClassPlaneError("BAD_COMPRESSION", `compression ${compression} is neither 0 nor 1`);
  }
  const count = view.getUint32(8, true);
  const payload = body.subarray(CLASS_PLANE_HEADER_BYTES);
  if (compression === CLASS_PLANE_COMPRESSION_NONE && payload.byteLength !== count) {
    throw new ClassPlaneError("LENGTH_MISMATCH", `count ${count} needs ${count} payload bytes, got ${payload.byteLength}`);
  }
  return { count, compression, payload };
}

/**
 * The class codes of a plane. `inflate` decompresses a gzip payload (Node: gunzipSync; browser: DecompressionStream "gzip"); it is
 * called with the payload and the most bytes it may produce (`count`) and must not produce more (a hostile payload could otherwise
 * expand without bound); it is not called for an uncompressed plane. The result must have exactly `count` bytes, all codes below
 * CLASS_CODE_LIMIT.
 */
export async function decodeClassPlane(
  plane: ClassPlane, inflate?: (payload: Uint8Array, maxLength: number) => Uint8Array | Promise<Uint8Array>,
): Promise<Uint8Array> {
  let codes: Uint8Array;
  if (plane.compression === CLASS_PLANE_COMPRESSION_GZIP) {
    if (!inflate) throw new ClassPlaneError("BAD_COMPRESSION", "the plane is compressed and no inflate function was given");
    codes = await inflate(plane.payload, plane.count);
  } else {
    codes = plane.payload;
  }
  if (codes.byteLength !== plane.count) {
    throw new ClassPlaneError("LENGTH_MISMATCH", `count ${plane.count}, decompressed ${codes.byteLength} bytes`);
  }
  checkCodes(codes);
  return codes;
}

/**
 * Join the class codes of source tiles into the plane of a merged tile, in the order of their splats. `parts[i]` is source i's
 * codes (undefined when it has no plane) and `counts[i]` its splat count. Returns undefined when any source has no plane or a plane
 * of another length than its splats (so classes can never be put on the wrong splats).
 */
export function joinClassCodes(parts: ReadonlyArray<Uint8Array | undefined>, counts: readonly number[]): Uint8Array | undefined {
  if (parts.length === 0 || parts.length !== counts.length) return undefined;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.byteLength !== counts[i]) return undefined;
    total += p.byteLength;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p!, o); o += p!.byteLength; }
  return out;
}
