/**
 * Instance data for drawing splats: per-splat attributes as typed arrays.
 * No DOM, network or WebGL here, so it is testable in Node.
 *
 * For each splat, in the tile's metric frame (east, south, up):
 * - `axisU`, `axisV`: the 2-sigma ellipse's semi-axis vectors (metres), along
 *   the two longer axes, the shorter of the two first: lengths 2·s_a <= 2·s_b
 *   (the quad is symmetric, so the order does not matter for drawing);
 * - `normal`: the shortest axis (sign as stored; the shader lights two-sided);
 * - `round`: 1 for a splat with no preferred orientation, which the shader
 *   draws as a camera-facing disc of radius |axisU|, else 0.
 * A round splat's `axisU` has length 2·sqrt(s_a·s_b) and `axisV` is
 * perpendicular to it with the same length, like a disc; only the length
 * is used.
 */
import { splatAxes, splatAxisOrder, splatRoundness } from "../../src/splat.js";
import type { Splat } from "../../src/surfel-block.js";

/**
 * A splat whose largest scale is less than this multiple of its smallest is
 * drawn camera-facing. Voxel fits of one or two points have equal scales; a
 * Gaussian from a filled volume (a tree crown) is close to equal; a surface
 * patch has a ratio well above 2 (E003: flat share is 28-52 %).
 */
export const ROUND_RATIO = 1.5;

export interface SplatInstances {
  count: number;
  /** x, y tile-local, z metres; 3 per splat. */
  position: Float32Array;
  axisU: Float32Array;
  axisV: Float32Array;
  normal: Float32Array;
  /** 0 or 1. */
  round: Float32Array;
  /** r, g, b, a; 4 per splat. */
  colour: Uint8Array;
}

export function splatInstances(splats: readonly Splat[]): SplatInstances {
  const n = splats.length;
  const out: SplatInstances = {
    count: n,
    position: new Float32Array(n * 3),
    axisU: new Float32Array(n * 3),
    axisV: new Float32Array(n * 3),
    normal: new Float32Array(n * 3),
    round: new Float32Array(n),
    colour: new Uint8Array(n * 4),
  };
  splats.forEach((s, i) => {
    const axes = splatAxes(s);
    const scales = [s.sx, s.sy, s.sz];
    const [kn, ka, kb] = splatAxisOrder(s);
    const sa = scales[ka]!;
    const sb = scales[kb]!;
    const a = axes[ka]!;
    const b = axes[kb]!;
    const nrm = axes[kn]!;
    out.position.set([s.x, s.y, s.z], i * 3);
    out.normal.set(nrm, i * 3);
    if (splatRoundness(s) < ROUND_RATIO) {
      const r = 2 * Math.sqrt(sa * sb);
      out.round[i] = 1;
      out.axisU.set([r, 0, 0], i * 3);
      out.axisV.set([0, r, 0], i * 3);
    } else {
      out.axisU.set([a[0] * 2 * sa, a[1] * 2 * sa, a[2] * 2 * sa], i * 3);
      out.axisV.set([b[0] * 2 * sb, b[1] * 2 * sb, b[2] * 2 * sb], i * 3);
    }
    out.colour.set([s.r, s.g, s.b, s.a], i * 4);
  });
  return out;
}

const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

/**
 * Camera right and up directions in the local metric frame, from a
 * column-major local-frame -> clip matrix. For a perspective projection the
 * gradient of clip x (row 0) points along the screen's x axis, and that of
 * clip y (row 1) along its y axis, whatever the camera orientation.
 */
export function cameraAxes(matrix: ArrayLike<number>): { right: [number, number, number]; up: [number, number, number] } {
  return {
    right: unit(matrix[0]!, matrix[4]!, matrix[8]!),
    up: unit(matrix[1]!, matrix[5]!, matrix[9]!),
  };
}
