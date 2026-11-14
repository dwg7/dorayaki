/**
 * Mapping from 3D Gaussian Splatting (3DGS) Gaussians to Surfel Block v4
 * splats, and their placement on tiles.
 *
 * A Gaussian's position, three scales and rotation map directly onto a
 * splat (only the frame changes: east-north-up to east-south-up, and
 * quantization). What is still dropped:
 *
 * - colour = the SH degree-0 (DC) term only; higher SH terms are dropped;
 * - alpha = sigmoid(opacity), stored; the renderer may or may not use it.
 *
 * `gaussianToDisc` is a statistics helper: the circular reduction the
 * v1-v3 records used (normal = shortest axis, radius = RADIUS_SIGMAS ·
 * √(s_a · s_b)), with flatness and anisotropy.
 *
 * PLY conventions follow the reference 3DGS implementation: scale_* are
 * log scales, opacity is a logit, rot_0..rot_3 is a quaternion (w, x, y, z),
 * f_dc_* are SH DC coefficients.
 *
 * Placement assumes the PLY axes are east, north, up in metres around a
 * geographic origin. It uses the Mercator scale at the origin latitude for
 * the whole set, which is adequate for a toy extent of a few tiles.
 */
import type { Splat } from "../surfel-block.js";
import { quaternionFromAxes, rotationAxes } from "../splat.js";
import { EARTH_CIRCUMFERENCE_METRES } from "../tile-geometry.js";
import type { TileBlock } from "../tiling.js";
import type { PlyVertices } from "./ply.js";

/** SH degree-0 basis constant, as in the reference 3DGS implementation. */
export const SH_C0 = 0.28209479177387814;
/** Disc radius in units of the Gaussian's in-plane standard deviation. */
export const RADIUS_SIGMAS = 2;

export interface Gaussian {
  /** East, north, up, metres. */
  position: [number, number, number];
  /** Linear standard deviations along the rotated axes, metres. */
  scales: [number, number, number];
  /** Unit quaternion (w, x, y, z). */
  rotation: [number, number, number, number];
  /** Linear RGB in [0, 1] from the SH DC term (clamped). */
  colour: [number, number, number];
  /** [0, 1]. */
  opacity: number;
  /** Number of source points behind this Gaussian, when known (point-cloud fits). */
  support?: number;
}

const REQUIRED = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
  "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"] as const;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const sigmoid = (v: number): number => 1 / (1 + Math.exp(-v));

/** Interpret PLY vertex columns with the reference 3DGS conventions. */
export function gaussiansFromPly(ply: PlyVertices): Gaussian[] {
  for (const name of REQUIRED) {
    if (!ply.columns[name]) throw new Error(`3DGS PLY is missing property ${name}`);
  }
  const c = (name: (typeof REQUIRED)[number], i: number): number => (ply.columns[name] as Float64Array)[i] as number;
  const out: Gaussian[] = [];
  for (let i = 0; i < ply.count; i++) {
    const q: [number, number, number, number] = [c("rot_0", i), c("rot_1", i), c("rot_2", i), c("rot_3", i)];
    const qn = Math.hypot(...q);
    if (!(qn > 0)) throw new Error(`Gaussian ${i} has a zero rotation quaternion`);
    out.push({
      position: [c("x", i), c("y", i), c("z", i)],
      scales: [Math.exp(c("scale_0", i)), Math.exp(c("scale_1", i)), Math.exp(c("scale_2", i))],
      rotation: q.map((v) => v / qn) as [number, number, number, number],
      colour: [0, 1, 2].map((k) => clamp01(0.5 + SH_C0 * c(`f_dc_${k}` as "f_dc_0", i))) as [number, number, number],
      opacity: sigmoid(c("opacity", i)),
    });
  }
  return out;
}

export { rotationAxes };

export interface Disc {
  /** East, north, up, metres. */
  position: [number, number, number];
  /** Unit normal, east-north-up. */
  normal: [number, number, number];
  radius: number;
  colour: [number, number, number];
  opacity: number;
  /** Ratio of the two in-plane scales (>= 1); 1 means the ellipse was a circle. */
  anisotropy: number;
  /** Shortest scale / geometric mean of the in-plane scales; near 0 means flat. */
  flatness: number;
  /** Source points behind the Gaussian, when known. */
  support?: number;
}

export function gaussianToDisc(g: Gaussian): Disc {
  const axes = rotationAxes(g.rotation);
  const order = [0, 1, 2].sort((a, b) => g.scales[a]! - g.scales[b]!);
  const [n, a, b] = order as [number, number, number];
  const sa = g.scales[a]!;
  const sb = g.scales[b]!;
  const inPlane = Math.sqrt(sa * sb);
  return {
    position: g.position,
    normal: axes[n] as [number, number, number],
    radius: RADIUS_SIGMAS * inPlane,
    colour: g.colour,
    opacity: g.opacity,
    anisotropy: sb / sa,
    flatness: g.scales[n]! / inPlane,
    ...(g.support !== undefined ? { support: g.support } : {}),
  };
}

export interface GeoOrigin {
  lng: number;
  lat: number;
}

/** A splat in block-local coordinates (x, y in tile units over the whole block) with its point support. */
export type PlacedSplat = Splat & { support?: number };

/**
 * Place east-north-up Gaussians around a geographic origin on zoom-level
 * tiles. Returns the smallest tile block containing every centre, and the
 * splats in that block's block-local coordinates (see src/tiling.ts;
 * x, y span [0, cols) and [0, rows) tile units). Rotations are converted
 * from east-north-up to the east-south-up frame of a block.
 */
export function placeGaussians(gaussians: readonly Gaussian[], origin: GeoOrigin, zoom: number): { block: TileBlock; splats: PlacedSplat[] } {
  if (gaussians.length === 0) throw new Error("no Gaussians to place");
  const n = 2 ** zoom;
  const lat0 = (origin.lat * Math.PI) / 180;
  const u0 = ((origin.lng + 180) / 360) * n; // tile units
  const v0 = ((1 - Math.asinh(Math.tan(lat0)) / Math.PI) / 2) * n;
  const tilesPerMetre = n / (EARTH_CIRCUMFERENCE_METRES * Math.cos(lat0));

  const tx = gaussians.map((g) => u0 + g.position[0] * tilesPerMetre);
  const ty = gaussians.map((g) => v0 - g.position[1] * tilesPerMetre);
  // Loops, not Math.min(...array): spreading hundreds of thousands of
  // arguments overflows the call stack.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < tx.length; i++) {
    minX = Math.min(minX, tx[i]!); maxX = Math.max(maxX, tx[i]!);
    minY = Math.min(minY, ty[i]!); maxY = Math.max(maxY, ty[i]!);
  }
  const x0 = Math.floor(minX);
  const y0 = Math.floor(minY);
  const block: TileBlock = {
    origin: { z: zoom, x: x0, y: y0 },
    cols: Math.floor(maxX) - x0 + 1,
    rows: Math.floor(maxY) - y0 + 1,
  };
  const byte = (v: number): number => Math.round(clamp01(v) * 255);
  const splats = gaussians.map((g, i): PlacedSplat => {
    // East-north-up -> east-south-up flips y; flipping one local axis as
    // well keeps the matrix a proper rotation (axes are unsigned lines).
    const [a0, a1, a2] = rotationAxes(g.rotation);
    const [qw, qx, qy, qz] = quaternionFromAxes([-a0[0], a0[1], -a0[2]], [a1[0], -a1[1], a1[2]], [a2[0], -a2[1], a2[2]]);
    return {
      x: tx[i]! - x0,
      y: ty[i]! - y0,
      z: g.position[2],
      sx: g.scales[0], sy: g.scales[1], sz: g.scales[2],
      qw, qx, qy, qz,
      r: byte(g.colour[0]), g: byte(g.colour[1]), b: byte(g.colour[2]),
      a: byte(g.opacity),
      ...(g.support !== undefined ? { support: g.support } : {}),
    };
  });
  return { block, splats };
}
