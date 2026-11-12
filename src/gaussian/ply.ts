/**
 * Minimal PLY reader and writer for 3D Gaussian Splatting files.
 *
 * Scope: `format binary_little_endian 1.0` with a single `vertex` element
 * of scalar properties. That is the layout written by the reference 3DGS
 * implementation (x y z nx ny nz f_dc_* f_rest_* opacity scale_* rot_*).
 * Anything else (ASCII, big-endian, list properties, other elements,
 * truncated data) is rejected with PlyError. No DOM or Node dependency.
 */

export class PlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlyError";
  }
}

type ScalarType = "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "float32" | "float64";

const TYPE_ALIASES: Record<string, ScalarType> = {
  char: "int8", int8: "int8",
  uchar: "uint8", uint8: "uint8",
  short: "int16", int16: "int16",
  ushort: "uint16", uint16: "uint16",
  int: "int32", int32: "int32",
  uint: "uint32", uint32: "uint32",
  float: "float32", float32: "float32",
  double: "float64", float64: "float64",
};

const TYPE_SIZE: Record<ScalarType, number> = {
  int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4, float64: 8,
};

export interface PlyVertices {
  count: number;
  /** Property names in file order. */
  names: string[];
  /** One column per property, as float64 values. */
  columns: Record<string, Float64Array>;
}

const MAX_HEADER_BYTES = 64 * 1024;

/** PLY headers are ASCII; decode byte-per-char without TextDecoder (keeps src/ free of DOM/Node globals). */
function asciiDecode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.byteLength; i += 4096) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + 4096, bytes.byteLength)));
  }
  return out;
}

function asciiEncode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0x7f) throw new PlyError("PLY header must be ASCII");
    out[i] = c;
  }
  return out;
}

export function readPly(bytes: Uint8Array): PlyVertices {
  // Locate "end_header\n" within a bounded prefix.
  const limit = Math.min(bytes.byteLength, MAX_HEADER_BYTES);
  const prefix = asciiDecode(bytes.subarray(0, limit));
  const end = prefix.indexOf("end_header\n");
  if (!prefix.startsWith("ply\n") || end < 0) throw new PlyError("not a PLY file or header too long");
  const headerLines = prefix.slice(0, end).split("\n").map((l: string) => l.trim()).filter((l: string) => l !== "");
  const bodyStart = end + "end_header\n".length;

  let format = "";
  let count = -1;
  let elements = 0;
  const props: Array<{ name: string; type: ScalarType }> = [];
  for (const line of headerLines.slice(1)) {
    const [kw, ...rest] = line.split(/\s+/);
    if (kw === "comment" || kw === "obj_info") continue;
    if (kw === "format") format = rest.join(" ");
    else if (kw === "element") {
      elements++;
      if (rest[0] !== "vertex" || elements > 1) throw new PlyError(`unsupported element: ${line}`);
      count = Number(rest[1]);
      if (!Number.isSafeInteger(count) || count < 0) throw new PlyError(`invalid vertex count: ${rest[1]}`);
    } else if (kw === "property") {
      if (rest[0] === "list") throw new PlyError(`list properties are not supported: ${line}`);
      const type = TYPE_ALIASES[rest[0] ?? ""];
      const name = rest[1];
      if (!type || !name) throw new PlyError(`invalid property: ${line}`);
      if (props.some((p) => p.name === name)) throw new PlyError(`duplicate property: ${name}`);
      props.push({ name, type });
    } else throw new PlyError(`unsupported header line: ${line}`);
  }
  if (format !== "binary_little_endian 1.0") throw new PlyError(`unsupported format: ${format || "(none)"}`);
  if (count < 0) throw new PlyError("missing vertex element");

  const stride = props.reduce((n, p) => n + TYPE_SIZE[p.type], 0);
  const need = bodyStart + stride * count;
  if (bytes.byteLength < need) throw new PlyError(`truncated: need ${need} bytes, got ${bytes.byteLength}`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const columns: Record<string, Float64Array> = {};
  let offset = 0;
  for (const p of props) {
    const col = new Float64Array(count);
    const get = reader(view, p.type);
    for (let i = 0, o = bodyStart + offset; i < count; i++, o += stride) col[i] = get(o);
    columns[p.name] = col;
    offset += TYPE_SIZE[p.type];
  }
  return { count, names: props.map((p) => p.name), columns };
}

function reader(view: DataView, type: ScalarType): (offset: number) => number {
  switch (type) {
    case "int8": return (o) => view.getInt8(o);
    case "uint8": return (o) => view.getUint8(o);
    case "int16": return (o) => view.getInt16(o, true);
    case "uint16": return (o) => view.getUint16(o, true);
    case "int32": return (o) => view.getInt32(o, true);
    case "uint32": return (o) => view.getUint32(o, true);
    case "float32": return (o) => view.getFloat32(o, true);
    case "float64": return (o) => view.getFloat64(o, true);
  }
}

/** Write float32 vertex properties as binary_little_endian PLY (for fixtures and tests). */
export function writePlyFloat32(names: readonly string[], rows: ReadonlyArray<ArrayLike<number>>): Uint8Array {
  const header = ["ply", "format binary_little_endian 1.0", `element vertex ${rows.length}`,
    ...names.map((n) => `property float ${n}`), "end_header", ""].join("\n");
  const head = asciiEncode(header);
  const out = new Uint8Array(head.byteLength + rows.length * names.length * 4);
  out.set(head, 0);
  const view = new DataView(out.buffer);
  let o = head.byteLength;
  for (const row of rows) {
    if (row.length !== names.length) throw new PlyError("row length does not match property count");
    for (let k = 0; k < names.length; k++, o += 4) view.setFloat32(o, row[k] as number, true);
  }
  return out;
}
