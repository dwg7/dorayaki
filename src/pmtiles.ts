/**
 * Minimal PMTiles v3 writer (https://github.com/protomaps/PMTiles, spec v3).
 *
 * Writes a single-file archive of z/x/y tiles: 127-byte header, root
 * directory, JSON metadata, tile data. Scope: no leaf directories (the root
 * directory must fit in the first 16 KiB), no deduplication, uncompressed
 * directories and metadata, tiles stored as given and clustered in tile-ID
 * order. Readers fetch the header, then directory and tiles with HTTP Range
 * requests. No DOM or Node dependency.
 */

export enum PmtilesCompression {
  Unknown = 0,
  None = 1,
  Gzip = 2,
  Brotli = 3,
  Zstd = 4,
}

/** PMTiles tile types; 6 is MapLibre Tile (MLT). */
export enum PmtilesTileType {
  Unknown = 0,
  Mvt = 1,
  Png = 2,
  Jpeg = 3,
  Webp = 4,
  Avif = 5,
  Mlt = 6,
}

export interface PmtilesTile {
  z: number;
  x: number;
  y: number;
  data: Uint8Array;
}

export interface PmtilesOptions {
  tileType: PmtilesTileType;
  /** Compression already applied to every tile's bytes. */
  tileCompression?: PmtilesCompression;
  /** [west, south, east, north] in degrees. */
  bounds: [number, number, number, number];
  /** [lng, lat, zoom]. */
  center: [number, number, number];
  metadata: Record<string, unknown>;
  /**
   * Compressor for the root directory and metadata, with its code. Omit for
   * uncompressed. stars' Martin serves gzip-compressed directories (as in its
   * existing MLT archives), so the Numazu build passes gzip here.
   */
  internal?: { compression: PmtilesCompression; compress: (bytes: Uint8Array) => Uint8Array };
}

const HEADER_BYTES = 127;
const ROOT_LIMIT = 16384;

/**
 * Hilbert tile ID of z/x/y (PMTiles v3): the count of tiles in zooms
 * 0..z-1, plus the Hilbert index of x/y within zoom z. Follows the
 * reference implementation's bit-wise formulation (exact for z <= 26).
 */
export function zxyToTileId(z: number, x: number, y: number): number {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new RangeError(`zoom ${z} outside 0..26`);
  const n = 2 ** z;
  if (!(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < n && y >= 0 && y < n)) {
    throw new RangeError(`tile ${z}/${x}/${y} outside the zoom level`);
  }
  let id = (n * n - 1) / 3;
  let tx = x;
  let ty = y;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = tx & s;
    const ry = ty & s;
    id += ((3 * rx) ^ ry) * s;
    if (ry === 0) {
      [tx, ty] = rx !== 0 ? [s - 1 - ty, s - 1 - tx] : [ty, tx];
    }
  }
  return id;
}

function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function setU64(v: DataView, offset: number, value: number): void {
  v.setUint32(offset, value % 2 ** 32, true);
  v.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}

export function writePmtiles(tiles: readonly PmtilesTile[], options: PmtilesOptions): Uint8Array {
  if (tiles.length === 0) throw new RangeError("no tiles");
  const entries = tiles
    .map((t) => ({ id: zxyToTileId(t.z, t.x, t.y), t }))
    .sort((a, b) => a.id - b.id);
  for (let i = 1; i < entries.length; i++) {
    if (entries[i]!.id === entries[i - 1]!.id) throw new RangeError(`duplicate tile ${entries[i]!.t.z}/${entries[i]!.t.x}/${entries[i]!.t.y}`);
  }

  // Root directory: count, tile ID deltas, run lengths, lengths, offsets
  // (0 = contiguous with the previous entry, else offset + 1).
  const dir: number[] = [];
  writeVarint(dir, entries.length);
  let last = 0;
  for (const e of entries) { writeVarint(dir, e.id - last); last = e.id; }
  for (let i = 0; i < entries.length; i++) writeVarint(dir, 1);
  for (const e of entries) writeVarint(dir, e.t.data.byteLength);
  let offset = 0;
  entries.forEach((e, i) => {
    writeVarint(dir, i === 0 ? offset + 1 : 0);
    offset += e.t.data.byteLength;
  });
  const pack = (bytes: Uint8Array) => (options.internal ? options.internal.compress(bytes) : bytes);
  const root = pack(Uint8Array.from(dir));
  if (HEADER_BYTES + root.byteLength > ROOT_LIMIT) {
    throw new RangeError(`root directory (${root.byteLength} bytes) does not fit in ${ROOT_LIMIT} bytes; leaf directories are not supported`);
  }

  const metadata = pack(utf8(JSON.stringify(options.metadata)));
  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + root.byteLength;
  const tileDataOffset = metadataOffset + metadata.byteLength;
  const tileDataLength = offset;
  const out = new Uint8Array(tileDataOffset + tileDataLength);
  const v = new DataView(out.buffer);

  "PMTiles".split("").forEach((c, i) => (out[i] = c.charCodeAt(0)));
  out[7] = 3;
  setU64(v, 8, rootOffset);
  setU64(v, 16, root.byteLength);
  setU64(v, 24, metadataOffset);
  setU64(v, 32, metadata.byteLength);
  setU64(v, 40, 0); // no leaf directories
  setU64(v, 48, 0);
  setU64(v, 56, tileDataOffset);
  setU64(v, 64, tileDataLength);
  setU64(v, 72, entries.length); // addressed tiles
  setU64(v, 80, entries.length); // tile entries
  setU64(v, 88, entries.length); // tile contents
  out[96] = 1; // clustered
  out[97] = options.internal?.compression ?? PmtilesCompression.None; // internal compression
  out[98] = options.tileCompression ?? PmtilesCompression.None;
  out[99] = options.tileType;
  const zooms = tiles.map((t) => t.z);
  out[100] = Math.min(...zooms);
  out[101] = Math.max(...zooms);
  const e7 = (deg: number) => Math.round(deg * 1e7);
  v.setInt32(102, e7(options.bounds[0]), true);
  v.setInt32(106, e7(options.bounds[1]), true);
  v.setInt32(110, e7(options.bounds[2]), true);
  v.setInt32(114, e7(options.bounds[3]), true);
  out[118] = Math.round(options.center[2]);
  v.setInt32(119, e7(options.center[0]), true);
  v.setInt32(123, e7(options.center[1]), true);

  out.set(root, rootOffset);
  out.set(metadata, metadataOffset);
  let o = tileDataOffset;
  for (const e of entries) {
    out.set(e.t.data, o);
    o += e.t.data.byteLength;
  }
  return out;
}
