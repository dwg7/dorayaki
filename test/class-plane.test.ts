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

import { CLASS_CODE_LIMIT, joinClassCodes } from "../src/class-plane.js";
import { PLANE_CLASS_SLOTS, planeClassSlot, planeOpacityOf, planeSlotToCode } from "../src/pointcloud/class-slots.js";
import { adaptiveGaussians } from "../src/pointcloud/adaptive.js";
import { VoxelAccumulator } from "../src/pointcloud/voxel-accumulator.js";

test("codes of 128 and above are rejected when encoding and when decoding", async () => {
  assert.equal(CLASS_CODE_LIMIT, 128);
  assert.throws(() => encodeClassPlane(Uint8Array.of(2, 128)), (e: unknown) => e instanceof ClassPlaneError && e.code === "INVALID_CODE");
  const raw = new Uint8Array(encodeClassPlane(Uint8Array.of(2, 3)));
  raw[raw.length - 1] = 200;
  await assert.rejects(decodeClassPlane(readClassPlane(raw)), (e: unknown) => e instanceof ClassPlaneError && e.code === "INVALID_CODE");
});

test("the inflate function gets the most bytes it may produce (the count), so a bomb can be stopped", async () => {
  const bomb = new Uint8Array(gzipSync(new Uint8Array(1_000_000)));
  const plane = readClassPlane(new Uint8Array(encodeClassPlane(new Uint8Array(10), () => bomb)));
  assert.equal(plane.count, 10);
  let asked = -1;
  await assert.rejects(decodeClassPlane(plane, (payload, max) => { asked = max; return new Uint8Array(gunzipSync(payload, { maxOutputLength: max })); }));
  assert.equal(asked, 10);
});

test("joinClassCodes keeps the order, and refuses when a part is missing or of another length", () => {
  assert.deepEqual(joinClassCodes([Uint8Array.of(2, 3), Uint8Array.of(5)], [2, 1]), Uint8Array.of(2, 3, 5));
  assert.equal(joinClassCodes([Uint8Array.of(2, 3), undefined], [2, 1]), undefined);
  assert.equal(joinClassCodes([Uint8Array.of(2, 3), Uint8Array.of(5)], [2, 2]), undefined, "a plane shorter than its splats");
  assert.equal(joinClassCodes([Uint8Array.of(2, 3, 4)], [2]), undefined, "a plane longer than its splats");
  assert.equal(joinClassCodes([], []), undefined);
});

test("builder slots: LAS classes keep their number, canopy needs class 1 and several returns, others become unclassified", () => {
  const single = 0b00001001, several = 0b00010010; // return 1 of 1; return 2 of 2 (bits 0-2 number, 3-5 count)
  assert.equal(planeClassSlot(2, single), 2);
  assert.equal(planeClassSlot(5, several), 5, "a classified point keeps its class whatever the returns");
  assert.equal(planeClassSlot(1, single), 1);
  assert.equal(planeClassSlot(1, several), 16);
  assert.equal(planeClassSlot(17, single), 17, "LAS class 17 (bridge deck) falls in the other slot");
  assert.equal(planeSlotToCode(16), 64);
  assert.equal(planeSlotToCode(17), 1);
  assert.equal(planeSlotToCode(9), 9);
  assert.equal(planeSlotToCode(PLANE_CLASS_SLOTS + 5), 1);
  assert.equal(Math.round(planeOpacityOf([0, 5, 9, 9]) * 255), 2, "the dominant slot; the lowest on a tie");
});

test("through the adaptive merge the dominant class of all the points of a splat ends up in its opacity byte", () => {
  const acc = new VoxelAccumulator(1, 16, PLANE_CLASS_SLOTS);
  // Two neighbouring voxels, one with 5 ground points (slot 2) and one with 3 high-vegetation points (slot 5): merged, ground wins.
  for (let i = 0; i < 5; i++) acc.add(0.1 + i * 0.1, 0.5, 0.5, 0.4, 0.4, 0.4, 2);
  for (let i = 0; i < 3; i++) acc.add(1.1 + i * 0.1, 0.5, 0.5, 0.4, 0.4, 0.4, 5);
  const merged = adaptiveGaussians(acc, { maxLevel: 1, thickness: 5, colorTolerance: 1, opacityOf: planeOpacityOf }).gaussians;
  assert.equal(merged.length, 1);
  assert.equal(Math.round(merged[0]!.opacity * 255), 2);
  const alone = adaptiveGaussians(acc, { maxLevel: 0, thickness: 5, colorTolerance: 1, opacityOf: planeOpacityOf }).gaussians.map((g) => Math.round(g.opacity * 255)).sort();
  assert.deepEqual(alone, [2, 5]);
});
