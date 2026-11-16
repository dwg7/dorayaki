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
