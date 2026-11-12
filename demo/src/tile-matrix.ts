/**
 * Geographic placement: tile-local surfel coordinates -> Web Mercator.
 *
 * Demo interpretation (not part of the Surfel Block format):
 * - x, y in [0, 1] span the tile z/x/y; x grows east, y grows south
 *   (the MLT / MVT tile convention);
 * - z is up, in the same unit as x and y (one tile width).
 *
 * MapLibre's 3D custom-layer matrix treats Mercator z as conformal with x
 * and y, so one uniform scale maps all three axes. Matrices are column-
 * major and computed in float64; only the final product is sent to the
 * GPU, so large Mercator offsets cancel before float32 rounding.
 */
import type { TileAddress } from "./demo-tile.js";

export type Mat4 = Float64Array;

/** Column-major model matrix: tile-local -> Mercator [0, 1]. */
export function tileToMercatorMatrix(t: TileAddress): Mat4 {
  const s = 1 / 2 ** t.z;
  // prettier-ignore
  return Float64Array.of(
    s, 0, 0, 0,
    0, s, 0, 0,
    0, 0, s, 0,
    t.x * s, t.y * s, 0, 1,
  );
}

/** Column-major a × b. */
export function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] as number) * (b[col * 4 + k] as number);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Column-major m × [x, y, z, 1]. */
export function transformPoint(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number, number] {
  const r = [0, 0, 0, 0] as [number, number, number, number];
  for (let row = 0; row < 4; row++) {
    r[row] = (m[row] as number) * x + (m[4 + row] as number) * y + (m[8 + row] as number) * z + (m[12 + row] as number);
  }
  return r;
}
