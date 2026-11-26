/**
 * Which tiles to draw when the view reaches far (a tilted camera): detail by distance, so that tiles of several zooms
 * are drawn at once, each where the camera is close enough to deserve it. No DOM, network or WebGL here.
 *
 * It walks the tile pyramid from the coarsest zoom down. A tile is drawn as it is when the part of it closest to the
 * camera would be drawn at a map zoom below the next zoom (the same floor rule as tile-selection.ts, applied per
 * tile instead of once for the whole map: `effectiveZoom` in camera.ts is the zoom at which a point is seen), or
 * when it has no finer zoom, or when any of the finer tiles that replace it is missing (the tile may hold data where
 * its children have none). Otherwise the finer tiles replace it. The result is a partition: no tile covers another.
 */
import { tileLatitude, tileLongitude, type TileAddress } from "../../src/tile-geometry.js";
import { cameraModel, effectiveZoom, mercator, type CameraModel, type V3, type View } from "./camera.js";
import type { LngLatBoundsArray } from "./tile-view.js";

const key = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;

/** Highest effective zoom over the tile's corners and centre (its nearest part to the camera, at the view's ground height). */
function tileEffectiveZoom(t: TileAddress, camera: CameraModel, groundZ: number): number {
  let best = -Infinity;
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]] as const) {
    const [X, Y] = mercator(tileLongitude(t, u), tileLatitude(t, v));
    const p: V3 = [(X - camera.mx) * camera.K, -(Y - camera.my) * camera.K, groundZ];
    best = Math.max(best, effectiveZoom(camera, p));
  }
  return best;
}

function intersects(t: TileAddress, bounds: LngLatBoundsArray): boolean {
  const [w, s, e, n] = bounds;
  return !(tileLongitude(t, 1) <= w || tileLongitude(t, 0) >= e || tileLatitude(t, 0) <= s || tileLatitude(t, 1) >= n);
}

export interface MixedOptions {
  /** Most tiles returned, the nearest to the view's centre first. */
  limit: number;
  /** Never go finer than this zoom (used to show a coarser stage first). */
  maxZoom?: number;
}

export function selectMixedTiles(candidates: readonly TileAddress[], bounds: LngLatBoundsArray, view: View, options: MixedOptions): TileAddress[] {
  const camera = cameraModel(view);
  const exists = new Set(candidates.map(key));
  const zooms = [...new Set(candidates.map((t) => t.z))].sort((a, b) => a - b);
  if (zooms.length === 0) return [];
  const finest = Math.min(zooms[zooms.length - 1]!, options.maxZoom ?? Infinity);
  const leaves: TileAddress[] = [];

  const visit = (t: TileAddress): void => {
    const next = zooms.find((z) => z > t.z);
    if (next === undefined || next > finest || tileEffectiveZoom(t, camera, view.centreZ) < next) { leaves.push(t); return; }
    const k = 2 ** (next - t.z);
    const children: TileAddress[] = [];
    for (let dx = 0; dx < k; dx++) for (let dy = 0; dy < k; dy++) children.push({ z: next, x: t.x * k + dx, y: t.y * k + dy });
    if (!children.every((c) => exists.has(key(c)))) { leaves.push(t); return; }
    for (const c of children) if (intersects(c, bounds)) visit(c);
  };
  for (const t of candidates) if (t.z === zooms[0] && intersects(t, bounds)) visit(t);

  const [mx, my] = [camera.mx, camera.my];
  const centre = (t: TileAddress): number => {
    const [X, Y] = mercator(tileLongitude(t, 0.5), tileLatitude(t, 0.5));
    return (X - mx) ** 2 + (Y - my) ** 2;
  };
  return leaves.sort((a, b) => centre(a) - centre(b)).slice(0, options.limit);
}

export interface BudgetOptions {
  /** Most bytes the chosen tiles may add up to (known sizes where a tile was loaded before, else `priorBytes`). */
  maxBytes: number;
  /** Most splats (bytes / `bytesPerSplat`). */
  maxSplats: number;
  /** Bytes per splat of the tile format (Surfel Block v6: 12; v5: 16). Default 12. */
  bytesPerSplat?: number;
  /** The size of a tile when it is known (it was loaded before). */
  knownBytes?: (t: TileAddress) => number | undefined;
  /** A guess for a tile whose size is not known, by zoom. */
  priorBytes: (zoom: number) => number;
  /** Never go finer than this zoom (a coarser stage first). */
  maxZoom?: number;
}

/**
 * Detail by distance under a budget, covering the whole view (E024): start from the coarsest tiles that touch the view, so no
 * part of the screen is left empty, then replace a tile by its finer children where the camera deserves it (the same rule as
 * `selectMixedTiles`: the tile's nearest point is seen at a map zoom of at least the next zoom), the most deserving (nearest) first, as long
 * as the bytes and splats stay within the budget (children that do not exist are left out). A refinement that does not fit is skipped, and smaller ones are still tried. The
 * result is a partition (no tile covers another), nearest to the view centre first. If even the coarsest cover is over budget it is
 * returned as it is: coverage comes before the budget.
 */
export function selectBudgetedTiles(candidates: readonly TileAddress[], bounds: LngLatBoundsArray, view: View, options: BudgetOptions): TileAddress[] {
  const camera = cameraModel(view);
  const exists = new Set(candidates.map(key));
  const zooms = [...new Set(candidates.map((t) => t.z))].sort((a, b) => a - b);
  if (zooms.length === 0) return [];
  const finest = Math.min(zooms[zooms.length - 1]!, options.maxZoom ?? Infinity);
  const bytesPerSplat = options.bytesPerSplat ?? 12;
  const costOf = (t: TileAddress): number => options.knownBytes?.(t) ?? options.priorBytes(t.z);
  const limit = Math.min(options.maxBytes, options.maxSplats * bytesPerSplat);

  /**
   * The finer tiles that would replace `t` (those that exist and touch the view), when it may be refined at all. A child
   * that does not exist is left out: in a pyramid whose lower zooms are built from the finest tiles (build:tiled), a missing
   * child means no points there. (`selectMixedTiles` keeps the parent instead; with z13 and z14 tiles much larger than the
   * data, that rule never refined a view near the data's edge: E024 bug found on 2026-11-26.)
   */
  const childrenOf = (t: TileAddress): TileAddress[] | undefined => {
    const next = zooms.find((z) => z > t.z);
    if (next === undefined || next > finest) return undefined;
    const k = 2 ** (next - t.z);
    const present: TileAddress[] = [];
    for (let dx = 0; dx < k; dx++) for (let dy = 0; dy < k; dy++) {
      const c = { z: next, x: t.x * k + dx, y: t.y * k + dy };
      if (exists.has(key(c)) && intersects(c, bounds)) present.push(c);
    }
    return present.length > 0 ? present : undefined;
  };

  const leaves = new Map<string, TileAddress>();
  let used = 0;
  const open: Array<{ tile: TileAddress; eff: number }> = [];
  const add = (t: TileAddress): void => {
    leaves.set(key(t), t);
    used += costOf(t);
    const next = zooms.find((z) => z > t.z);
    if (next === undefined || next > finest) return;
    const eff = tileEffectiveZoom(t, camera, view.centreZ);
    if (eff >= next) open.push({ tile: t, eff });
  };
  for (const t of candidates) if (t.z === zooms[0] && intersects(t, bounds)) add(t);

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.eff > open[best]!.eff) best = i;
    const { tile } = open.splice(best, 1)[0]!;
    const children = childrenOf(tile);
    if (!children) continue;
    const delta = children.reduce((n, c) => n + costOf(c), 0) - costOf(tile);
    if (used + delta > limit) continue; // does not fit; a smaller refinement elsewhere may
    leaves.delete(key(tile));
    used -= costOf(tile);
    for (const c of children) add(c);
  }

  const [mx, my] = [camera.mx, camera.my];
  const centre = (t: TileAddress): number => {
    const [X, Y] = mercator(tileLongitude(t, 0.5), tileLatitude(t, 0.5));
    return (X - mx) ** 2 + (Y - my) ** 2;
  };
  return [...leaves.values()].sort((a, b) => centre(a) - centre(b));
}
