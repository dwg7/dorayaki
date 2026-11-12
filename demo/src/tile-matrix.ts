/**
 * Geographic placement for Surfel Block v2 (docs/surfel-block-format.md).
 *
 * The vertex shader converts each surfel to a local metric frame with its
 * origin at the tile's north-west corner and axes east, south, up, in
 * metres: (x · W, y · W, z), where W = tileWidthMetres(tile). This matrix
 * maps that frame to Web Mercator [0, 1].
 *
 * MapLibre's 3D custom-layer matrix treats Mercator z as conformal with x
 * and y, so one uniform scale, 1 / (W · 2^zoom) Mercator units per metre,
 * maps all three axes. Matrices are column-major and computed in float64;
 * only the final product is sent to the GPU, so large Mercator offsets
 * cancel before float32 rounding.
 */
import { tileWidthMetres, type TileAddress } from "../../src/tile-geometry.js";

export type Mat4 = Float64Array;

/** Column-major model matrix: local metric frame (metres) -> Mercator [0, 1]. */
export function metricToMercatorMatrix(t: TileAddress, widthMetres: number = tileWidthMetres(t)): Mat4 {
  const n = 2 ** t.z;
  const s = 1 / (widthMetres * n);
  // prettier-ignore
  return Float64Array.of(
    s, 0, 0, 0,
    0, s, 0, 0,
    0, 0, s, 0,
    t.x / n, t.y / n, 0, 1,
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
