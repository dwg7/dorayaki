/**
 * Per-patch sampling for fixtures.
 *
 * A patch is an axis-aligned rectangle on one surface, spanned by two
 * axes. Each axis is given in its native unit: tile-local for x and y,
 * metres for z. `metresPerUnit` converts it to metres (the tile width
 * for x and y, 1 for z).
 *
 * Rule: choose one spacing s <= maxPitch (metres) that suits both sides
 * of the patch, divide each side into ceil(length / s) equal cells, put a
 * surfel at each cell centre, and give every surfel the radius of half the
 * cell diagonal (so the discs cover the cell corners). A disc then extends
 * beyond the patch edge by r - min(cell)/2. Both sides are at least s long,
 * so each cell side lies in [s/2, s] and the overshoot is at most
 * (√5 - 1)/4 · s ≈ 0.309 · s; for square cells it is (√2 - 1)/2 · s ≈
 * 0.207 · s. This replaces the earlier rule, where a vertical face used the
 * horizontal pitch for its radius regardless of the face's height.
 *
 * Positions and radius are rounded to float32. A tile-local side whose
 * cell size is a power-of-two fraction yields float32-exact positions.
 */

export interface PatchAxis {
  /** Start of the patch along this axis, in the axis's native unit. */
  lo: number;
  /** End of the patch along this axis, in the axis's native unit. */
  hi: number;
  /** Metres per native unit (tile width for x/y, 1 for z). */
  metresPerUnit: number;
}

export interface PatchSamples {
  /** Cell centres along the first axis, native unit. */
  u: number[];
  /** Cell centres along the second axis, native unit. */
  v: number[];
  /** Disc radius in metres (half the cell diagonal). */
  radius: number;
  /** Cell size in metres along each axis. */
  cell: [number, number];
}

/** Tolerance so that a length that divides exactly is not split once more. */
const EPS = 1e-9;

function count(lengthMetres: number, spacing: number): number {
  return Math.max(1, Math.ceil(lengthMetres / spacing - EPS));
}

function centres(a: PatchAxis, n: number): number[] {
  const step = (a.hi - a.lo) / n;
  return Array.from({ length: n }, (_, k) => Math.fround(a.lo + (k + 0.5) * step));
}

export function samplePatch(u: PatchAxis, v: PatchAxis, maxPitchMetres: number): PatchSamples {
  if (!Number.isFinite(maxPitchMetres) || maxPitchMetres <= 0) {
    throw new RangeError(`maxPitchMetres must be a positive finite number, got ${maxPitchMetres}`);
  }
  const lu = (u.hi - u.lo) * u.metresPerUnit;
  const lv = (v.hi - v.lo) * v.metresPerUnit;
  if (!(lu > 0) || !(lv > 0)) throw new RangeError("patch sides must have positive length");

  // One spacing for both sides: the finer of each side's own division at maxPitch.
  const s = Math.min(lu / count(lu, maxPitchMetres), lv / count(lv, maxPitchMetres));
  const nu = count(lu, s);
  const nv = count(lv, s);
  const cell: [number, number] = [lu / nu, lv / nv];
  return {
    u: centres(u, nu),
    v: centres(v, nv),
    radius: Math.fround(Math.hypot(cell[0], cell[1]) / 2),
    cell,
  };
}

/** Largest distance a disc of this patch reaches beyond the patch edge, in metres. */
export function patchOvershoot(p: PatchSamples): number {
  return p.radius - Math.min(p.cell[0], p.cell[1]) / 2;
}
