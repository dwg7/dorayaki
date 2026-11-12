import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { generateBridge as generateBridgeFixture } from "../src/fixtures/bridge.js";
import {
  EXPERIMENTAL_SURFEL_FRAME_TAG,
  MltFrameError,
  concatFrames,
  decodeVarint,
  encodeFrame,
  encodeVarint,
  extractSurfelBlocks,
  readFrames,
  wrapSurfelBlock,
  type MltFrameErrorCode,
} from "../src/mlt-frame.js";
import { decodeSurfelBlock, encodeSurfelBlock } from "../src/surfel-block.js";

/** Bridge at an arbitrary but fixed tile width; the wrapper treats bodies as opaque. */
const generateBridge = () => generateBridgeFixture({ tileWidthMetres: 128 });

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const bytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.replace(/\s+/g, ""), "hex"));

function assertRejects(fn: () => unknown, code: MltFrameErrorCode): void {
  assert.throws(fn, (err: unknown) => err instanceof MltFrameError && err.code === code);
}

/** A synthetic frame with a tag this library does not interpret. */
const UNKNOWN_TAG = 0x7e;
const unknownFrame = (body: Uint8Array): Uint8Array => encodeFrame(UNKNOWN_TAG, body);

describe("varint", () => {
  const cases: Array<[number, string]> = [
    [0, "00"],
    [1, "01"],
    [127, "7f"],
    [128, "8001"],
    [300, "ac02"],
    [13325, "8d68"],
    [0xffffffff, "ffffffff0f"],
  ];
  for (const [value, encoded] of cases) {
    test(`${value} <-> ${encoded}`, () => {
      assert.equal(hex(encodeVarint(value)), encoded);
      assert.deepEqual(decodeVarint(bytes(encoded), 0), { value, next: encoded.length / 2 });
    });
  }

  test("rejects values outside uint32 when encoding", () => {
    assertRejects(() => encodeVarint(-1), "VARINT_OVERFLOW");
    assertRejects(() => encodeVarint(2 ** 32), "VARINT_OVERFLOW");
    assertRejects(() => encodeVarint(1.5), "VARINT_OVERFLOW");
  });

  test("rejects truncated varints", () => {
    assertRejects(() => decodeVarint(bytes(""), 0), "TRUNCATED_VARINT");
    assertRejects(() => decodeVarint(bytes("80"), 0), "TRUNCATED_VARINT");
    assertRejects(() => decodeVarint(bytes("ffffff"), 0), "TRUNCATED_VARINT");
  });

  test("rejects varints that overflow uint32", () => {
    assertRejects(() => decodeVarint(bytes("8080808010"), 0), "VARINT_OVERFLOW"); // 2^32
    assertRejects(() => decodeVarint(bytes("ffffffff7f"), 0), "VARINT_OVERFLOW");
    assertRejects(() => decodeVarint(bytes("808080808001"), 0), "VARINT_OVERFLOW"); // 6 bytes
  });
});

describe("frame envelope", () => {
  test("empty Surfel Block frame has the exact byte layout", () => {
    const block = encodeSurfelBlock([]);
    const frame = wrapSurfelBlock(block);
    // size = 1 (tag) + 12 (block) = 13 = 0x0d
    assert.equal(hex(frame), "0d" + "d0" + hex(block));
  });

  test("bridge frame uses a two-byte size varint", () => {
    const block = encodeSurfelBlock(generateBridge());
    assert.equal(block.byteLength, 13836); // 12 + 32 × 432
    const frame = wrapSurfelBlock(block);
    assert.equal(hex(frame.subarray(0, 3)), "8d6c" + "d0"); // size 13837
    assert.equal(frame.byteLength, 2 + 1 + 13836);
  });

  test("experimental tag is not an assigned MLT tag", () => {
    assert.notEqual(EXPERIMENTAL_SURFEL_FRAME_TAG, 0x01);
    assert.notEqual(EXPERIMENTAL_SURFEL_FRAME_TAG, 0x02);
  });

  test("rejects tags outside uint8", () => {
    assertRejects(() => encodeFrame(256, new Uint8Array()), "INVALID_TAG");
    assertRejects(() => encodeFrame(-1, new Uint8Array()), "INVALID_TAG");
  });

  test("a frame with an empty body has size 1", () => {
    assert.equal(hex(encodeFrame(UNKNOWN_TAG, new Uint8Array())), "017e");
  });
});

describe("finding and extracting", () => {
  test("surfel frame coexists with unknown frames and decodes to the bridge", () => {
    const bridge = generateBridge();
    const block = encodeSurfelBlock(bridge);
    const tile = concatFrames([
      unknownFrame(bytes("01020304")),
      wrapSurfelBlock(block),
      unknownFrame(new Uint8Array(200).fill(0xaa)), // 2-byte size varint
    ]);

    const frames = readFrames(tile);
    assert.deepEqual(frames.map((f) => f.tag), [UNKNOWN_TAG, EXPERIMENTAL_SURFEL_FRAME_TAG, UNKNOWN_TAG]);
    assert.deepEqual(frames.map((f) => f.offset), [0, 6, 6 + 2 + 1 + 13836]);

    const found = extractSurfelBlocks(tile);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], block);
    assert.deepEqual(decodeSurfelBlock(found[0] as Uint8Array), bridge);
  });

  test("unknown frames are skipped by length, not scanned", () => {
    // An unknown frame whose body looks exactly like a surfel frame.
    const decoy = wrapSurfelBlock(encodeSurfelBlock([]));
    const real = encodeSurfelBlock(generateBridge());
    const tile = concatFrames([unknownFrame(decoy), wrapSurfelBlock(real)]);
    const found = extractSurfelBlocks(tile);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], real);
  });

  test("a tag 0x01 frame is skipped as an unknown frame", () => {
    // This library does not parse MLT v1 layers; the body here is junk.
    const block = encodeSurfelBlock([]);
    const tile = concatFrames([encodeFrame(0x01, bytes("deadbeef")), wrapSurfelBlock(block)]);
    assert.deepEqual(extractSurfelBlocks(tile), [block]);
  });

  test("no surfel frame and empty tile yield no blocks", () => {
    assert.deepEqual(extractSurfelBlocks(unknownFrame(bytes("00"))), []);
    assert.deepEqual(extractSurfelBlocks(new Uint8Array()), []);
  });

  test("multiple surfel frames are returned in tile order", () => {
    const a = encodeSurfelBlock([]);
    const b = encodeSurfelBlock(generateBridge().slice(0, 3));
    const tile = concatFrames([wrapSurfelBlock(a), unknownFrame(bytes("ff")), wrapSurfelBlock(b)]);
    assert.deepEqual(extractSurfelBlocks(tile), [a, b]);
  });

  test("works on a tile view with a non-zero byteOffset", () => {
    const block = encodeSurfelBlock(generateBridge().slice(0, 2));
    const tile = concatFrames([unknownFrame(bytes("0102")), wrapSurfelBlock(block)]);
    const padded = new Uint8Array(tile.byteLength + 5);
    padded.set(tile, 5);
    const [found] = extractSurfelBlocks(padded.subarray(5));
    assert.deepEqual(decodeSurfelBlock(found as Uint8Array), generateBridge().slice(0, 2));
  });
});

describe("malformed tiles are rejected", () => {
  test("frame size 0", () => {
    assertRejects(() => readFrames(bytes("00")), "ZERO_FRAME_SIZE");
  });

  test("frame size larger than the remaining bytes", () => {
    assertRejects(() => readFrames(bytes("05 d0 0102")), "FRAME_OVERFLOW");
    // Declared size is the uint32 maximum.
    assertRejects(() => readFrames(bytes("ffffffff0f d0")), "FRAME_OVERFLOW");
  });

  test("overflowing size in a frame after a valid unknown frame", () => {
    const tile = concatFrames([unknownFrame(bytes("0102")), bytes("ff7f d0")]);
    assertRejects(() => extractSurfelBlocks(tile), "FRAME_OVERFLOW");
  });

  test("a surfel frame truncated at every cut point", () => {
    const full = wrapSurfelBlock(encodeSurfelBlock(generateBridge().slice(0, 1)));
    for (let len = 1; len < full.byteLength; len++) {
      assertRejects(() => readFrames(full.subarray(0, len)), "FRAME_OVERFLOW");
    }
  });

  test("size varint truncated at the end of the tile", () => {
    const tile = concatFrames([unknownFrame(bytes("01")), bytes("80")]);
    assertRejects(() => readFrames(tile), "TRUNCATED_VARINT");
  });

  test("size varint exceeding uint32", () => {
    assertRejects(() => readFrames(bytes("8080808010 d0")), "VARINT_OVERFLOW");
    assertRejects(() => readFrames(bytes("808080808001 d0")), "VARINT_OVERFLOW");
  });

  test("a malformed frame after the surfel frame still fails the tile", () => {
    const tile = concatFrames([wrapSurfelBlock(encodeSurfelBlock([])), bytes("09 7e 00")]);
    assertRejects(() => extractSurfelBlocks(tile), "FRAME_OVERFLOW");
  });
});
