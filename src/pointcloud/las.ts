/**
 * Minimal LAS reader (uncompressed LAS 1.0–1.4 headers, point data record
 * formats 0–3). Reads scaled X/Y/Z, classification, and RGB when present.
 * LAZ (compressed) is not supported. No DOM or Node dependency.
 */

export class LasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LasError";
  }
}

export interface LasPoints {
  version: string;
  pointFormat: number;
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  classification: Uint8Array;
  /** 16-bit RGB triples, or null for formats without colour. */
  rgb: Uint16Array | null;
  min: [number, number, number];
  max: [number, number, number];
}

/** Byte offset of RGB within a point record, per point data record format. */
const RGB_OFFSET: Record<number, number | null> = { 0: null, 1: null, 2: 20, 3: 28 };
const MIN_RECORD: Record<number, number> = { 0: 20, 1: 28, 2: 26, 3: 34 };

/** Fields of the public header block that the readers need. */
export interface LasHeader {
  version: string;
  pointFormat: number;
  recordLength: number;
  count: number;
  offsetToPoints: number;
  scale: [number, number, number];
  offset: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  /** Byte offset of RGB within a record, or null for formats without colour. */
  rgbOffset: number | null;
}

/**
 * Parse the header from the first bytes of a LAS file (at least 227, or 375
 * for LAS 1.4). Does not look at the point data, so a streaming reader can
 * call it on a prefix.
 */
export function parseLasHeader(bytes: Uint8Array): LasHeader {
  if (bytes.byteLength < 227) throw new LasError("truncated LAS header");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== "LASF") throw new LasError("not a LAS file");
  const major = bytes[24]!;
  const minor = bytes[25]!;
  if (major !== 1 || minor > 4) throw new LasError(`unsupported LAS version ${major}.${minor}`);
  const headerSize = v.getUint16(94, true);
  const offsetToPoints = v.getUint32(96, true);
  const formatByte = bytes[104]!;
  if (formatByte & 0x80) throw new LasError("compressed (LAZ) point data is not supported");
  const format = formatByte & 0x3f;
  const recordLength = v.getUint16(105, true);
  const minRecord = MIN_RECORD[format];
  if (minRecord === undefined) throw new LasError(`unsupported point data record format ${format}`);
  if (recordLength < minRecord) throw new LasError(`record length ${recordLength} too short for format ${format}`);
  let count = v.getUint32(107, true);
  if (minor >= 4 && headerSize >= 375 && count === 0) {
    if (bytes.byteLength < 255) throw new LasError("truncated LAS 1.4 header");
    count = Number(v.getBigUint64(247, true));
  }
  if (offsetToPoints < headerSize) throw new LasError("invalid offset to point data");
  return {
    version: `${major}.${minor}`,
    pointFormat: format,
    recordLength,
    count,
    offsetToPoints,
    scale: [131, 139, 147].map((o) => v.getFloat64(o, true)) as [number, number, number],
    offset: [155, 163, 171].map((o) => v.getFloat64(o, true)) as [number, number, number],
    max: [179, 195, 211].map((o) => v.getFloat64(o, true)) as [number, number, number],
    min: [187, 203, 219].map((o) => v.getFloat64(o, true)) as [number, number, number],
    rgbOffset: RGB_OFFSET[format] ?? null,
  };
}

/**
 * Call `fn` for each of `n` whole point records at the start of `bytes`
 * (scaled x, y, z; classification; 16-bit RGB, 0 when the format has none).
 * `bytes` holds records only, with no header, so a streaming reader can pass
 * any chunk that starts on a record boundary.
 */
export function forEachLasRecord(
  bytes: Uint8Array,
  header: LasHeader,
  n: number,
  fn: (x: number, y: number, z: number, classification: number, r: number, g: number, b: number) => void,
): void {
  const { recordLength, scale, offset, rgbOffset } = header;
  if (n * recordLength > bytes.byteLength) throw new LasError("chunk shorter than the records requested");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0, o = 0; i < n; i++, o += recordLength) {
    fn(
      v.getInt32(o, true) * scale[0] + offset[0],
      v.getInt32(o + 4, true) * scale[1] + offset[1],
      v.getInt32(o + 8, true) * scale[2] + offset[2],
      bytes[o + 15]! & 0x1f,
      rgbOffset === null ? 0 : v.getUint16(o + rgbOffset, true),
      rgbOffset === null ? 0 : v.getUint16(o + rgbOffset + 2, true),
      rgbOffset === null ? 0 : v.getUint16(o + rgbOffset + 4, true),
    );
  }
}

export function readLas(bytes: Uint8Array): LasPoints {
  const header = parseLasHeader(bytes);
  const { count, recordLength, offsetToPoints, min, max } = header;
  if (offsetToPoints > bytes.byteLength) throw new LasError("invalid offset to point data");
  const need = offsetToPoints + count * recordLength;
  if (need > bytes.byteLength) throw new LasError(`truncated point data: need ${need} bytes, got ${bytes.byteLength}`);
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const z = new Float64Array(count);
  const classification = new Uint8Array(count);
  const rgb = header.rgbOffset === null ? null : new Uint16Array(count * 3);
  let i = 0;
  forEachLasRecord(bytes.subarray(offsetToPoints), header, count, (px, py, pz, cls, r, g, b) => {
    x[i] = px;
    y[i] = py;
    z[i] = pz;
    classification[i] = cls;
    if (rgb) {
      rgb[i * 3] = r;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = b;
    }
    i++;
  });
  return { version: header.version, pointFormat: header.pointFormat, count, x, y, z, classification, rgb, min, max };
}

/** Write an uncompressed LAS 1.2 file with point format 3 (for tests and fixtures). */
export function writeLas12Format3(points: ReadonlyArray<{ x: number; y: number; z: number; cls: number; rgb: [number, number, number] }>, scale = 0.001): Uint8Array {
  const header = 227;
  const rec = 34;
  const out = new Uint8Array(header + points.length * rec);
  const v = new DataView(out.buffer);
  "LASF".split("").forEach((c, i) => (out[i] = c.charCodeAt(0)));
  out[24] = 1;
  out[25] = 2;
  v.setUint16(94, header, true);
  v.setUint32(96, header, true);
  out[104] = 3;
  v.setUint16(105, rec, true);
  v.setUint32(107, points.length, true);
  for (const o of [131, 139, 147]) v.setFloat64(o, scale, true);
  const ext = (k: "x" | "y" | "z", f: (a: number, b: number) => number) => points.reduce((m, p) => f(m, p[k]), points[0]?.[k] ?? 0);
  v.setFloat64(179, ext("x", Math.max), true);
  v.setFloat64(187, ext("x", Math.min), true);
  v.setFloat64(195, ext("y", Math.max), true);
  v.setFloat64(203, ext("y", Math.min), true);
  v.setFloat64(211, ext("z", Math.max), true);
  v.setFloat64(219, ext("z", Math.min), true);
  points.forEach((p, i) => {
    const o = header + i * rec;
    v.setInt32(o, Math.round(p.x / scale), true);
    v.setInt32(o + 4, Math.round(p.y / scale), true);
    v.setInt32(o + 8, Math.round(p.z / scale), true);
    out[o + 15] = p.cls;
    v.setUint16(o + 28, p.rgb[0], true);
    v.setUint16(o + 30, p.rgb[1], true);
    v.setUint16(o + 32, p.rgb[2], true);
  });
  return out;
}
