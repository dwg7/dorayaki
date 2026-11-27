import assert from "node:assert/strict";

import type { Splat } from "../src/surfel-block.js";

/** Rotation angle in degrees between two unit quaternions (q and -q are the same rotation). */
export function angleDegrees(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * Assert that decoded splats match the originals within the quantization of Surfel Block version 6 (documents/format.md):
 * x, y half of 1/8192; z half of the block's step (at least 1 mm, wider for blocks taller than 16.4 m; computed from the originals
 * unless given); each scale within 1/12 octave; rotation within 16 degrees (17-bit "smallest three"); color within 3 of 255 (6 bits);
 * opacity exact.
 */
export function expectSplatsClose(actual: readonly Splat[], expected: readonly Splat[], zStep?: number): void {
  assert.equal(actual.length, expected.length, "splat count");
  const zs = expected.map((e) => e.z);
  const step = zStep ?? Math.max(0.001, Math.ceil(((Math.max(...zs, 0) - Math.min(...zs, 0)) / 16383) * 1000 + 1e-9) / 1000);
  expected.forEach((e, i) => {
    const a = actual[i]!;
    assert.ok(Math.abs(a.x - e.x) <= 0.5 / 8192 + 1e-12, `x of splat ${i}: ${a.x} vs ${e.x}`);
    assert.ok(Math.abs(a.y - e.y) <= 0.5 / 8192 + 1e-12, `y of splat ${i}: ${a.y} vs ${e.y}`);
    assert.ok(Math.abs(a.z - e.z) <= step / 2 + 1e-4, `z of splat ${i}: ${a.z} vs ${e.z}`);
    for (const k of ["sx", "sy", "sz"] as const) {
      assert.ok(Math.abs(Math.log2(a[k] / e[k])) <= 1 / 12 + 1e-9, `${k} of splat ${i}: ${a[k]} vs ${e[k]}`);
    }
    assert.ok(angleDegrees([a.qw, a.qx, a.qy, a.qz], [e.qw, e.qx, e.qy, e.qz]) < 16, `rotation of splat ${i}`);
    for (const k of ["r", "g", "b"] as const) assert.ok(Math.abs(a[k] - e[k]) <= 3, `${k} of splat ${i}: ${a[k]} vs ${e[k]}`);
    assert.equal(a.a, e.a, `opacity of splat ${i}`);
  });
}
