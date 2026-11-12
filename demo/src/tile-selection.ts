/**
 * Tile selection: which loaded tiles to draw at a display zoom, and how
 * much of a progressive (multi-level) tile. No DOM, network or WebGL here.
 *
 * Rule (documents/progressive-maxzoom.md):
 * - draw the tiles of the deepest loaded zoom z with z <= floor(display
 *   zoom), or of the shallowest loaded zoom when zoomed out further;
 * - for a tile with a level table, draw levels 0..(floor(display zoom) - z),
 *   clamped to its level count, and inflate radii to cover the finest drawn
 *   level's cell (RADIUS_CELL_FACTOR × cell size).
 */
import { BASE_CELLS, prefixCount } from "../../src/progressive.js";

/** Fraction of a cell's edge used as the minimum disc radius when drawing a prefix. */
export const RADIUS_CELL_FACTOR = 0.75;

export interface SelectableTile {
  tile: { z: number };
  levels: readonly number[];
  widthMetres: number;
}

export interface TileDraw {
  /** Records to draw: the first `count` in stored order. */
  count: number;
  /** Levels drawn (1 for a single-level tile). */
  levelsDrawn: number;
  /** Minimum disc radius in metres (0 = use the stored radius). */
  minRadius: number;
}

/** The zoom level of loaded tiles to draw at a display zoom. */
export function selectZoom(available: readonly number[], displayZoom: number): number {
  const zs = [...new Set(available)].sort((a, b) => a - b);
  if (zs.length === 0) throw new Error("no tiles loaded");
  const z = Math.floor(displayZoom);
  let pick = zs[0]!;
  for (const a of zs) if (a <= z) pick = a;
  return pick;
}

/** How much of one tile to draw at a display zoom (the tile is of the selected zoom). */
export function drawPlan(t: SelectableTile, displayZoom: number): TileDraw {
  const total = t.levels.reduce((a, b) => a + b, 0);
  if (t.levels.length <= 1) return { count: total, levelsDrawn: 1, minRadius: 0 };
  const want = Math.floor(displayZoom) - t.tile.z + 1;
  const levelsDrawn = Math.min(t.levels.length, Math.max(1, want));
  const cell = t.widthMetres / (BASE_CELLS * 2 ** (levelsDrawn - 1));
  return { count: prefixCount(t.levels, levelsDrawn), levelsDrawn, minRadius: RADIUS_CELL_FACTOR * cell };
}
