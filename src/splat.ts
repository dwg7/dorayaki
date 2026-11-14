/**
 * Splat geometry: rotations, and conversions between the circular surfel
 * description (fixtures) and the anisotropic splat a block stores.
 * No DOM or Node dependency.
 */
import type { Splat, Surfel } from "./surfel-block.js";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // w, x, y, z

/** Columns of the rotation matrix of a unit quaternion (w, x, y, z): the local axes in the outer frame. */
export function rotationAxes([w, x, y, z]: readonly [number, number, number, number]): [Vec3, Vec3, Vec3] {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  ];
}

/** Unit quaternion (w, x, y, z) of a proper rotation matrix given by its columns. */
export function quaternionFromAxes(c0: readonly number[], c1: readonly number[], c2: readonly number[]): Quat {
  const [m00, m10, m20] = c0 as Vec3;
  const [m01, m11, m21] = c1 as Vec3;
  const [m02, m12, m22] = c2 as Vec3;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
  }
  const len = Math.hypot(...q);
  return q.map((x) => x / len) as Quat;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Thin axis of a flat disc, as a fraction of its 1-sigma in-plane scale.
 * Only its order matters: it must be the shortest axis, so that the
 * splat's normal is the disc's normal.
 */
export const DISC_THICKNESS = 0.1;

/**
 * Convert a circular surfel to a splat: in-plane scales radius / 2 (so the
 * 2-sigma ellipse is the disc), a thin third axis along the normal.
 */
export function surfelToSplat(s: Surfel): Splat {
  const n = normalize([s.nx, s.ny, s.nz]);
  const helper: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const t = normalize(cross(helper, n));
  const b = cross(n, t);
  const [qw, qx, qy, qz] = quaternionFromAxes(t, b, n);
  const sigma = s.radius / 2;
  return {
    x: s.x, y: s.y, z: s.z,
    sx: sigma, sy: sigma, sz: sigma * DISC_THICKNESS,
    qw, qx, qy, qz,
    r: s.r, g: s.g, b: s.b, a: s.a,
  };
}

/** Local axes of a splat in the tile's metric frame (east, south, up), as unit columns. */
export function splatAxes(s: Splat): [Vec3, Vec3, Vec3] {
  return rotationAxes([s.qw, s.qx, s.qy, s.qz]);
}

/** Axis indices ordered shortest first: [normal, minor in-plane, major in-plane]. */
export function splatAxisOrder(s: Splat): [number, number, number] {
  const scales = [s.sx, s.sy, s.sz];
  return [0, 1, 2].sort((a, b) => scales[a]! - scales[b]!) as [number, number, number];
}

/** Largest scale over smallest: 1 means no preferred orientation. */
export function splatRoundness(s: Splat): number {
  return Math.max(s.sx, s.sy, s.sz) / Math.min(s.sx, s.sy, s.sz);
}

/**
 * Reduce a splat to a circular surfel: the normal is the shortest axis and
 * the radius is 2·sqrt(product of the two longer scales), the 2-sigma
 * ellipse's equal-area circle. Anisotropy is dropped.
 */
export function splatToSurfel(s: Splat): Surfel {
  const axes = splatAxes(s);
  const scales = [s.sx, s.sy, s.sz];
  const [n, a, b] = splatAxisOrder(s);
  const normal = axes[n]!;
  return {
    x: s.x, y: s.y, z: s.z,
    nx: normal[0], ny: normal[1], nz: normal[2],
    radius: 2 * Math.sqrt(scales[a]! * scales[b]!),
    r: s.r, g: s.g, b: s.b, a: s.a,
  };
}
