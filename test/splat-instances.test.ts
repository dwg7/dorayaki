import assert from "node:assert/strict";
import { test } from "node:test";

import { ROUND_RATIO, cameraAxes, splatInstances } from "../demo/src/splat-instances.js";
import { surfelToSplat } from "../src/splat.js";
import type { Splat } from "../src/surfel-block.js";

const close = (a: number, b: number, eps = 1e-5): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const len = (a: Float32Array, i: number): number => Math.hypot(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!);
const dot = (a: Float32Array, b: Float32Array, i: number): number => a[i * 3]! * b[i * 3]! + a[i * 3 + 1]! * b[i * 3 + 1]! + a[i * 3 + 2]! * b[i * 3 + 2]!;

const base: Splat = { x: 0.25, y: 0.5, z: 7, sx: 1, sy: 1, sz: 1, qw: 1, qx: 0, qy: 0, qz: 0, r: 1, g: 2, b: 3, a: 4 };

test("a flat disc keeps its radius and normal: semi-axes are perpendicular and radius long", () => {
  const disc = surfelToSplat({ x: 0.5, y: 0.5, z: 3, nx: 0, ny: 0, nz: -1, radius: 4, r: 9, g: 8, b: 7, a: 255 });
  const inst = splatInstances([disc]);
  assert.equal(inst.round[0], 0);
  close(len(inst.axisU, 0), 4);
  close(len(inst.axisV, 0), 4);
  close(dot(inst.axisU, inst.axisV, 0), 0);
  assert.deepEqual([...inst.normal.subarray(0, 3)].map((v) => Math.round(v) + 0), [0, 0, -1]); // sign kept
  assert.deepEqual([...inst.colour.subarray(0, 4)], [9, 8, 7, 255]);
  assert.deepEqual([...inst.position.subarray(0, 3)], [0.5, 0.5, 3]);
});

test("an anisotropic splat's semi-axes are 2 sigma along the two longer axes", () => {
  // Axes aligned with the metric frame: scales (3, 1, 0.1) -> major along x, minor along y, normal z.
  // axisU is the minor in-plane axis, axisV the major one.
  const inst = splatInstances([{ ...base, sx: 3, sy: 1, sz: 0.1 }]);
  assert.equal(inst.round[0], 0);
  assert.deepEqual([...inst.axisU.subarray(0, 3)].map((v) => Math.abs(Math.round(v * 1000) / 1000)), [0, 2, 0]);
  assert.deepEqual([...inst.axisV.subarray(0, 3)].map((v) => Math.abs(Math.round(v * 1000) / 1000)), [6, 0, 0]);
  assert.deepEqual([...inst.normal.subarray(0, 3)].map((v) => Math.abs(Math.round(v))), [0, 0, 1]);
});

test("the ellipse lies in the plane of the two longer axes whatever their order", () => {
  // Shortest axis is local x here.
  const inst = splatInstances([{ ...base, sx: 0.1, sy: 2, sz: 5 }]);
  close(len(inst.axisU, 0), 4); // minor in-plane (sy = 2) first
  close(len(inst.axisV, 0), 10); // then major (sz = 5)
  close(dot(inst.axisU, inst.normal, 0), 0);
  close(dot(inst.axisV, inst.normal, 0), 0);
});

test("a splat with no preferred orientation is a camera-facing disc of the equal-area radius", () => {
  const inst = splatInstances([{ ...base, sx: 0.5, sy: 0.5, sz: 0.5 }, { ...base, sx: 1, sy: 1, sz: 1 / (ROUND_RATIO + 0.1) }]);
  assert.deepEqual([...inst.round], [1, 0]);
  close(len(inst.axisU, 0), 2 * 0.5);
  close(len(inst.axisV, 0), 2 * 0.5);
});

test("round detection follows the scale ratio threshold", () => {
  const flags = [1, 1.2, ROUND_RATIO - 0.01, ROUND_RATIO + 0.01, 3].map((ratio) => splatInstances([{ ...base, sx: ratio, sy: 1, sz: 1 }]).round[0]);
  assert.deepEqual(flags, [1, 1, 1, 0, 0]);
});

test("an empty list gives empty arrays", () => {
  const inst = splatInstances([]);
  assert.equal(inst.count, 0);
  assert.equal(inst.position.length, 0);
});

test("cameraAxes recovers the camera's right and up from a perspective matrix", () => {
  // View rotation rows (right, up, back) for a camera yawed 35 degrees and pitched 55 degrees.
  const yaw = (35 * Math.PI) / 180, pitch = (55 * Math.PI) / 180;
  const right = [Math.cos(yaw), Math.sin(yaw), 0];
  const back = [Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const up = [back[1]! * right[2]! - back[2]! * right[1]!, back[2]! * right[0]! - back[0]! * right[2]!, back[0]! * right[1]! - back[1]! * right[0]!].map((v) => -v);
  const f = 2.3, aspect = 1.4, scale = 0.00001, near = 0.1, far = 5000;
  // clip = P * V * S * p: rows of the 4 x 4 (column-major): x row = f/aspect * right * scale, y row = f * up * scale.
  const m = new Float64Array(16);
  const setRow = (r: number, v: number[]) => v.forEach((x, c) => (m[c * 4 + r] = x));
  setRow(0, right.map((v) => (v * f * scale) / aspect));
  setRow(1, up.map((v) => v * f * scale));
  setRow(2, back.map((v) => (-(far + near) / (far - near)) * v * scale * -1));
  setRow(3, back.map((v) => v * scale));
  const axes = cameraAxes(m);
  right.forEach((v, i) => close(axes.right[i]!, v, 1e-9));
  up.forEach((v, i) => close(axes.up[i]!, v, 1e-9));
});
