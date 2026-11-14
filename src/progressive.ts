/**
 * Nested refinement order for maxzoom tiles (documents/progressive-maxzoom.md).
 *
 * Given the finest surfels of one tile (tile-local x, y; z in metres), it
 * reorders them into levels:
 * - level 0: one representative per occupied cell of size W / BASE_CELLS;
 * - level k: one representative per occupied cell of size
 *   W / (BASE_CELLS · 2^k) that has no representative yet;
 * - the last level: every remaining surfel.
 * Cells are cubes aligned to the tile's north-west corner and to z = 0
 * (sea level), so the grids of successive levels nest exactly.
 *
 * The union of all levels is the input set: nothing is added, removed or
 * duplicated. A cell's representative is the not-yet-chosen surfel
 * nearest to the centroid of all the cell's surfels (ties: lower input
 * index). Within a level, records are sorted by cell (z, y, x) for
 * determinism.
 */
import type { Surfel } from "./surfel-block.js";

/** Cells per tile edge at level 0: one per CSS pixel of a 512 px tile. */
export const BASE_CELLS = 512;

export interface RefinementOrder<T extends Surfel = Surfel> {
  surfels: T[];
  /** Surfel count per level; sums to surfels.length. */
  levels: number[];
}

/** Cell key of a surfel at a level, plus its integer coordinates. */
function cellOf(s: Surfel, w: number, cellsPerTile: number): [string, number, number, number] {
  const size = w / cellsPerTile;
  const ix = Math.floor(s.x * cellsPerTile);
  const iy = Math.floor(s.y * cellsPerTile);
  const iz = Math.floor(s.z / size);
  return [`${ix},${iy},${iz}`, ix, iy, iz];
}

/**
 * Order the finest surfels of a tile into `levelCount` levels (>= 1). With
 * levelCount = 1 the result is one level holding every surfel, sorted by
 * finest cell.
 */
export function orderByRefinement<T extends Surfel>(surfels: readonly T[], tileWidthMetres: number, levelCount: number): RefinementOrder<T> {
  if (!Number.isInteger(levelCount) || levelCount < 1) throw new RangeError("levelCount must be a positive integer");
  if (!(tileWidthMetres > 0)) throw new RangeError("tileWidthMetres must be positive");
  const chosen = new Uint8Array(surfels.length);
  const out: T[] = [];
  const levels: number[] = [];

  for (let k = 0; k < levelCount; k++) {
    const last = k === levelCount - 1;
    const cellsPerTile = BASE_CELLS * 2 ** k;
    // Group every surfel by its cell at this level.
    const cells = new Map<string, { ix: number; iy: number; iz: number; members: number[]; covered: boolean }>();
    surfels.forEach((s, i) => {
      const [key, ix, iy, iz] = cellOf(s, tileWidthMetres, cellsPerTile);
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { ix, iy, iz, members: [], covered: false }));
      c.members.push(i);
      if (chosen[i]) c.covered = true;
    });
    const picked: Array<{ i: number; ix: number; iy: number; iz: number }> = [];
    for (const c of cells.values()) {
      if (last) {
        for (const i of c.members) if (!chosen[i]) picked.push({ i, ix: c.ix, iy: c.iy, iz: c.iz });
        continue;
      }
      if (c.covered) continue;
      let cx = 0, cy = 0, cz = 0;
      for (const i of c.members) {
        const s = surfels[i]!;
        cx += s.x * tileWidthMetres; cy += s.y * tileWidthMetres; cz += s.z;
      }
      const n = c.members.length;
      cx /= n; cy /= n; cz /= n;
      let best = -1, bestD = Infinity;
      for (const i of c.members) {
        const s = surfels[i]!;
        const d = (s.x * tileWidthMetres - cx) ** 2 + (s.y * tileWidthMetres - cy) ** 2 + (s.z - cz) ** 2;
        if (d < bestD || (d === bestD && i < best)) { best = i; bestD = d; }
      }
      picked.push({ i: best, ix: c.ix, iy: c.iy, iz: c.iz });
    }
    picked.sort((a, b) => a.iz - b.iz || a.iy - b.iy || a.ix - b.ix || a.i - b.i);
    for (const p of picked) {
      chosen[p.i] = 1;
      out.push(surfels[p.i]!);
    }
    levels.push(picked.length);
  }
  return { surfels: out, levels };
}

/**
 * Omit records from the refinement levels (1 and later) that fail `keep`.
 * Level 0 is kept whole, so every occupied level-0 cell stays covered;
 * only the detail added beyond level 0 is thinned. The order within each
 * level is preserved. (E002 in EXPERIMENTS.md.)
 */
export function omitWeakRefinements<T extends Surfel>(order: RefinementOrder<T>, keep: (s: T) => boolean): RefinementOrder<T> {
  const surfels: T[] = [];
  const levels: number[] = [];
  let at = 0;
  order.levels.forEach((count, k) => {
    let kept = 0;
    for (let i = at; i < at + count; i++) {
      const s = order.surfels[i]!;
      if (k === 0 || keep(s)) {
        surfels.push(s);
        kept++;
      }
    }
    at += count;
    levels.push(kept);
  });
  return { surfels, levels };
}

/** Number of surfels to draw for the first `levels` levels of a level table. */
export function prefixCount(levels: readonly number[], levelsToDraw: number): number {
  let n = 0;
  for (let k = 0; k < Math.min(levelsToDraw, levels.length); k++) n += levels[k]!;
  return n;
}
