/**
 * The layer applies a tile set at the start of its next frame. When a second set arrives before that, the first is
 * never applied, and a tile in both sets must still bring its data: the demo gives each tile's data to the layer
 * once and drops its own copy (to hold one copy, not two), so the second set carries that tile without any.
 * No DOM or WebGL here.
 */
import type { TileAddress } from "../../src/tile-geometry.js";

/** The parts of a tile that hold its splats; a tile with none of them is only an address. */
export interface TileData {
  tile: TileAddress;
  splats?: unknown;
  instances?: unknown;
  packed?: unknown;
  classes?: unknown;
}

const key = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;
const hasData = (t: TileData): boolean => t.splats !== undefined || t.instances !== undefined || t.packed !== undefined;

/** `next`, where a tile without data takes the data (and classes) of the same tile in `unapplied`. */
export function inheritPendingData<T extends TileData>(unapplied: readonly T[], next: readonly T[]): readonly T[] {
  const before = new Map(unapplied.map((t) => [key(t.tile), t]));
  return next.map((t) => {
    if (hasData(t)) return t;
    const old = before.get(key(t.tile));
    if (!old || !hasData(old)) return t;
    const { splats, instances, packed, classes } = old;
    return { ...t, ...(splats !== undefined ? { splats } : {}), ...(instances !== undefined ? { instances } : {}), ...(packed !== undefined ? { packed } : {}), ...(classes !== undefined && t.classes === undefined ? { classes } : {}) };
  });
}
