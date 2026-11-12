/**
 * Deterministic toy 3DGS PLY, written in the reference 3DGS conventions
 * (log scales, logit opacity, quaternion w x y z, SH DC colour) with
 * axes east, north, up in metres around an origin. It stands in for
 * Gaussians fitted to a point cloud until real data is chosen.
 *
 * - ground: 20 × 20 flat Gaussians on a 2 m grid (shortest axis up),
 *   anisotropic in-plane (1.2 m east × 0.8 m north);
 * - wall: 10 × 5 flat Gaussians, 20 m long and 10 m high, rotated 30° about
 *   up, so its shortest axis points 30° west of north;
 * - blob: 27 isotropic Gaussians (a tree-like cluster) with no preferred
 *   axis, centred 6 m above the ground.
 */
import { writePlyFloat32 } from "../gaussian/ply.js";
import { SH_C0 } from "../gaussian/to-surfels.js";

export const TOY_GS_PROPERTIES = [
  "x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
  "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3",
] as const;

export const TOY_GS_COUNTS = { ground: 400, wall: 50, blob: 27 } as const;

const dc = (linear: number): number => (linear - 0.5) / SH_C0;
const logit = (p: number): number => Math.log(p / (1 - p));

function row(
  [x, y, z]: [number, number, number],
  [r, g, b]: [number, number, number],
  opacity: number,
  [s0, s1, s2]: [number, number, number],
  [qw, qx, qy, qz]: [number, number, number, number],
): number[] {
  return [x, y, z, 0, 0, 0, dc(r), dc(g), dc(b), logit(opacity), Math.log(s0), Math.log(s1), Math.log(s2), qw, qx, qy, qz];
}

export function toyGaussianRows(): number[][] {
  const rows: number[][] = [];
  for (let j = 0; j < 20; j++) {
    for (let i = 0; i < 20; i++) {
      rows.push(row([-19 + 2 * i, -19 + 2 * j, 0], [0.35, 0.55, 0.3], 0.9, [1.2, 0.8, 0.05], [1, 0, 0, 0]));
    }
  }
  // Wall: axis 1 (north) is the shortest before rotation; rotate 30° about up.
  const half = (30 * Math.PI) / 360;
  const q: [number, number, number, number] = [Math.cos(half), 0, 0, Math.sin(half)];
  const [c, s] = [Math.cos(2 * half), Math.sin(2 * half)];
  for (let k = 0; k < 5; k++) {
    for (let i = 0; i < 10; i++) {
      const t = -9 + 2 * i; // along the wall (rotated east axis)
      rows.push(row([t * c, 8 + t * s, 1 + 2 * k], [0.8, 0.78, 0.72], 0.95, [1.1, 0.04, 1.1], q));
    }
  }
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (let h = -1; h <= 1; h++) {
        rows.push(row([10 + 1.5 * a, -8 + 1.5 * b, 6 + 1.5 * h], [0.2, 0.45, 0.2], 0.6, [0.9, 0.9, 0.9], [1, 0, 0, 0]));
      }
    }
  }
  return rows;
}

export function toyGaussianPly(): Uint8Array {
  return writePlyFloat32(TOY_GS_PROPERTIES, toyGaussianRows());
}
