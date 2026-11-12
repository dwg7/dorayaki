/**
 * Experimental MLT frame wrapper for Surfel Blocks.
 *
 * MapLibre Tile (MLT) tiles are a concatenation of frames with no tile
 * header (maplibre-tile-spec, docs/overview.md "Frames" and
 * docs/specification/v1.md "Tile Layout"):
 *
 *     tile  := frame*
 *     frame := [varint size] [u8 tag] [u8 body[size - 1]]
 *
 * `size` counts the tag byte plus the body. A decoder skips frames whose
 * tag it does not recognise, using `size`.
 *
 * This module treats every frame body as opaque bytes. It does not
 * import or depend on the Surfel Block codec, and it does not parse MLT
 * v1/v2 layers.
 *
 * See documents/mlt-frame.md.
 */

/**
 * EXPERIMENTAL local frame tag for a Surfel Block body.
 *
 * This is NOT an assigned MLT tag. Upstream assigns only 0x01 (MLT v1)
 * and 0x02 (MLT v2) and defines no experimental or private range. 0xD0
 * was picked arbitrarily for this proof of concept and may collide with
 * a future assignment.
 */
export const EXPERIMENTAL_SURFEL_FRAME_TAG = 0xd0;

/**
 * Local implementation limit: frame `size` must fit in uint32, so its
 * varint has at most 5 bytes. This limit is Dorayaki's choice, not MLT's.
 */
export const MAX_FRAME_SIZE = 0xffffffff;
const MAX_VARINT_BYTES = 5;

export type MltFrameErrorCode =
  | "TRUNCATED_VARINT"
  | "VARINT_OVERFLOW"
  | "ZERO_FRAME_SIZE"
  | "FRAME_OVERFLOW"
  | "INVALID_TAG"
  | "BODY_TOO_LARGE";

export class MltFrameError extends Error {
  readonly code: MltFrameErrorCode;

  constructor(code: MltFrameErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "MltFrameError";
    this.code = code;
  }
}

/** One frame found in a tile. `body` is a view into the tile bytes. */
export interface MltFrame {
  tag: number;
  body: Uint8Array;
  /** Byte offset of the frame (its size varint) within the tile. */
  offset: number;
}

/** Unsigned LEB128 varint, limited to uint32. */
export function encodeVarint(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > MAX_FRAME_SIZE) {
    throw new MltFrameError("VARINT_OVERFLOW", `varint value ${value} is not a uint32`);
  }
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return Uint8Array.from(out);
}

/** Decode an unsigned LEB128 varint (uint32 limit) at `offset`. */
export function decodeVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    const p = offset + i;
    if (p >= bytes.byteLength) {
      throw new MltFrameError("TRUNCATED_VARINT", `varint at offset ${offset} runs past end of input`);
    }
    const b = bytes[p] as number;
    value += (b & 0x7f) * scale;
    if ((b & 0x80) === 0) {
      if (value > MAX_FRAME_SIZE) {
        throw new MltFrameError("VARINT_OVERFLOW", `varint at offset ${offset} exceeds uint32`);
      }
      return { value, next: p + 1 };
    }
    scale *= 0x80;
  }
  throw new MltFrameError("VARINT_OVERFLOW", `varint at offset ${offset} is longer than ${MAX_VARINT_BYTES} bytes`);
}

/** Encode one frame: [varint size][u8 tag][body]. */
export function encodeFrame(tag: number, body: Uint8Array): Uint8Array {
  if (!Number.isInteger(tag) || tag < 0 || tag > 0xff) {
    throw new MltFrameError("INVALID_TAG", `tag ${tag} is not a uint8`);
  }
  const size = body.byteLength + 1;
  if (size > MAX_FRAME_SIZE) {
    throw new MltFrameError("BODY_TOO_LARGE", `frame size ${size} exceeds uint32`);
  }
  const prefix = encodeVarint(size);
  const out = new Uint8Array(prefix.byteLength + size);
  out.set(prefix, 0);
  out[prefix.byteLength] = tag;
  out.set(body, prefix.byteLength + 1);
  return out;
}

/** Concatenate frames into a tile. */
export function concatFrames(frames: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(frames.reduce((n, f) => n + f.byteLength, 0));
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.byteLength;
  }
  return out;
}

/**
 * Split a tile into frames, skipping each by its declared size.
 *
 * The whole tile is validated: any malformed or overflowing size throws
 * MltFrameError, even if it follows the frame the caller wants.
 */
export function readFrames(tile: Uint8Array): MltFrame[] {
  const frames: MltFrame[] = [];
  let offset = 0;
  while (offset < tile.byteLength) {
    const { value: size, next } = decodeVarint(tile, offset);
    if (size === 0) {
      throw new MltFrameError("ZERO_FRAME_SIZE", `frame at offset ${offset} has size 0 (no tag byte)`);
    }
    const remaining = tile.byteLength - next;
    if (size > remaining) {
      throw new MltFrameError(
        "FRAME_OVERFLOW",
        `frame at offset ${offset} declares size ${size}, only ${remaining} bytes remain`,
      );
    }
    frames.push({
      tag: tile[next] as number,
      body: tile.subarray(next + 1, next + size),
      offset,
    });
    offset = next + size;
  }
  return frames;
}

/** Wrap a Surfel Block (opaque bytes) in an experimental surfel frame. */
export function wrapSurfelBlock(block: Uint8Array): Uint8Array {
  return encodeFrame(EXPERIMENTAL_SURFEL_FRAME_TAG, block);
}

/**
 * Bodies of all experimental surfel frames in the tile, in tile order.
 * Other frames are skipped. Returns views into `tile`, not copies.
 */
export function extractSurfelBlocks(tile: Uint8Array): Uint8Array[] {
  return readFrames(tile)
    .filter((f) => f.tag === EXPERIMENTAL_SURFEL_FRAME_TAG)
    .map((f) => f.body);
}
