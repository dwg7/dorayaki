import assert from "node:assert/strict";

import type { Splat } from "../src/surfel-block.js";

/** Rotation angle in degrees between two unit quaternions (q and -q are the same rotation). */
export function angleDegrees(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * Assert that decoded splats match the originals within the v4
 * quantization tolerances: x, y half of 1/65536; z half of `zStep`; each
 * scale within 0.05 octaves; rotation within 1.3 degrees; colour exact.
 */
export function expectSplatsClose(actual: readonly Splat[], expected: readonly Splat[], zStep = 0.001): void {
  assert.equal(actual.length, expected.length, "splat count");
  expected.forEach((e, i) => {
    const a = actual[i]!;
    assert.ok(Math.abs(a.x - e.x) <= 0.5 / 65536 + 1e-12, `x of splat ${i}: ${a.x} vs ${e.x}`);
    assert.ok(Math.abs(a.y - e.y) <= 0.5 / 65536 + 1e-12, `y of splat ${i}: ${a.y} vs ${e.y}`);
    assert.ok(Math.abs(a.z - e.z) <= zStep / 2 + 1e-6, `z of splat ${i}: ${a.z} vs ${e.z}`);
    for (const k of ["sx", "sy", "sz"] as const) {
      assert.ok(Math.abs(Math.log2(a[k] / e[k])) <= 0.05 + 1e-9, `${k} of splat ${i}: ${a[k]} vs ${e[k]}`);
    }
    assert.ok(angleDegrees([a.qw, a.qx, a.qy, a.qz], [e.qw, e.qx, e.qy, e.qz]) < 1.3, `rotation of splat ${i}`);
    assert.deepEqual([a.r, a.g, a.b, a.a], [e.r, e.g, e.b, e.a], `colour of splat ${i}`);
  });
}
