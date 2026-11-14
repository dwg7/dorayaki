import assert from "node:assert/strict";
import { test } from "node:test";

import { TOY_GS_COUNTS, TOY_GS_PROPERTIES, toyGaussianPly } from "../src/fixtures/toy-gaussians.js";
import { PlyError, readPly, writePlyFloat32 } from "../src/gaussian/ply.js";
import { gaussianToDisc, gaussiansFromPly, placeGaussians, rotationAxes, type Gaussian } from "../src/gaussian/to-surfels.js";
import { splatAxes, splatAxisOrder, splatToSurfel } from "../src/splat.js";
import { decodeSurfelBlock, encodeSurfelBlock } from "../src/surfel-block.js";
import { expectSplatsClose } from "./helpers.js";
import { tileWidthMetres } from "../src/tile-geometry.js";
import { splitByTile } from "../src/tiling.js";

const close = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const enc = (s: string) => new TextEncoder().encode(s);
const SAPPORO = { lng: 141.35077, lat: 43.06866 };

test("PLY float32 vertices round-trip", () => {
  const bytes = writePlyFloat32(["x", "y"], [[1.5, -2], [3, 4.25]]);
  const ply = readPly(bytes);
  assert.equal(ply.count, 2);
  assert.deepEqual(ply.names, ["x", "y"]);
  assert.deepEqual([...(ply.columns.x ?? [])], [1.5, 3]);
  assert.deepEqual([...(ply.columns.y ?? [])], [-2, 4.25]);
});

test("PLY reader reads mixed scalar types", () => {
  const head = enc("ply\nformat binary_little_endian 1.0\ncomment toy\nelement vertex 1\nproperty uchar a\nproperty double b\nproperty short c\nend_header\n");
  const body = new Uint8Array(1 + 8 + 2);
  const v = new DataView(body.buffer);
  v.setUint8(0, 200);
  v.setFloat64(1, 0.1, true);
  v.setInt16(9, -3, true);
  const ply = readPly(new Uint8Array([...head, ...body]));
  assert.deepEqual([ply.columns.a?.[0], ply.columns.b?.[0], ply.columns.c?.[0]], [200, 0.1, -3]);
});

test("PLY reader rejects unsupported or malformed input", () => {
  const cases = [
    "nope",
    "ply\nformat ascii 1.0\nelement vertex 0\nend_header\n",
    "ply\nformat binary_big_endian 1.0\nelement vertex 0\nend_header\n",
    "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty list uchar int idx\nend_header\n",
    "ply\nformat binary_little_endian 1.0\nelement face 1\nend_header\n",
    "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float x\nend_header\n",
    "ply\nformat binary_little_endian 1.0\nelement vertex -1\nend_header\n",
    "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\n", // no end_header
  ];
  for (const c of cases) assert.throws(() => readPly(enc(c)), PlyError, c);
  // Truncated body: declares 2 vertices, holds 1.
  const full = writePlyFloat32(["x"], [[1], [2]]);
  assert.throws(() => readPly(full.subarray(0, full.byteLength - 1)), PlyError);
});

test("3DGS conventions: log scale, logit opacity, SH DC colour, normalised quaternion", () => {
  const row = [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, Math.log(2), Math.log(0.5), Math.log(0.1), 2, 0, 0, 0];
  const [g] = gaussiansFromPly(readPly(writePlyFloat32(TOY_GS_PROPERTIES, [row])));
  close(g!.scales[0], 2);
  close(g!.scales[1], 0.5);
  close(g!.scales[2], 0.1);
  close(g!.opacity, 0.5);
  assert.deepEqual(g!.colour, [0.5, 0.5, 0.5]);
  assert.deepEqual(g!.rotation, [1, 0, 0, 0]);
  assert.throws(() => gaussiansFromPly(readPly(writePlyFloat32(["x"], [[0]]))), /missing property/);
});

test("rotation axes are orthonormal and follow the quaternion", () => {
  const half = Math.PI / 4; // 90° about up
  const [ex, ey, ez] = rotationAxes([Math.cos(half), 0, 0, Math.sin(half)]);
  [ex[0], ex[1], ex[2]].forEach((v, i) => close(v, [0, 1, 0][i]!));
  [ey[0], ey[1], ey[2]].forEach((v, i) => close(v, [-1, 0, 0][i]!));
  [ez[0], ez[1], ez[2]].forEach((v, i) => close(v, [0, 0, 1][i]!));
});

const gaussian = (scales: [number, number, number], rotation: [number, number, number, number] = [1, 0, 0, 0]): Gaussian => ({
  position: [0, 0, 0], scales, rotation, colour: [1, 0, 0], opacity: 0.8,
});

test("a Gaussian becomes a disc: shortest axis is the normal, radius from the other two", () => {
  const d = gaussianToDisc(gaussian([2, 0.5, 0.01]));
  assert.deepEqual(d.normal, [0, 0, 1]);
  close(d.radius, 2 * Math.sqrt(2 * 0.5));
  close(d.anisotropy, 4);
  close(d.flatness, 0.01);
  const wall = gaussianToDisc(gaussian([1, 0.02, 1]));
  assert.deepEqual(wall.normal, [0, 1, 0]);
});

test("placement: east grows x, north shrinks y, and the frame becomes east-south-up", () => {
  const wall = { ...gaussian([1, 0.02, 1]), position: [0, 0, 5] as [number, number, number] }; // thin axis = north
  const ground = { ...gaussian([1, 1, 0.02]), position: [10, 20, 0] as [number, number, number] };
  const { block, splats } = placeGaussians([wall, ground], SAPPORO, 18);
  assert.deepEqual(block.origin, { z: 18, x: 234000, y: 96256 });
  const [a, b] = splats as [typeof splats[0], typeof splats[0]];
  assert.equal(a.z, 5);
  const w = tileWidthMetres(block.origin);
  close(b.x - a.x, 10 / w, 1e-5);
  close(a.y - b.y, 20 / w, 1e-5);
  assert.equal(a.a, Math.round(0.8 * 255));
  // The wall's thin axis is north-south, whichever sign the rotation takes.
  const n = splatAxes(a)[splatAxisOrder(a)[0]]!;
  close(Math.abs(n[1]), 1, 1e-9);
  // The ground's thin axis stays vertical.
  const g = splatAxes(b)[splatAxisOrder(b)[0]]!;
  close(Math.abs(g[2]), 1, 1e-9);
  // Each placed rotation is a unit quaternion (the frame change keeps it a proper rotation).
  for (const q of [a, b]) close(Math.hypot(q.qw, q.qx, q.qy, q.qz), 1, 1e-12);
});

test("an arbitrary rotation keeps its axes as lines after the frame change", () => {
  // Axes of a rotated Gaussian in ENU, as unsigned lines, vs the splat's axes in ESU.
  const half = (37 * Math.PI) / 360;
  const q: [number, number, number, number] = [Math.cos(half), 0.3 * Math.sin(half), 0.5 * Math.sin(half), Math.sqrt(1 - 0.34) * Math.sin(half)];
  const l = Math.hypot(...q);
  const g = { ...gaussian([3, 2, 1], q.map((v) => v / l) as [number, number, number, number]), position: [1, 2, 3] as [number, number, number] };
  const enu = rotationAxes(g.rotation);
  const { splats } = placeGaussians([g], SAPPORO, 18);
  const esu = splatAxes(splats[0]!);
  enu.forEach((axis, k) => {
    const flipped = [axis[0], -axis[1], axis[2]];
    const dot = Math.abs(flipped[0]! * esu[k]![0] + flipped[1]! * esu[k]![1] + flipped[2]! * esu[k]![2]);
    close(dot, 1, 1e-9);
  });
});

test("the toy GS PLY converts, tiles, and survives encode/decode", () => {
  const ply = readPly(toyGaussianPly());
  assert.equal(ply.count, TOY_GS_COUNTS.ground + TOY_GS_COUNTS.wall + TOY_GS_COUNTS.blob);
  const discs = gaussiansFromPly(ply).map(gaussianToDisc);
  const ground = discs.slice(0, TOY_GS_COUNTS.ground);
  const wall = discs.slice(TOY_GS_COUNTS.ground, TOY_GS_COUNTS.ground + TOY_GS_COUNTS.wall);
  const blob = discs.slice(TOY_GS_COUNTS.ground + TOY_GS_COUNTS.wall);
  for (const d of ground) close(Math.abs(d.normal[2]), 1);
  for (const d of wall) {
    // 30° rotation about up: the north axis turns 30° west of north.
    close(d.normal[0], -Math.sin(Math.PI / 6), 1e-5);
    close(d.normal[1], Math.cos(Math.PI / 6), 1e-5);
  }
  for (const d of blob) close(d.flatness, 1, 1e-5); // no preferred axis: the normal is arbitrary
  for (const d of ground) close(d.anisotropy, 1.5, 1e-5); // ellipse flattened to a disc

  const { block, splats } = placeGaussians(gaussiansFromPly(ply), SAPPORO, 18);
  const tiles = splitByTile(splats, block);
  assert.equal(tiles.reduce((n, t) => n + t.surfels.length, 0), ply.count);
  for (const t of tiles) expectSplatsClose(decodeSurfelBlock(encodeSurfelBlock(t.surfels)), t.surfels);
  // The round blob keeps equal scales: it reads back as round (no preferred orientation).
  const blobSplats = splats.slice(TOY_GS_COUNTS.ground + TOY_GS_COUNTS.wall);
  for (const q of blobSplats) assert.ok(Math.max(q.sx, q.sy, q.sz) / Math.min(q.sx, q.sy, q.sz) < 1.0001);
});

test("placement handles hundreds of thousands of Gaussians", () => {
  const base = gaussian([1, 1, 0.02]);
  const gaussians = Array.from({ length: 600_000 }, (_, i) => ({ ...base, position: [(i % 1000) * 0.01, Math.floor(i / 1000) * 0.01, 0] as [number, number, number] }));
  const { splats } = placeGaussians(gaussians, SAPPORO, 20);
  assert.equal(splats.length, 600_000);
});
