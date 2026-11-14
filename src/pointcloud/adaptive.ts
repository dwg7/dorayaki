/**
 * Adaptive merging of voxel Gaussians (EXPERIMENTS.md E005).
 *
 * Starts from the occupied voxels of a VoxelAccumulator and merges, level by
 * level, the occupied children of each parent cell (cells double: size · 2^k)
 * into one Gaussian when the merged points still form a thin patch or line
 * and their colour is nearly uniform. A flat road then costs one splat per
 * large cell instead of one per voxel; edges, vegetation and colour changes
 * keep their small cells.
 *
 * Merging is exact in the moments (parallel-axis combination), so a merged
 * Gaussian is the fit of all its points. A parent cell that fails to merge
 * blocks every larger ancestor, so splats never overlap across sizes. No
 * level table is involved: the result is a flat list of Gaussians of mixed
 * size, not a level of detail.
 */
import type { Gaussian } from "../gaussian/to-surfels.js";
import type { VoxelAccumulator } from "./voxel-accumulator.js";
import { gaussianFromMoments, symmetricEigen3 } from "./voxel-gaussians.js";

export interface AdaptiveOptions {
  /** Merge up to cells of size · 2^maxLevel (0 = no merging). */
  maxLevel: number;
  /** A merge needs the smallest standard deviation of the merged points to be at most this (metres). */
  thickness: number;
  /** ...and each child's mean colour within this of the merged mean, per channel (0..1). */
  colourTolerance: number;
  minScale?: number;
  opacity?: number;
}

interface Node {
  ix: number; iy: number; iz: number;
  /** True for a placeholder that only blocks ancestors. */
  marker: boolean;
  n: number;
  mean: [number, number, number];
  /** Σ (x − mean)(x − mean)ᵀ: xx, xy, xz, yy, yz, zz. */
  m2: [number, number, number, number, number, number];
  rgb: [number, number, number];
  /** Size of the largest source voxel, for the scale of a node of fewer than 3 points. */
  cell: number;
}

export interface AdaptiveResult {
  gaussians: Gaussian[];
  /** Gaussians emitted per merge level (index = level, 0 = a source voxel). */
  perLevel: number[];
}

const OFFSET = 1 << 16;
const SPAN = 1 << 17;
const key = (ix: number, iy: number, iz: number): number => ((ix + OFFSET) * SPAN + (iy + OFFSET)) * SPAN + (iz + OFFSET);

function merge(kids: readonly Node[], ix: number, iy: number, iz: number): Node {
  let n = 0;
  let mx = 0, my = 0, mz = 0;
  for (const k of kids) { n += k.n; mx += k.n * k.mean[0]; my += k.n * k.mean[1]; mz += k.n * k.mean[2]; }
  mx /= n; my /= n; mz /= n;
  const m2: Node["m2"] = [0, 0, 0, 0, 0, 0];
  const rgb: Node["rgb"] = [0, 0, 0];
  let cell = 0;
  for (const k of kids) {
    const dx = k.mean[0] - mx, dy = k.mean[1] - my, dz = k.mean[2] - mz;
    m2[0] += k.m2[0] + k.n * dx * dx; m2[1] += k.m2[1] + k.n * dx * dy; m2[2] += k.m2[2] + k.n * dx * dz;
    m2[3] += k.m2[3] + k.n * dy * dy; m2[4] += k.m2[4] + k.n * dy * dz; m2[5] += k.m2[5] + k.n * dz * dz;
    for (let c = 0; c < 3; c++) rgb[c]! += k.rgb[c]!;
    cell = Math.max(cell, k.cell);
  }
  return { ix, iy, iz, marker: false, n, mean: [mx, my, mz], m2, rgb, cell };
}

function acceptable(kids: readonly Node[], m: Node, o: AdaptiveOptions): boolean {
  const [xx, xy, xz, yy, yz, zz] = m.m2.map((v) => v / m.n) as Node["m2"];
  const { values } = symmetricEigen3([xx, xy, xz, xy, yy, yz, xz, yz, zz]);
  if (Math.sqrt(Math.max(0, values[2])) > o.thickness) return false;
  for (const k of kids) {
    for (let c = 0; c < 3; c++) {
      if (Math.abs(k.rgb[c]! / k.n - m.rgb[c]! / m.n) > o.colourTolerance) return false;
    }
  }
  return true;
}

export function adaptiveGaussians(acc: VoxelAccumulator, options: AdaptiveOptions): AdaptiveResult {
  if (!Number.isInteger(options.maxLevel) || options.maxLevel < 0) throw new RangeError("maxLevel must be a non-negative integer");
  const fit = { minScale: options.minScale ?? 0.001, opacity: options.opacity ?? 0.95 };
  const gaussians: Gaussian[] = [];
  const perLevel = new Array<number>(options.maxLevel + 1).fill(0);
  const emit = (node: Node, level: number): void => {
    const { n } = node;
    gaussians.push(gaussianFromMoments(
      n, node.mean, node.m2.map((v) => v / n) as Node["m2"], [node.rgb[0] / n, node.rgb[1] / n, node.rgb[2] / n],
      { ...fit, degenerateScale: node.cell / 4 },
    ));
    perLevel[level]!++;
  };

  let current = new Map<number, Node>();
  acc.forEachVoxel((ix, iy, iz, n, mean, cov, colour) => {
    current.set(key(ix, iy, iz), {
      ix, iy, iz, marker: false, n, mean,
      m2: cov.map((v) => v * n) as Node["m2"],
      rgb: [colour[0] * n, colour[1] * n, colour[2] * n],
      cell: acc.size,
    });
  });

  for (let level = 1; level <= options.maxLevel; level++) {
    const groups = new Map<number, Node[]>();
    for (const node of current.values()) {
      const pk = key(node.ix >> 1, node.iy >> 1, node.iz >> 1);
      const g = groups.get(pk);
      if (g) g.push(node); else groups.set(pk, [node]);
    }
    const next = new Map<number, Node>();
    for (const [pk, kids] of groups) {
      const [first] = kids;
      const px = first!.ix >> 1, py = first!.iy >> 1, pz = first!.iz >> 1;
      const marker: Node = { ix: px, iy: py, iz: pz, marker: true, n: 0, mean: [0, 0, 0], m2: [0, 0, 0, 0, 0, 0], rgb: [0, 0, 0], cell: 0 };
      if (kids.some((k) => k.marker)) {
        for (const k of kids) if (!k.marker) emit(k, level - 1);
        next.set(pk, marker);
      } else if (kids.length === 1) {
        next.set(pk, { ...first!, ix: px, iy: py, iz: pz });
      } else {
        const m = merge(kids, px, py, pz);
        if (acceptable(kids, m, options)) {
          next.set(pk, m);
        } else {
          for (const k of kids) emit(k, level - 1);
          next.set(pk, marker);
        }
      }
    }
    current = next;
  }
  for (const node of current.values()) if (!node.marker) emit(node, options.maxLevel);
  return { gaussians, perLevel };
}
