import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { CLASS_PLANE_HEADER_BYTES, ClassPlaneError, decodeClassPlane, encodeClassPlane, readClassPlane } from "../src/class-plane.js";
import { concatFrames, encodeFrame, extractClassPlanes, extractSurfelBlocks, wrapClassPlane, wrapSurfelBlock } from "../src/mlt-frame.js";
import { encodeSurfelBlock } from "../src/surfel-block.js";

const codes = Uint8Array.from({ length: 1000 }, (_, i) => (i % 7 === 0 ? 2 : i % 5 === 0 ? 64 : 5));
const gz = (b: Uint8Array) => new Uint8Array(gzipSync(b, { level: 9 }));
const gunzip = (b: Uint8Array) => new Uint8Array(gunzipSync(b));
const rejects = (body: Uint8Array, code: string) => assert.throws(() => readClassPlane(body), (e: unknown) => e instanceof ClassPlaneError && e.code === code);

test("round trip, uncompressed and gzip; the gzip plane is smaller for runs", async () => {
  const raw = encodeClassPlane(codes);
  assert.equal(raw.byteLength, CLASS_PLANE_HEADER_BYTES + 1000);
  assert.deepEqual(await decodeClassPlane(readClassPlane(raw)), codes);
  const zipped = encodeClassPlane(codes, gz);
  assert.ok(zipped.byteLength < raw.byteLength);
  const plane = readClassPlane(zipped);
  assert.equal(plane.compression, 1);
  assert.equal(plane.count, 1000);
  assert.deepEqual(await decodeClassPlane(plane, gunzip), codes);
});

test("zero and one splat", async () => {
  assert.deepEqual(await decodeClassPlane(readClassPlane(encodeClassPlane(new Uint8Array(0)))), new Uint8Array(0));
  assert.deepEqual(await decodeClassPlane(readClassPlane(encodeClassPlane(Uint8Array.of(9), gz)), gunzip), Uint8Array.of(9));
});

test("malformed bodies are rejected: short header, magic, version, compression, length", async () => {
  const good = encodeClassPlane(codes);
  rejects(good.subarray(0, 11), "TRUNCATED_HEADER");
  rejects(Uint8Array.from([...good.subarray(0, 3), 0x58, ...good.subarray(4)]), "BAD_MAGIC");
  const v = new Uint8Array(good); v[4] = 2; rejects(v, "UNSUPPORTED_VERSION");
  const c = new Uint8Array(good); c[5] = 7; rejects(c, "BAD_COMPRESSION");
  rejects(good.subarray(0, good.length - 1), "LENGTH_MISMATCH");
  rejects(Uint8Array.from([...good, 0]), "LENGTH_MISMATCH");
  // A gzip plane whose decompressed size is not the count.
  const lie = new Uint8Array(encodeClassPlane(codes, gz)); new DataView(lie.buffer).setUint32(8, 999, true);
  await assert.rejects(decodeClassPlane(readClassPlane(lie), gunzip), (e: unknown) => e instanceof ClassPlaneError && e.code === "LENGTH_MISMATCH");
  // A compressed plane cannot be decoded without an inflate function.
  await assert.rejects(decodeClassPlane(readClassPlane(encodeClassPlane(codes, gz))), (e: unknown) => e instanceof ClassPlaneError && e.code === "BAD_COMPRESSION");
});

test("in a tile: the plane is found beside the block, in either order, with an unknown frame, and the block still decodes alone", () => {
  const block = encodeSurfelBlock([]);
  const plane = encodeClassPlane(new Uint8Array(0));
  const unknown = encodeFrame(0x7e, Uint8Array.of(1, 2, 3));
  for (const frames of [[wrapSurfelBlock(block), wrapClassPlane(plane)], [unknown, wrapClassPlane(plane), wrapSurfelBlock(block), encodeFrame(0x42, new Uint8Array(0))]]) {
    const tile = concatFrames(frames);
    assert.equal(extractSurfelBlocks(tile).length, 1);
    const found = extractClassPlanes(tile);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], plane);
  }
  assert.deepEqual(extractClassPlanes(concatFrames([wrapSurfelBlock(block)])), [], "a tile without a plane");
});

test("a plane frame with a bad length is rejected by the frame reader", () => {
  const frame = wrapClassPlane(encodeClassPlane(codes));
  assert.throws(() => extractClassPlanes(frame.subarray(0, frame.length - 1)));
});
