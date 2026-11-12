import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SURFEL_BLOCK_HEADER_BYTES,
  SURFEL_RECORD_BYTES,
  SurfelBlockError,
  decodeSurfelBlock,
  encodeSurfelBlock,
  type Surfel,
  type SurfelBlockErrorCode,
} from "../src/surfel-block.js";

const ONE: Surfel = { x: 1.5, y: -2.25, z: 100, nx: 0, ny: 0, nz: 1, radius: 0.5, r: 10, g: 20, b: 30, a: 255 };

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function assertRejects(bytes: Uint8Array, code: SurfelBlockErrorCode): void {
  assert.throws(
    () => decodeSurfelBlock(bytes),
    (err: unknown) => err instanceof SurfelBlockError && err.code === code,
  );
}

/** Header with arbitrary fields, followed by `recordBytes` zero bytes. */
function rawBlock(opts: { magic?: string; version?: number; recordSize?: number; count: number; recordBytes: number }): Uint8Array {
  const bytes = new Uint8Array(SURFEL_BLOCK_HEADER_BYTES + opts.recordBytes);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(opts.magic ?? "DSRF"), 0);
  view.setUint16(4, opts.version ?? 1, true);
  view.setUint16(6, opts.recordSize ?? SURFEL_RECORD_BYTES, true);
  view.setUint32(8, opts.count, true);
  return bytes;
}

describe("encode/decode", () => {
  test("empty block is header only and round-trips", () => {
    const bytes = encodeSurfelBlock([]);
    assert.equal(hex(bytes), "44535246" + "0100" + "2000" + "00000000");
    assert.deepEqual(decodeSurfelBlock(bytes), []);
  });

  test("one surfel has the exact little-endian layout and round-trips", () => {
    const bytes = encodeSurfelBlock([ONE]);
    assert.equal(bytes.byteLength, 12 + 32);
    assert.equal(
      hex(bytes),
      "44535246" + "0100" + "2000" + "01000000" +
        "0000c03f" + // x = 1.5
        "000010c0" + // y = -2.25
        "0000c842" + // z = 100
        "00000000" + // nx = 0
        "00000000" + // ny = 0
        "0000803f" + // nz = 1
        "0000003f" + // radius = 0.5
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

  test("preserves multiple z values at the same x/y", () => {
    const column: Surfel[] = [
      { ...ONE, z: 0, nz: 1 },
      { ...ONE, z: 10, nz: -1 },
      { ...ONE, z: 12, nz: 1 },
      { ...ONE, z: 5, nx: 1, nz: 0 },
    ];
    const decoded = decodeSurfelBlock(encodeSurfelBlock(column));
    assert.deepEqual(decoded, column);
    assert.deepEqual(decoded.map((s) => s.z), [0, 10, 12, 5]);
  });

  test("floats are rounded to float32", () => {
    const [s] = decodeSurfelBlock(encodeSurfelBlock([{ ...ONE, x: 0.1 }]));
    assert.equal(s?.x, Math.fround(0.1));
  });
});

describe("encoder rejects invalid surfels", () => {
  const cases: Array<[string, Partial<Surfel>]> = [
    ["NaN position", { x: Number.NaN }],
    ["infinite normal", { ny: Number.POSITIVE_INFINITY }],
    ["negative radius", { radius: -1 }],
    ["colour above 255", { r: 256 }],
    ["fractional colour", { g: 1.5 }],
    ["negative colour", { a: -1 }],
  ];
  for (const [name, patch] of cases) {
    test(name, () => {
      assert.throws(
        () => encodeSurfelBlock([{ ...ONE, ...patch }]),
        (err: unknown) => err instanceof SurfelBlockError && err.code === "INVALID_VALUE",
      );
    });
  }
});

describe("decoder rejects malformed input", () => {
  test("bad magic", () => {
    assertRejects(rawBlock({ magic: "DSRX", count: 0, recordBytes: 0 }), "BAD_MAGIC");
  });

  test("unsupported version", () => {
    assertRejects(rawBlock({ version: 0, count: 0, recordBytes: 0 }), "UNSUPPORTED_VERSION");
    assertRejects(rawBlock({ version: 2, count: 0, recordBytes: 0 }), "UNSUPPORTED_VERSION");
  });

  test("unexpected record size", () => {
    assertRejects(rawBlock({ recordSize: 28, count: 0, recordBytes: 0 }), "BAD_RECORD_SIZE");
  });

  test("truncated header at every length 0..11", () => {
    const full = encodeSurfelBlock([]);
    for (let len = 0; len < SURFEL_BLOCK_HEADER_BYTES; len++) {
      assertRejects(full.subarray(0, len), "TRUNCATED_HEADER");
    }
  });

  test("truncated record data at every cut point", () => {
    const full = encodeSurfelBlock([ONE, ONE]);
    for (let len = SURFEL_BLOCK_HEADER_BYTES; len < full.byteLength; len++) {
      assertRejects(full.subarray(0, len), "TRUNCATED_RECORDS");
    }
  });

  test("declared count larger than data", () => {
    assertRejects(rawBlock({ count: 3, recordBytes: 2 * SURFEL_RECORD_BYTES }), "TRUNCATED_RECORDS");
  });

  test("huge declared count is rejected without allocation", () => {
    assertRejects(rawBlock({ count: 0xffffffff, recordBytes: SURFEL_RECORD_BYTES }), "TRUNCATED_RECORDS");
  });

  test("declared count smaller than data (trailing bytes)", () => {
    assertRejects(rawBlock({ count: 1, recordBytes: 2 * SURFEL_RECORD_BYTES }), "TRAILING_BYTES");
    const withExtraByte = new Uint8Array(SURFEL_BLOCK_HEADER_BYTES + SURFEL_RECORD_BYTES + 1);
    withExtraByte.set(encodeSurfelBlock([ONE]));
    assertRejects(withExtraByte, "TRAILING_BYTES");
  });

  test("non-finite float in a record", () => {
    const bytes = encodeSurfelBlock([ONE]);
    new DataView(bytes.buffer).setFloat32(SURFEL_BLOCK_HEADER_BYTES + 8, Number.NaN, true);
    assertRejects(bytes, "INVALID_VALUE");
  });

  test("negative radius in a record", () => {
    const bytes = encodeSurfelBlock([ONE]);
    new DataView(bytes.buffer).setFloat32(SURFEL_BLOCK_HEADER_BYTES + 24, -0.5, true);
    assertRejects(bytes, "INVALID_VALUE");
  });
});
