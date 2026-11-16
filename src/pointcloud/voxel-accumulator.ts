/**
 * Streaming voxel accumulator: the same one-Gaussian-per-voxel fit as
 * fitVoxelGaussians (voxel-gaussians.ts), but fed one point at a time, so a
 * point cloud of hundreds of millions of points never has to be in memory.
 * Memory is proportional to the number of occupied voxels (about 120 bytes
 * each), not to the number of points.
 *
 * Per voxel it keeps the moments that make a Gaussian: the count, the sums of
 * the offset from the voxel's minimum corner (not the absolute coordinate, so
 * the sums stay small and precise), of its pairwise products, and of the
 * colour. Voxels live in an open-addressing hash table of typed arrays; the
 * per-voxel records are stored in fixed-size chunks so growing never copies
 * them. No file or DOM access; the caller feeds the points.
 */
import type { Gaussian } from "../gaussian/to-surfels.js";
import { gaussianFromMoments } from "./voxel-gaussians.js";

const CHUNK_BITS = 16;
const CHUNK = 1 << CHUNK_BITS;
const CHUNK_MASK = CHUNK - 1;
/** Doubles per voxel: n, Σd (3), Σddᵀ (6), Σrgb (3). */
const STRIDE = 13;

export interface AccumulatorFit {
  /** Voxels with fewer points are dropped (default 1). */
  minPoints?: number;
  minScale?: number;
  degenerateScale?: number;
  opacity?: number;
}

export class VoxelAccumulator {
  readonly size: number;
  /** Number of occupied voxels. */
  voxels = 0;
  /** Number of points added. */
  points = 0;

  /** Slot -> voxel id + 1, 0 when empty. Length is a power of two. */
  private table: Int32Array;
  private mask: number;
  private readonly keys: Int32Array[] = [];
  private readonly sums: Float64Array[] = [];

  constructor(size: number, initialCapacityLog2 = 16) {
    if (!(size > 0) || !Number.isFinite(size)) throw new RangeError("voxel size must be positive and finite");
    this.size = size;
    this.table = new Int32Array(1 << initialCapacityLog2);
    this.mask = this.table.length - 1;
  }

  /** Bytes held by the table and the per-voxel chunks (typed arrays only). */
  get byteLength(): number {
    return this.table.byteLength + this.keys.length * CHUNK * (3 * 4 + STRIDE * 8);
  }

  /** Add one point (local metres; colour channels in 0..1). */
  add(x: number, y: number, z: number, r: number, g: number, b: number): void {
    const size = this.size;
    const ix = Math.floor(x / size), iy = Math.floor(y / size), iz = Math.floor(z / size);
    if (!(Math.abs(ix) < 2 ** 31 && Math.abs(iy) < 2 ** 31 && Math.abs(iz) < 2 ** 31)) {
      throw new RangeError("point is outside the representable voxel grid (non-finite or too far from the origin)");
    }
    const id = this.find(ix | 0, iy | 0, iz | 0);
    const chunk = this.sums[id >> CHUNK_BITS]!;
    const o = (id & CHUNK_MASK) * STRIDE;
    const dx = x - ix * size, dy = y - iy * size, dz = z - iz * size;
    chunk[o]! += 1;
    chunk[o + 1]! += dx; chunk[o + 2]! += dy; chunk[o + 3]! += dz;
    chunk[o + 4]! += dx * dx; chunk[o + 5]! += dx * dy; chunk[o + 6]! += dx * dz;
    chunk[o + 7]! += dy * dy; chunk[o + 8]! += dy * dz; chunk[o + 9]! += dz * dz;
    chunk[o + 10]! += r; chunk[o + 11]! += g; chunk[o + 12]! += b;
    this.points++;
  }

  /** The voxel id of a cell, creating it when new. */
  private find(ix: number, iy: number, iz: number): number {
    let h = Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca77) ^ Math.imul(iz, 0xc2b2ae3d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 13;
    let slot = h & this.mask;
    for (;;) {
      const e = this.table[slot]!;
      if (e === 0) break;
      const id = e - 1;
      const k = this.keys[id >> CHUNK_BITS]!;
      const o = (id & CHUNK_MASK) * 3;
      if (k[o] === ix && k[o + 1] === iy && k[o + 2] === iz) return id;
      slot = (slot + 1) & this.mask;
    }
    // New voxel.
    const id = this.voxels;
    if ((id & CHUNK_MASK) === 0) {
      this.keys.push(new Int32Array(CHUNK * 3));
      this.sums.push(new Float64Array(CHUNK * STRIDE));
    }
    const k = this.keys[id >> CHUNK_BITS]!;
    const o = (id & CHUNK_MASK) * 3;
    k[o] = ix; k[o + 1] = iy; k[o + 2] = iz;
    this.table[slot] = id + 1;
    this.voxels = id + 1;
    if (this.voxels * 2 > this.table.length) this.grow();
    return id;
  }

  /** Double the table and re-insert every voxel; the voxel records stay where they are. */
  private grow(): void {
    const table = new Int32Array(this.table.length * 2);
    const mask = table.length - 1;
    for (let id = 0; id < this.voxels; id++) {
      const k = this.keys[id >> CHUNK_BITS]!;
      const o = (id & CHUNK_MASK) * 3;
      let h = Math.imul(k[o]!, 0x9e3779b1) ^ Math.imul(k[o + 1]!, 0x85ebca77) ^ Math.imul(k[o + 2]!, 0xc2b2ae3d);
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
      h ^= h >>> 13;
      let slot = h & mask;
      while (table[slot] !== 0) slot = (slot + 1) & mask;
      table[slot] = id + 1;
    }
    this.table = table;
    this.mask = mask;
  }

  /** Voxel ids in the deterministic order (z, then y, then x of the cell index). */
  private sortedIds(): Uint32Array {
    const ids = new Uint32Array(this.voxels);
    for (let i = 0; i < ids.length; i++) ids[i] = i;
    const key = (id: number, axis: number) => this.keys[id >> CHUNK_BITS]![(id & CHUNK_MASK) * 3 + axis]!;
    return ids.sort((a, b) => key(a, 2) - key(b, 2) || key(a, 1) - key(b, 1) || key(a, 0) - key(b, 0));
  }

  /**
   * Call `fn` for every occupied voxel, in the deterministic order (z, y, x
   * of the cell index), with its cell index, point count, mean position, point
   * covariance (xx, xy, xz, yy, yz, zz) and mean colour.
   */
  forEachVoxel(
    fn: (
      ix: number, iy: number, iz: number, n: number,
      mean: [number, number, number],
      cov: [number, number, number, number, number, number],
      colour: [number, number, number],
    ) => void,
  ): void {
    for (const id of this.sortedIds()) {
      const s = this.sums[id >> CHUNK_BITS]!;
      const o = (id & CHUNK_MASK) * STRIDE;
      const n = s[o]!;
      const k = this.keys[id >> CHUNK_BITS]!;
      const ko = (id & CHUNK_MASK) * 3;
      const mdx = s[o + 1]! / n, mdy = s[o + 2]! / n, mdz = s[o + 3]! / n;
      fn(
        k[ko]!, k[ko + 1]!, k[ko + 2]!, n,
        [k[ko]! * this.size + mdx, k[ko + 1]! * this.size + mdy, k[ko + 2]! * this.size + mdz],
        [s[o + 4]! / n - mdx * mdx, s[o + 5]! / n - mdx * mdy, s[o + 6]! / n - mdx * mdz,
          s[o + 7]! / n - mdy * mdy, s[o + 8]! / n - mdy * mdz, s[o + 9]! / n - mdz * mdz],
        [s[o + 10]! / n, s[o + 11]! / n, s[o + 12]! / n],
      );
    }
  }

  /** One Gaussian per occupied voxel, in the order fitVoxelGaussians returns them. */
  toGaussians(fit: AccumulatorFit = {}): Gaussian[] {
    const minPoints = fit.minPoints ?? 1;
    const options = {
      minScale: fit.minScale ?? 0.001,
      degenerateScale: fit.degenerateScale ?? fit.minScale ?? 0.001,
      opacity: fit.opacity ?? 0.95,
    };
    const out: Gaussian[] = [];
    for (const id of this.sortedIds()) {
      const s = this.sums[id >> CHUNK_BITS]!;
      const o = (id & CHUNK_MASK) * STRIDE;
      const n = s[o]!;
      if (n < minPoints) continue;
      const k = this.keys[id >> CHUNK_BITS]!;
      const ko = (id & CHUNK_MASK) * 3;
      const mdx = s[o + 1]! / n, mdy = s[o + 2]! / n, mdz = s[o + 3]! / n;
      out.push(gaussianFromMoments(
        n,
        [k[ko]! * this.size + mdx, k[ko + 1]! * this.size + mdy, k[ko + 2]! * this.size + mdz],
        // Covariance is invariant to the shift to the voxel corner.
        [s[o + 4]! / n - mdx * mdx, s[o + 5]! / n - mdx * mdy, s[o + 6]! / n - mdx * mdz,
          s[o + 7]! / n - mdy * mdy, s[o + 8]! / n - mdy * mdz, s[o + 9]! / n - mdz * mdz],
        [s[o + 10]! / n, s[o + 11]! / n, s[o + 12]! / n],
        options,
      ));
    }
    return out;
  }
}
