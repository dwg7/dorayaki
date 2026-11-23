/**
 * Minimal PMTiles v3 writer (https://github.com/protomaps/PMTiles, spec v3).
 *
 * Writes a single-file archive of z/x/y tiles: 127-byte header, root
 * directory, JSON metadata, leaf directories (only when the root directory
 * would not fit in the first 16 KiB), tile data. Scope: no deduplication,
 * tiles stored as given and clustered in tile-ID order. Directories and
 * metadata are uncompressed unless `internal` is given. Readers fetch the
 * header, then directories and tiles with HTTP Range requests. No DOM or Node
 * dependency. The archive is built in memory as one Uint8Array.
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

interface DirEntry {
  tileId: number;
  /** Tile entries: offset into the tile data section. Leaf entries (runLength 0): offset into the leaf directory section. */
  offset: number;
  length: number;
  /** 0 marks an entry that points at a leaf directory. */
  runLength: number;
}

/** Serialize one directory: count, tile ID deltas, run lengths, lengths, offsets (0 = contiguous with the previous entry, else offset + 1). */
function serializeDirectory(entries: readonly DirEntry[]): Uint8Array {
  const dir: number[] = [];
  writeVarint(dir, entries.length);
  let last = 0;
  for (const e of entries) { writeVarint(dir, e.tileId - last); last = e.tileId; }
  for (const e of entries) writeVarint(dir, e.runLength);
  for (const e of entries) writeVarint(dir, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    writeVarint(dir, prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return Uint8Array.from(dir);
}

/**
 * The root directory, and the concatenated leaf directories when the entries
 * do not fit in the first 16 KiB. Leaves hold equal runs of entries; the run
 * grows until the root (one entry per leaf) fits.
 */
function buildDirectories(entries: readonly DirEntry[], pack: (bytes: Uint8Array) => Uint8Array): { root: Uint8Array; leaves: Uint8Array } {
  const whole = pack(serializeDirectory(entries));
  if (HEADER_BYTES + whole.byteLength <= ROOT_LIMIT) return { root: whole, leaves: new Uint8Array(0) };
  for (let leafSize = 4096; ; leafSize = Math.ceil(leafSize * 1.2)) {
    const chunks: Uint8Array[] = [];
    const rootEntries: DirEntry[] = [];
    let leafBytes = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const chunk = pack(serializeDirectory(entries.slice(i, i + leafSize)));
      rootEntries.push({ tileId: entries[i]!.tileId, offset: leafBytes, length: chunk.byteLength, runLength: 0 });
      chunks.push(chunk);
      leafBytes += chunk.byteLength;
    }
    const root = pack(serializeDirectory(rootEntries));
    if (HEADER_BYTES + root.byteLength <= ROOT_LIMIT) {
      const leaves = new Uint8Array(leafBytes);
      let o = 0;
      for (const c of chunks) { leaves.set(c, o); o += c.byteLength; }
      return { root, leaves };
    }
    if (rootEntries.length === 1) throw new RangeError(`root directory (${root.byteLength} bytes) does not fit in ${ROOT_LIMIT} bytes`);
  }
}

/** What the archive's directories need to know about one tile: its ID, zoom and stored length. */
export interface PmtilesIndexEntry {
  tileId: number;
  z: number;
  length: number;
}

/** Tiles sorted by tile ID, checked for duplicates (`describe` names tile i in the error). */
export function sortedIndex(items: ReadonlyArray<{ z: number; x: number; y: number }>): Array<{ i: number; tileId: number }> {
  const order = items.map((t, i) => ({ i, tileId: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.tileId - b.tileId);
  for (let k = 1; k < order.length; k++) {
    if (order[k]!.tileId === order[k - 1]!.tileId) {
      const t = items[order[k]!.i]!;
      throw new RangeError(`duplicate tile ${t.z}/${t.x}/${t.y}`);
    }
  }
  return order;
}

/**
 * Everything of the archive that comes before the tile data: header, root directory, metadata and leaf directories,
 * for tiles stored contiguously in the order of `index` (sorted by tile ID, unique). The tile data itself follows
 * (`tileDataLength` bytes), so a writer can produce it without holding it: `writePmtiles` appends it in memory and
 * `writePmtilesFile` (pmtiles-file.ts) copies it from disk.
 */
export function pmtilesHead(index: readonly PmtilesIndexEntry[], options: PmtilesOptions): { head: Uint8Array; tileDataLength: number } {
  if (index.length === 0) throw new RangeError("no tiles");
  const dirEntries: DirEntry[] = [];
  let offset = 0;
  for (const e of index) { dirEntries.push({ tileId: e.tileId, offset, length: e.length, runLength: 1 }); offset += e.length; }

  const pack = (bytes: Uint8Array) => (options.internal ? options.internal.compress(bytes) : bytes);
  const { root, leaves } = buildDirectories(dirEntries, pack);

  const metadata = pack(utf8(JSON.stringify(options.metadata)));
  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + root.byteLength;
  const leafOffset = metadataOffset + metadata.byteLength;
  const tileDataOffset = leafOffset + leaves.byteLength;
  const tileDataLength = offset;
  const out = new Uint8Array(tileDataOffset);
  const v = new DataView(out.buffer);

  "PMTiles".split("").forEach((c, i) => (out[i] = c.charCodeAt(0)));
  out[7] = 3;
  setU64(v, 8, rootOffset);
  setU64(v, 16, root.byteLength);
  setU64(v, 24, metadataOffset);
  setU64(v, 32, metadata.byteLength);
  setU64(v, 40, leaves.byteLength > 0 ? leafOffset : 0);
  setU64(v, 48, leaves.byteLength);
  setU64(v, 56, tileDataOffset);
  setU64(v, 64, tileDataLength);
  setU64(v, 72, index.length); // addressed tiles
  setU64(v, 80, index.length); // tile entries
  setU64(v, 88, index.length); // tile contents
  out[96] = 1; // clustered
  out[97] = options.internal?.compression ?? PmtilesCompression.None; // internal compression
  out[98] = options.tileCompression ?? PmtilesCompression.None;
  out[99] = options.tileType;
  let minZ = Infinity, maxZ = -Infinity;
  for (const e of index) { if (e.z < minZ) minZ = e.z; if (e.z > maxZ) maxZ = e.z; }
  out[100] = minZ;
  out[101] = maxZ;
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
  out.set(leaves, leafOffset);
  return { head: out, tileDataLength };
}

export function writePmtiles(tiles: readonly PmtilesTile[], options: PmtilesOptions): Uint8Array {
  if (tiles.length === 0) throw new RangeError("no tiles");
  const order = sortedIndex(tiles);
  const { head, tileDataLength } = pmtilesHead(order.map((o) => ({ tileId: o.tileId, z: tiles[o.i]!.z, length: tiles[o.i]!.data.byteLength })), options);
  const out = new Uint8Array(head.byteLength + tileDataLength);
  out.set(head, 0);
  let o = head.byteLength;
  for (const e of order) {
    const data = tiles[e.i]!.data;
    out.set(data, o);
    o += data.byteLength;
  }
  return out;
}
