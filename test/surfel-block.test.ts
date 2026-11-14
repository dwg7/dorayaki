import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_LEVELS,
  SURFEL_BLOCK_HEADER_BYTES,
  SURFEL_RECORD_BYTES,
  SurfelBlockError,
  decodeScale,
  decodeSurfelBlock,
  decodeSurfelBlockWithLevels,
  encodeScale,
  encodeSurfelBlock,
  packQuaternion,
  unpackQuaternion,
  type Splat,
  type SurfelBlockErrorCode,
} from "../src/surfel-block.js";

/** x = 1/4 and y = 1/2 of the tile, scales that are exact powers of two, identity rotation. */
const ONE: Splat = {
  x: 0.25, y: 0.5, z: 100,
  sx: 0.125, sy: 0.5, sz: 0.03125,
  qw: 1, qx: 0, qy: 0, qz: 0,
  r: 10, g: 20, b: 30, a: 255,
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const Z_STEP_HEX = "fca9f1d24d62503f"; // float64 0.001, little-endian

function assertRejects(bytes: Uint8Array, code: SurfelBlockErrorCode): void {
  assert.throws(
    () => decodeSurfelBlock(bytes),
    (err: unknown) => err instanceof SurfelBlockError && err.code === code,
  );
}

const assertEncodeRejects = (splats: Splat[], code: SurfelBlockErrorCode): void =>
  assert.throws(() => encodeSurfelBlock(splats), (e: unknown) => e instanceof SurfelBlockError && e.code === code);

/** First record offset of a block with a one-level table. */
const RECORDS_AT = SURFEL_BLOCK_HEADER_BYTES + 4;

/** Header with arbitrary fields and a level table, followed by `recordBytes` zero bytes. */
function rawBlock(opts: {
  magic?: string; version?: number; recordSize?: number; count: number; recordBytes: number;
  levels?: number[]; levelCount?: number; zOrigin?: number; zStep?: number;
}): Uint8Array {
  const levels = opts.levels ?? [opts.count];
  const bytes = new Uint8Array(SURFEL_BLOCK_HEADER_BYTES + 4 * levels.length + opts.recordBytes);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(opts.magic ?? "DSRF"), 0);
  view.setUint16(4, opts.version ?? 4, true);
  view.setUint16(6, opts.recordSize ?? SURFEL_RECORD_BYTES, true);
  view.setUint32(8, opts.count, true);
  view.setUint32(12, opts.levelCount ?? levels.length, true);
  view.setFloat64(16, opts.zOrigin ?? 0, true);
  view.setFloat64(24, opts.zStep ?? 0.001, true);
  levels.forEach((n, k) => view.setUint32(SURFEL_BLOCK_HEADER_BYTES + 4 * k, n, true));
  return bytes;
}

/** Rotation angle in degrees between two unit quaternions (q and -q are the same rotation). */
function angleDegrees(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/** Deterministic pseudo-random unit quaternions (xorshift, no Math.random). */
function quaternions(n: number): number[][] {
  let s = 0x9e3779b9;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
  return Array.from({ length: n }, () => {
    const q = [gauss(), gauss(), gauss(), gauss()];
    const l = Math.hypot(...q);
    return q.map((v) => v / l);
  });
}

describe("encode/decode", () => {
  test("empty block is header and level table only, and round-trips", () => {
    const bytes = encodeSurfelBlock([]);
    assert.equal(
      hex(bytes),
      "44535246" + "0400" + "1000" + "00000000" + "01000000" + "0000000000000000" + Z_STEP_HEX + "00000000",
    );
    assert.deepEqual(decodeSurfelBlock(bytes), []);
  });

  test("one splat has the exact little-endian layout and round-trips exactly", () => {
    const bytes = encodeSurfelBlock([ONE]);
    assert.equal(bytes.byteLength, 32 + 4 + 16);
    assert.equal(
      hex(bytes),
      "44535246" + "0400" + "1000" + "01000000" + "01000000" +
        "0000000000005940" + // z origin = 100 (float64)
        Z_STEP_HEX + // z step = 0.001
        "01000000" + // level 0 holds 1 splat
        "0040" + // x = 16384 / 65536 = 0.25
        "0080" + // y = 32768 / 65536 = 0.5
        "0000" + // z = origin + 0 steps
        "82" + "96" + "6e" + // scales 2^-3, 2^-1, 2^-5: codes 130, 150, 110
        "fc7e3f" + // rotation: largest = w (index 0), x, y, z codes 63 (= 0)
        "0a141eff", // r g b a
    );
    assert.deepEqual(decodeSurfelBlock(bytes), [ONE]);
  });

  test("decodes from a Uint8Array view with a non-zero byteOffset", () => {
    const block = encodeSurfelBlock([ONE]);
    const padded = new Uint8Array(block.byteLength + 7);
    padded.set(block, 3);
    assert.deepEqual(decodeSurfelBlock(padded.subarray(3, 3 + block.byteLength)), [ONE]);
  });

  test("values come back within the documented quantization tolerances", () => {
    const rotations = quaternions(40);
    const splats: Splat[] = rotations.map((q, i) => ({
      x: ((i * 37) % 1000) / 1000 + 0.00013, y: ((i * 91) % 1000) / 1000 + 0.00007, z: 5 + i * 0.317,
      sx: 0.01 * (1 + i), sy: 0.02 * (1 + (i % 7)), sz: 0.003 * (1 + (i % 5)),
      qw: q[0]!, qx: q[1]!, qy: q[2]!, qz: q[3]!,
      r: i, g: 255 - i, b: (i * 7) % 256, a: 200,
    }));
    const back = decodeSurfelBlock(encodeSurfelBlock(splats));
    splats.forEach((s, i) => {
      const d = back[i]!;
      assert.ok(Math.abs(d.x - s.x) <= 0.5 / 65536 + 1e-12, `x ${i}`);
      assert.ok(Math.abs(d.y - s.y) <= 0.5 / 65536 + 1e-12, `y ${i}`);
      assert.ok(Math.abs(d.z - s.z) <= 0.0005 + 1e-6, `z ${i}`);
      for (const k of ["sx", "sy", "sz"] as const) assert.ok(Math.abs(Math.log2(d[k] / s[k])) <= 0.05 + 1e-9, `${k} ${i}`);
      assert.ok(angleDegrees([s.qw, s.qx, s.qy, s.qz], [d.qw, d.qx, d.qy, d.qz]) < 1.3, `rotation ${i}`);
      assert.deepEqual([d.r, d.g, d.b, d.a], [s.r, s.g, s.b, s.a]);
    });
  });

  test("preserves multiple z values at the same x/y (distinct vertical layers)", () => {
    const column: Splat[] = [0, 11, 12, 5].map((z) => ({ ...ONE, z }));
    const decoded = decodeSurfelBlock(encodeSurfelBlock(column));
    assert.deepEqual(decoded.map((s) => s.z), [0, 11, 12, 5]);
    assert.ok(decoded.every((s) => s.x === 0.25 && s.y === 0.5));
  });

  test("a block taller than 65.5 m widens the z step instead of failing", () => {
    const tall = [0, 100, 200, 123.456].map((z) => ({ ...ONE, z }));
    const bytes = encodeSurfelBlock(tall);
    const step = new DataView(bytes.buffer).getFloat64(24, true);
    assert.equal(step, 0.004); // 200 m / 65535 = 3.05 mm, rounded up to a whole millimetre
    const back = decodeSurfelBlock(bytes);
    tall.forEach((s, i) => assert.ok(Math.abs(back[i]!.z - s.z) <= step / 2 + 1e-6));
  });

  test("a negative z (below sea level) is a valid height", () => {
    const back = decodeSurfelBlock(encodeSurfelBlock([{ ...ONE, z: -3.2 }, { ...ONE, z: 4.1 }]));
    assert.ok(Math.abs(back[0]!.z - -3.2) < 1e-3 && Math.abs(back[1]!.z - 4.1) < 1e-3);
  });
});

describe("scale and rotation codes", () => {
  test("scale codes are a 10-per-octave log grid from 15 µm to about 724 m", () => {
    assert.equal(encodeScale(2 ** -16), 0);
    assert.equal(encodeScale(1), 160);
    assert.equal(decodeScale(160), 1);
    assert.equal(encodeScale(1e-9), 0); // clamped
    assert.equal(encodeScale(1e9), 255); // clamped
    for (const m of [0.001, 0.0123, 0.5, 3.7, 120]) assert.ok(Math.abs(Math.log2(decodeScale(encodeScale(m)) / m)) <= 0.05 + 1e-9);
  });

  test("a rotation whose four components are all about 0.5 is the hardest case (about 1.2 degrees)", () => {
    const q = [0.5, 0.5, 0.5, 0.5];
    const back = unpackQuaternion(packQuaternion(q[0]!, q[1]!, q[2]!, q[3]!));
    assert.ok(angleDegrees(q, back) < 1.25);
  });

  test("the identity and axis-aligned rotations are exact", () => {
    const h = Math.SQRT1_2;
    const exact: number[][] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [h, h, 0, 0], [h, 0, h, 0], [h, 0, 0, h], [h, -h, 0, 0]];
    for (const q of exact) {
      const [w, x, y, z] = unpackQuaternion(packQuaternion(q[0]!, q[1]!, q[2]!, q[3]!));
      assert.ok(angleDegrees(q, [w, x, y, z]) < 1e-6, `${q}`);
    }
  });

  test("random rotations stay within 1.25 degrees (mean about 0.7)", () => {
    let worst = 0;
    let sum = 0;
    const all = quaternions(5000);
    for (const q of all) {
      const e = angleDegrees(q, unpackQuaternion(packQuaternion(q[0]!, q[1]!, q[2]!, q[3]!)));
      worst = Math.max(worst, e);
      sum += e;
    }
    assert.ok(worst < 1.25, `worst ${worst}`);
    assert.ok(sum / all.length < 0.75, `mean ${sum / all.length}`);
  });

  test("q and -q pack to the same code; input need not be normalized", () => {
    const q = [0.3, -0.5, 0.1, 0.8];
    const l = Math.hypot(...q);
    const n = q.map((v) => v / l);
    assert.equal(packQuaternion(q[0]!, q[1]!, q[2]!, q[3]!), packQuaternion(n[0]!, n[1]!, n[2]!, n[3]!));
    assert.equal(packQuaternion(-n[0]!, -n[1]!, -n[2]!, -n[3]!), packQuaternion(n[0]!, n[1]!, n[2]!, n[3]!));
  });

  test("unpacking rejects the reserved bit and the unused code 127", () => {
    assert.throws(() => unpackQuaternion(0x800000), SurfelBlockError);
    assert.throws(() => unpackQuaternion(127 << 2), SurfelBlockError);
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
    ["colour above 255", { r: 256 }],
    ["fractional colour", { g: 1.5 }],
    ["negative colour", { a: -1 }],
  ];
  for (const [name, patch] of cases) {
    test(name, () => assertEncodeRejects([{ ...ONE, ...patch }], "INVALID_VALUE"));
  }
});

describe("decoder rejects malformed input", () => {
  test("bad magic", () => {
    assertRejects(rawBlock({ magic: "DSRX", count: 0, recordBytes: 0 }), "BAD_MAGIC");
  });

  test("unsupported version", () => {
    // Versions 1-3 used a 12- or 16-byte header and 32-byte records.
    for (const version of [0, 1, 2, 3, 5]) assertRejects(rawBlock({ version, count: 0, recordBytes: 0 }), "UNSUPPORTED_VERSION");
  });

  test("unexpected record size", () => {
    assertRejects(rawBlock({ recordSize: 32, count: 0, recordBytes: 0 }), "BAD_RECORD_SIZE");
  });

  test("truncated header at every length 0..35 (fixed part and level table)", () => {
    const full = encodeSurfelBlock([]);
    for (let len = 0; len < RECORDS_AT; len++) assertRejects(full.subarray(0, len), "TRUNCATED_HEADER");
  });

  test("truncated record data at every cut point", () => {
    const full = encodeSurfelBlock([ONE, ONE]);
    for (let len = RECORDS_AT; len < full.byteLength; len++) assertRejects(full.subarray(0, len), "TRUNCATED_RECORDS");
  });

  test("declared count larger than data", () => {
    assertRejects(rawBlock({ count: 3, recordBytes: 2 * SURFEL_RECORD_BYTES }), "TRUNCATED_RECORDS");
  });

  test("huge declared count is rejected without allocation", () => {
    assertRejects(rawBlock({ count: 0xffffffff, recordBytes: SURFEL_RECORD_BYTES }), "TRUNCATED_RECORDS");
  });

  test("declared count smaller than data (trailing bytes)", () => {
    assertRejects(rawBlock({ count: 1, recordBytes: 2 * SURFEL_RECORD_BYTES }), "TRAILING_BYTES");
    const withExtraByte = new Uint8Array(RECORDS_AT + SURFEL_RECORD_BYTES + 1);
    withExtraByte.set(encodeSurfelBlock([ONE]));
    assertRejects(withExtraByte, "TRAILING_BYTES");
  });

  test("invalid z origin or step", () => {
    for (const patch of [{ zStep: 0 }, { zStep: -0.001 }, { zStep: Number.NaN }, { zOrigin: Number.POSITIVE_INFINITY }]) {
      assertRejects(rawBlock({ count: 0, recordBytes: 0, ...patch }), "INVALID_VALUE");
    }
  });

  test("a record with the reserved rotation bit set, or code 127", () => {
    const reserved = encodeSurfelBlock([ONE]);
    reserved[RECORDS_AT + 11] = reserved[RECORDS_AT + 11]! | 0x80; // bit 23
    assertRejects(reserved, "INVALID_VALUE");
    const unused = encodeSurfelBlock([ONE]);
    unused[RECORDS_AT + 9] = 0xfc; // rotation bits 2..8 = the first component's code ...
    unused[RECORDS_AT + 10] = 0x7f; // ... = 127 (bit 8 is bit 0 of this byte)
    assertRejects(unused, "INVALID_VALUE");
  });
});

describe("level table", () => {
  test("levels round-trip and default to one level", () => {
    const three = [ONE, { ...ONE, z: 101 }, { ...ONE, z: 102 }];
    assert.deepEqual(decodeSurfelBlockWithLevels(encodeSurfelBlock(three)).levels, [3]);
    const block = decodeSurfelBlockWithLevels(encodeSurfelBlock(three, [1, 0, 2]));
    assert.deepEqual(block.levels, [1, 0, 2]);
    assert.deepEqual(block.splats, three);
    assert.equal(encodeSurfelBlock(three, [1, 0, 2]).byteLength, 32 + 3 * 4 + 3 * 16);
  });

  test("encoder rejects inconsistent level tables", () => {
    for (const levels of [[2], [], [0.5, 0.5], new Array(MAX_LEVELS + 1).fill(0)]) {
      assert.throws(() => encodeSurfelBlock([ONE], levels), (e: unknown) => e instanceof SurfelBlockError && e.code === "BAD_LEVELS");
    }
  });

  test("decoder rejects level tables that disagree with the count", () => {
    assertRejects(rawBlock({ count: 1, recordBytes: SURFEL_RECORD_BYTES, levels: [2] }), "BAD_LEVELS");
    assertRejects(rawBlock({ count: 2, recordBytes: 2 * SURFEL_RECORD_BYTES, levels: [1, 0] }), "BAD_LEVELS");
  });

  test("decoder rejects zero or huge level counts before reading the table", () => {
    assertRejects(rawBlock({ count: 0, recordBytes: 0, levels: [], levelCount: 0 }), "BAD_LEVELS");
    assertRejects(rawBlock({ count: 0, recordBytes: 0, levels: [0], levelCount: 0xffffffff }), "BAD_LEVELS");
    assertRejects(rawBlock({ count: 0, recordBytes: 0, levels: [0], levelCount: MAX_LEVELS + 1 }), "BAD_LEVELS");
  });

  test("a level table cut short is a truncated header", () => {
    const full = encodeSurfelBlock([ONE, ONE], [1, 1]);
    assertRejects(full.subarray(0, SURFEL_BLOCK_HEADER_BYTES + 4), "TRUNCATED_HEADER");
  });
});
