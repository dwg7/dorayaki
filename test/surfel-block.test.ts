import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_LEVELS,
  SURFEL_BLOCK_HEADER_BYTES,
  SURFEL_RECORD_BYTES,
  SurfelBlockError,
  decodeSurfelBlock,
  decodeSurfelBlockWithLevels,
  encodeSurfelBlock,
  packQuaternion,
  packedSurfelBlock,
  unpackQuaternion,
  type Splat,
  type SurfelBlockErrorCode,
} from "../src/surfel-block.js";

/** x = 1/4 and y = 1/2 of the tile, scales that are exact powers of two, identity rotation. */
const ONE: Splat = {
  x: 0.25, y: 0.5, z: 100,
  sx: 0.125, sy: 0.5, sz: 0.03125,
  qw: 1, qx: 0, qy: 0, qz: 0,
  r: 12, g: 20, b: 32, a: 255,
};

function assertRejects(bytes: Uint8Array, code: SurfelBlockErrorCode): void {
  assert.throws(() => decodeSurfelBlock(bytes), (err: unknown) => err instanceof SurfelBlockError && err.code === code);
}
const assertEncodeRejects = (splats: Splat[], code: SurfelBlockErrorCode): void =>
  assert.throws(() => encodeSurfelBlock(splats), (e: unknown) => e instanceof SurfelBlockError && e.code === code);

/** First record offset of a block with a one-level table. */
const RECORDS_AT = SURFEL_BLOCK_HEADER_BYTES + 4;

/** Header with arbitrary fields and a level table, followed by `recordBytes` zero bytes. */
function rawBlock(opts: {
  magic?: string; version?: number; recordSize?: number; count: number; recordBytes: number;
  levels?: number[]; levelCount?: number; zOrigin?: number; zStep?: number; scaleBase?: number;
}): Uint8Array {
  const levels = opts.levels ?? [opts.count];
  const bytes = new Uint8Array(SURFEL_BLOCK_HEADER_BYTES + 4 * levels.length + opts.recordBytes);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(opts.magic ?? "DSRF"), 0);
  view.setUint16(4, opts.version ?? 6, true);
  view.setUint16(6, opts.recordSize ?? SURFEL_RECORD_BYTES, true);
  view.setUint32(8, opts.count, true);
  view.setUint32(12, opts.levelCount ?? levels.length, true);
  view.setFloat64(16, opts.zOrigin ?? 0, true);
  view.setFloat64(24, opts.zStep ?? 0.001, true);
  view.setFloat32(32, opts.scaleBase ?? 0, true);
  bytes[36] = 255;
  levels.forEach((n, k) => view.setUint32(SURFEL_BLOCK_HEADER_BYTES + 4 * k, n, true));
  return bytes;
}

/** Rotation angle in degrees between two unit quaternions (q and -q are the same rotation). */
function angleDegrees(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/** Deterministic pseudo-random splats (no Math.random), one opacity. */
const rand = (() => { let a = 12345; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
const MANY: Splat[] = Array.from({ length: 300 }, () => {
  const w = rand() * 2 - 1, x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1, n = Math.hypot(w, x, y, z) || 1;
  return {
    x: rand() * 0.999, y: rand() * 0.999, z: 100 + rand() * 250,
    sx: 2 ** (-8 + rand() * 10), sy: 2 ** (-8 + rand() * 10), sz: 2 ** (-8 + rand() * 10),
    qw: w / n, qx: x / n, qy: y / n, qz: z / n,
    r: Math.floor(rand() * 256), g: Math.floor(rand() * 256), b: Math.floor(rand() * 256), a: 242,
  };
});

describe("encode/decode", () => {
  test("size: 40-byte header, 4 bytes per level, 12 bytes per splat", () => {
    assert.equal(encodeSurfelBlock(MANY).byteLength, 40 + 4 + 12 * MANY.length);
    assert.equal(encodeSurfelBlock([]).byteLength, 40 + 4);
    assert.equal(encodeSurfelBlock(MANY, [100, 200]).byteLength, 40 + 8 + 12 * MANY.length);
  });

  test("a zero-splat block round-trips", () => {
    const zero = decodeSurfelBlockWithLevels(encodeSurfelBlock([]));
    assert.deepEqual(zero.splats, []);
    assert.deepEqual(zero.levels, [0]);
  });

  test("one splat: header fields, and exact values where the grid allows", () => {
    const bytes = encodeSurfelBlock([ONE]);
    const view = new DataView(bytes.buffer);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "DSRF");
    assert.deepEqual([view.getUint16(4, true), view.getUint16(6, true), view.getUint32(8, true), view.getUint32(12, true)], [6, 12, 1, 1]);
    assert.equal(view.getFloat64(16, true), 100, "z origin is the block's lowest z");
    assert.equal(view.getFloat32(32, true), -5, "scale base is the block's smallest scale, log2");
    assert.equal(bytes[36], 255, "the block's one opacity");
    const [d] = decodeSurfelBlock(bytes);
    assert.deepEqual([d!.x, d!.y, d!.z, d!.sx, d!.sy, d!.sz, d!.qw, d!.qx, d!.qy, d!.qz, d!.a], [0.25, 0.5, 100, 0.125, 0.5, 0.03125, 1, 0, 0, 0, 255]);
    for (const k of ["r", "g", "b"] as const) assert.ok(Math.abs(d![k] - ONE[k]) <= 2, k);
  });

  test("decodes from a Uint8Array view with a non-zero byteOffset", () => {
    const block = encodeSurfelBlock([ONE]);
    const padded = new Uint8Array(block.byteLength + 7);
    padded.set(block, 3);
    assert.deepEqual(decodeSurfelBlock(padded.subarray(3, 3 + block.byteLength)), decodeSurfelBlock(block));
  });

  test("values come back within the documented quantization steps", () => {
    const back = decodeSurfelBlock(encodeSurfelBlock(MANY));
    assert.equal(back.length, MANY.length);
    const zRange = Math.max(...MANY.map((s) => s.z)) - Math.min(...MANY.map((s) => s.z));
    const zStep = Math.max(0.001, Math.ceil((zRange / 16383) * 1000 + 1e-9) / 1000);
    MANY.forEach((s, i) => {
      const d = back[i]!;
      assert.ok(Math.abs(d.x - s.x) <= 1 / 16384 + 1e-12 && Math.abs(d.y - s.y) <= 1 / 16384 + 1e-12, `xy ${i}`);
      assert.ok(Math.abs(d.z - s.z) <= zStep / 2 + 1e-4, `z ${i}: ${d.z} vs ${s.z}`);
      for (const k of ["sx", "sy", "sz"] as const) assert.ok(Math.abs(Math.log2(d[k] / s[k])) <= 1 / 12 + 1e-9, `${k} ${i}`);
      for (const k of ["r", "g", "b"] as const) assert.ok(Math.abs(d[k] - s[k]) <= 255 / 63 / 2 + 1, `${k} ${i}`);
      assert.equal(d.a, 242);
      assert.ok(angleDegrees([s.qw, s.qx, s.qy, s.qz], [d.qw, d.qx, d.qy, d.qz]) < 16, `rotation ${i}`);
    });
  });

  test("deterministic output", () => {
    assert.deepEqual(encodeSurfelBlock(MANY), encodeSurfelBlock(MANY));
  });

  test("preserves multiple z values at the same x/y (distinct vertical layers)", () => {
    const column: Splat[] = [0, 11, 12, 5].map((z) => ({ ...ONE, z }));
    const decoded = decodeSurfelBlock(encodeSurfelBlock(column));
    assert.deepEqual(decoded.map((s) => s.z), [0, 11, 12, 5]);
    assert.ok(decoded.every((s) => s.x === 0.25 && s.y === 0.5));
  });

  test("a block taller than 16.4 m widens the z step instead of failing", () => {
    const tall = [0, 100, 200, 123.456].map((z) => ({ ...ONE, z }));
    const bytes = encodeSurfelBlock(tall);
    const step = new DataView(bytes.buffer).getFloat64(24, true);
    assert.equal(step, 0.013); // 200 m / 16383 = 12.2 mm, rounded up to a whole millimetre
    const back = decodeSurfelBlock(bytes);
    tall.forEach((s, i) => assert.ok(Math.abs(back[i]!.z - s.z) <= step / 2 + 1e-4));
  });

  test("a negative z (below sea level) is a valid height", () => {
    const back = decodeSurfelBlock(encodeSurfelBlock([{ ...ONE, z: -3.2 }, { ...ONE, z: 4.1 }]));
    assert.ok(Math.abs(back[0]!.z - -3.2) < 1e-3 && Math.abs(back[1]!.z - 4.1) < 1e-3);
  });

  test("scales above 21 octaves over the smallest clamp instead of wrapping", () => {
    const wide = [{ ...ONE, sx: 2 ** -10, sy: 2 ** -10, sz: 2 ** -10 }, { ...ONE, x: 0.5, sx: 2 ** 20, sy: 2 ** 20, sz: 2 ** 20 }];
    const back = decodeSurfelBlock(encodeSurfelBlock(wide));
    // The base is the smallest scale (2^-10 m); code 127 is 127 / 6 = 21.17 octaves above it.
    assert.ok(Math.abs(Math.log2(back[1]!.sx) - (-10 + 127 / 6)) < 1e-9);
  });
});

describe("rotation codes", () => {
  test("the identity and axis-aligned rotations are exact", () => {
    const h = Math.SQRT1_2;
    for (const q of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [h, h, 0, 0], [h, 0, h, 0], [h, 0, 0, h], [h, -h, 0, 0]]) {
      assert.ok(angleDegrees(q, unpackQuaternion(packQuaternion(q[0]!, q[1]!, q[2]!, q[3]!))) < 1e-6, `${q}`);
    }
  });

  test("q and -q pack to the same code; input need not be normalized", () => {
    const q = [0.3, -0.5, 0.1, 0.8];
    const n = q.map((v) => v / Math.hypot(...q));
    assert.equal(packQuaternion(q[0]!, q[1]!, q[2]!, q[3]!), packQuaternion(n[0]!, n[1]!, n[2]!, n[3]!));
    assert.equal(packQuaternion(-n[0]!, -n[1]!, -n[2]!, -n[3]!), packQuaternion(n[0]!, n[1]!, n[2]!, n[3]!));
  });

  test("unpacking rejects the unused code 31", () => {
    assert.throws(() => unpackQuaternion(31 << 2), SurfelBlockError);
  });
});

describe("encoder rejects invalid splats", () => {
  const cases: Array<[string, Partial<Splat>]> = [
    ["NaN position", { z: Number.NaN }],
    ["x outside [0, 1)", { x: 1 }],
    ["negative y", { y: -0.001 }],
    ["zero scale", { sy: 0 }],
    ["negative scale", { sx: -1 }],
    ["infinite scale", { sz: Number.POSITIVE_INFINITY }],
    ["zero quaternion", { qw: 0, qx: 0, qy: 0, qz: 0 }],
    ["color above 255", { r: 256 }],
    ["fractional color", { g: 1.5 }],
    ["negative opacity", { a: -1 }],
  ];
  for (const [name, patch] of cases) test(name, () => assertEncodeRejects([{ ...ONE, ...patch }], "INVALID_VALUE"));
  test("splats with different opacities in one block", () => assertEncodeRejects([ONE, { ...ONE, a: 10 }], "INVALID_VALUE"));
});

describe("decoder rejects malformed input", () => {
  test("bad magic", () => assertRejects(rawBlock({ magic: "DSRX", count: 0, recordBytes: 0 }), "BAD_MAGIC"));

  test("any version other than 6 (versions 1 to 5 are no longer read)", () => {
    for (const version of [0, 1, 2, 3, 4, 5, 7]) assertRejects(rawBlock({ version, count: 0, recordBytes: 0 }), "UNSUPPORTED_VERSION");
  });

  test("unexpected record size", () => assertRejects(rawBlock({ recordSize: 16, count: 0, recordBytes: 0 }), "BAD_RECORD_SIZE"));

  test("truncated header at every length (fixed part and level table)", () => {
    const full = encodeSurfelBlock([]);
    for (let len = 0; len < RECORDS_AT; len++) assertRejects(full.subarray(0, len), "TRUNCATED_HEADER");
  });

  test("truncated record data at every cut point", () => {
    const full = encodeSurfelBlock([ONE, ONE]);
    for (let len = RECORDS_AT; len < full.byteLength; len++) assertRejects(full.subarray(0, len), "TRUNCATED_RECORDS");
  });

  test("declared count larger than the data, including a huge count (no allocation)", () => {
    assertRejects(rawBlock({ count: 3, recordBytes: 2 * SURFEL_RECORD_BYTES }), "TRUNCATED_RECORDS");
    assertRejects(rawBlock({ count: 0xffffffff, recordBytes: SURFEL_RECORD_BYTES }), "TRUNCATED_RECORDS");
  });

  test("declared count smaller than the data (trailing bytes)", () => {
    assertRejects(rawBlock({ count: 1, recordBytes: 2 * SURFEL_RECORD_BYTES }), "TRAILING_BYTES");
    assertRejects(Uint8Array.from([...encodeSurfelBlock([ONE]), 0]), "TRAILING_BYTES");
  });

  test("invalid z origin, z step or scale base", () => {
    for (const patch of [{ zStep: 0 }, { zStep: -0.001 }, { zStep: Number.NaN }, { zOrigin: Number.POSITIVE_INFINITY }, { scaleBase: Number.NaN }]) {
      assertRejects(rawBlock({ count: 0, recordBytes: 0, ...patch }), "INVALID_VALUE");
    }
  });
});

describe("level table", () => {
  test("levels round-trip and default to one level", () => {
    const three = [ONE, { ...ONE, z: 101 }, { ...ONE, z: 102 }];
    assert.deepEqual(decodeSurfelBlockWithLevels(encodeSurfelBlock(three)).levels, [3]);
    const block = decodeSurfelBlockWithLevels(encodeSurfelBlock(three, [1, 0, 2]));
    assert.deepEqual(block.levels, [1, 0, 2]);
    assert.deepEqual(block.splats, decodeSurfelBlock(encodeSurfelBlock(three)));
  });

  test("encoder rejects inconsistent level tables", () => {
    for (const levels of [[2], [], [0.5, 0.5], new Array(MAX_LEVELS + 1).fill(0)]) {
      assert.throws(() => encodeSurfelBlock([ONE], levels), (e: unknown) => e instanceof SurfelBlockError && e.code === "BAD_LEVELS");
    }
  });

  test("decoder rejects level tables that disagree with the count, and zero or huge level counts", () => {
    assertRejects(rawBlock({ count: 1, recordBytes: SURFEL_RECORD_BYTES, levels: [2] }), "BAD_LEVELS");
    assertRejects(rawBlock({ count: 2, recordBytes: 2 * SURFEL_RECORD_BYTES, levels: [1, 0] }), "BAD_LEVELS");
    assertRejects(rawBlock({ count: 0, recordBytes: 0, levels: [], levelCount: 0 }), "BAD_LEVELS");
    assertRejects(rawBlock({ count: 0, recordBytes: 0, levels: [0], levelCount: 0xffffffff }), "BAD_LEVELS");
    assertRejects(rawBlock({ count: 0, recordBytes: 0, levels: [0], levelCount: MAX_LEVELS + 1 }), "BAD_LEVELS");
  });

  test("a level table cut short is a truncated header", () => {
    const full = encodeSurfelBlock([ONE, ONE], [1, 1]);
    assertRejects(full.subarray(0, SURFEL_BLOCK_HEADER_BYTES + 4), "TRUNCATED_HEADER");
  });
});

describe("packedSurfelBlock", () => {
  test("gives the records as stored, the level table and the scale base", () => {
    const bytes = encodeSurfelBlock(MANY, [100, 200]);
    const p = packedSurfelBlock(bytes);
    assert.equal(p.count, 300);
    assert.deepEqual(p.levels, [100, 200]);
    assert.deepEqual(p.records, bytes.subarray(SURFEL_BLOCK_HEADER_BYTES + 8));
    assert.equal(p.scaleLog2Min, Math.fround(Math.min(...MANY.flatMap((s) => [Math.log2(s.sx), Math.log2(s.sy), Math.log2(s.sz)]))));
  });

  test("rejects what the decoder rejects", () => {
    const bytes = encodeSurfelBlock([ONE]);
    assert.throws(() => packedSurfelBlock(bytes.subarray(0, bytes.length - 1)), SurfelBlockError);
    assert.throws(() => packedSurfelBlock(new Uint8Array(10)), SurfelBlockError);
  });
});
