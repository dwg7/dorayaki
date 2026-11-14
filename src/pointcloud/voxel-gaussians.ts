/**
 * Toy point-cloud-to-Gaussian fitting: one Gaussian per occupied voxel.
 *
 * Points are binned into cubic voxels. Each voxel with at least `minPoints`
 * points becomes one Gaussian with the voxel points' mean (position),
 * covariance (eigenvectors give the rotation, sqrt eigenvalues the scales),
 * and mean colour. Opacity is a constant. This is a deterministic
 * initialisation of the kind 3DGS starts from; there is no photometric
 * optimisation.
 *
 * Input is in a local metric frame (east, north, up). The output can be
 * written as a reference-3DGS PLY with gaussiansToPlyRows.
 */
import { SH_C0, type Gaussian } from "../gaussian/to-surfels.js";

export interface LocalPoints {
  count: number;
  /** East, north, up, metres; interleaved xyz. */
  xyz: Float64Array;
  /** Linear 0..1 RGB, interleaved. */
  rgb: Float32Array;
}

export interface VoxelOptions {
  voxelSize: number;
  minPoints?: number;
  /** Lower bound on a Gaussian's scale (metres); avoids log(0) for planar voxels. */
  minScale?: number;
  /**
   * Scale (metres) given to all three axes of a voxel with fewer than 3
   * points, whose covariance cannot define a shape. Defaults to minScale.
   * Applying a large floor to every voxel instead would flatten nothing:
   * it erases the thin axis of planar voxels (E003).
   */
  degenerateScale?: number;
  opacity?: number;
}

/** Eigen-decomposition of a symmetric 3 × 3 matrix by cyclic Jacobi rotations. */
export function symmetricEigen3(m: readonly number[]): { values: [number, number, number]; vectors: number[][] } {
  const a = [[m[0]!, m[1]!, m[2]!], [m[3]!, m[4]!, m[5]!], [m[6]!, m[7]!, m[8]!]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0]![1]! ** 2 + a[0]![2]! ** 2 + a[1]![2]! ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p]![q]!;
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!, akq = a[k]![q]!;
        a[k]![p] = c * akp - s * akq;
        a[k]![q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!, aqk = a[q]![k]!;
        a[p]![k] = c * apk - s * aqk;
        a[q]![k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k]![p]!, vkq = v[k]![q]!;
        v[k]![p] = c * vkp - s * vkq;
        v[k]![q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0]![0]!, a[1]![1]!, a[2]![2]!], vectors: v };
}

/** Unit quaternion (w, x, y, z) of a proper rotation matrix given by its columns. */
export function quaternionFromAxes(c0: number[], c1: number[], c2: number[]): [number, number, number, number] {
  const [m00, m10, m20] = c0 as [number, number, number];
  const [m01, m11, m21] = c1 as [number, number, number];
  const [m02, m12, m22] = c2 as [number, number, number];
  const tr = m00 + m11 + m22;
  let q: [number, number, number, number];
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
  return q.map((x) => x / len) as [number, number, number, number];
}

export function fitVoxelGaussians(points: LocalPoints, options: VoxelOptions): Gaussian[] {
  const size = options.voxelSize;
  if (!(size > 0)) throw new RangeError("voxelSize must be positive");
  const minPoints = options.minPoints ?? 4;
  const minScale = options.minScale ?? 0.001;
  const degenerateScale = options.degenerateScale ?? minScale;
  const opacity = options.opacity ?? 0.95;

  // Accumulate sums per voxel: count, Σx (3), Σxxᵀ (6), Σrgb (3).
  const acc = new Map<string, Float64Array>();
  const { xyz, rgb } = points;
  for (let i = 0; i < points.count; i++) {
    const x = xyz[i * 3]!, y = xyz[i * 3 + 1]!, z = xyz[i * 3 + 2]!;
    const key = `${Math.floor(x / size)},${Math.floor(y / size)},${Math.floor(z / size)}`;
    let s = acc.get(key);
    if (!s) acc.set(key, (s = new Float64Array(13)));
    s[0]! += 1;
    s[1]! += x; s[2]! += y; s[3]! += z;
    s[4]! += x * x; s[5]! += x * y; s[6]! += x * z; s[7]! += y * y; s[8]! += y * z; s[9]! += z * z;
    s[10]! += rgb[i * 3]!; s[11]! += rgb[i * 3 + 1]!; s[12]! += rgb[i * 3 + 2]!;
  }

  const out: Gaussian[] = [];
  // Deterministic order: sort voxel keys numerically (z, then y, then x).
  const keys = [...acc.keys()].map((k) => k.split(",").map(Number) as [number, number, number]);
  keys.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  for (const k of keys) {
    const s = acc.get(k.join(","))!;
    const n = s[0]!;
    if (n < minPoints) continue;
    const mx = s[1]! / n, my = s[2]! / n, mz = s[3]! / n;
    const cxx = s[4]! / n - mx * mx, cxy = s[5]! / n - mx * my, cxz = s[6]! / n - mx * mz;
    const cyy = s[7]! / n - my * my, cyz = s[8]! / n - my * mz, czz = s[9]! / n - mz * mz;
    const { values, vectors } = symmetricEigen3([cxx, cxy, cxz, cxy, cyy, cyz, cxz, cyz, czz]);
    const col = (j: number) => [vectors[0]![j]!, vectors[1]![j]!, vectors[2]![j]!];
    let c0 = col(0), c1 = col(1), c2 = col(2);
    // Ensure a proper rotation (determinant +1).
    const det = c0[0]! * (c1[1]! * c2[2]! - c1[2]! * c2[1]!) - c0[1]! * (c1[0]! * c2[2]! - c1[2]! * c2[0]!) + c0[2]! * (c1[0]! * c2[1]! - c1[1]! * c2[0]!);
    if (det < 0) c2 = c2.map((v) => -v);
    out.push({
      position: [mx, my, mz],
      scales: values.map((ev) => Math.max(n < 3 ? degenerateScale : minScale, Math.sqrt(Math.max(0, ev)))) as [number, number, number],
      rotation: quaternionFromAxes(c0, c1, c2),
      colour: [s[10]! / n, s[11]! / n, s[12]! / n],
      opacity,
      support: n,
    });
  }
  return out;
}

/** Rows for writePlyFloat32 with the reference-3DGS property names (see TOY_GS_PROPERTIES). */
export function gaussiansToPlyRows(gaussians: readonly Gaussian[]): number[][] {
  const logit = (p: number) => Math.log(p / (1 - p));
  return gaussians.map((g) => [
    ...g.position, 0, 0, 0,
    ...g.colour.map((c) => (c - 0.5) / SH_C0),
    logit(Math.min(0.999, Math.max(0.001, g.opacity))),
    ...g.scales.map(Math.log),
    ...g.rotation,
  ]);
}
