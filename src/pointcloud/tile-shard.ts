/**
 * Shard records of the tiled build (E022 step 3): the compact form in which the scatter stage stores a point for its z17 tile.
 * 16 bytes, little endian: east (float32, metres from the tile's north-west corner), south (float32), up (float32, metres),
 * red, green, blue (8 bits: the high byte of the LAS color), class slot (a byte; 255 = none), two reserved zero bytes.
 * Float32 has a resolution of 2e-5 m at 250 m. No file access here.
 */
export const SHARD_RECORD_BYTES = 16;
export const SHARD_NO_SLOT = 255;

export interface ShardPoint { east: number; south: number; up: number; r: number; g: number; b: number; slot: number }

/** Write one record into `view` at `offset`; r, g, b are bytes, `slot` is 0..254 or -1 for none. */
export function writeShardRecord(view: DataView, offset: number, east: number, south: number, up: number, r: number, g: number, b: number, slot: number): void {
  view.setFloat32(offset, east, true);
  view.setFloat32(offset + 4, south, true);
  view.setFloat32(offset + 8, up, true);
  view.setUint8(offset + 12, r);
  view.setUint8(offset + 13, g);
  view.setUint8(offset + 14, b);
  view.setUint8(offset + 15, slot < 0 ? SHARD_NO_SLOT : slot);
}

/** Call `fn` for each of the `count` records at the start of `bytes`; colors are returned in 0..1 and the slot is -1 for none. */
export function forEachShardRecord(bytes: Uint8Array, count: number, fn: (east: number, south: number, up: number, r: number, g: number, b: number, slot: number) => void): void {
  if (count * SHARD_RECORD_BYTES > bytes.byteLength) throw new RangeError("shard chunk shorter than the records requested");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0, o = 0; i < count; i++, o += SHARD_RECORD_BYTES) {
    const slot = v.getUint8(o + 15);
    fn(v.getFloat32(o, true), v.getFloat32(o + 4, true), v.getFloat32(o + 8, true), v.getUint8(o + 12) / 255, v.getUint8(o + 13) / 255, v.getUint8(o + 14) / 255, slot === SHARD_NO_SLOT ? -1 : slot);
  }
}
