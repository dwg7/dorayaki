/**
 * Which tiles a tileset may have, asked for one view at a time (D25, 2026-11-28): the viewer reads tiles as an ordinary web map does,
 * from the TileJSON's bounds and zoom range, instead of listing every tile of the archive first (that list was capped at 4,096 tiles,
 * D10, and a prefecture would have far more). A tile inside the bounds is assumed to exist until the server answers 204 or 404; then
 * it is remembered as missing, and the selection treats it as a missing child (no points there). The synthetic fixtures, whose tiles
 * are known, keep an exact list. No DOM here.
 */
import { tileLatitude, tileLongitude, type TileAddress } from "../../src/tile-geometry.js";
import type { LngLatBoundsArray } from "./tile-view.js";

export interface TileIndex {
  /** The zooms that may have tiles, ascending. */
  readonly zooms: readonly number[];
  /** Whether the tile may exist. */
  has(t: TileAddress): boolean;
  /** The tiles of zoom `z` that may exist and intersect `bounds` (edges exclusive). */
  within(bounds: LngLatBoundsArray, z: number): TileAddress[];
}

const key = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;

function intersects(t: TileAddress, [w, s, e, n]: LngLatBoundsArray): boolean {
  return !(tileLongitude(t, 1) <= w || tileLongitude(t, 0) >= e || tileLatitude(t, 0) <= s || tileLatitude(t, 1) >= n);
}

/** An exact list (the synthetic fixtures, the tools that read a tile directory). */
export function listIndex(tiles: readonly TileAddress[]): TileIndex {
  const keys = new Set(tiles.map(key));
  const byZoom = new Map<number, TileAddress[]>();
  for (const t of tiles) {
    const l = byZoom.get(t.z);
    if (l) l.push(t); else byZoom.set(t.z, [t]);
  }
  return {
    zooms: [...byZoom.keys()].sort((a, b) => a - b),
    has: (t) => keys.has(key(t)),
    within: (bounds, z) => (byZoom.get(z) ?? []).filter((t) => intersects(t, bounds)),
  };
}

/** The x and y ranges (inclusive) of the tiles of zoom z intersecting bounds; east and south edges exclusive. */
export function coverRange(bounds: LngLatBoundsArray, z: number): { x0: number; x1: number; y0: number; y1: number } {
  const n = 2 ** z;
  const fx = (lng: number) => ((lng + 180) / 360) * n;
  const fy = (lat: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v));
  const [w, s, e, nth] = bounds;
  const x0 = clamp(Math.floor(fx(w))), x1 = clamp(Math.max(x0, Math.ceil(fx(e) - 1e-9) - 1));
  const y0 = clamp(Math.floor(fy(nth))), y1 = clamp(Math.max(y0, Math.ceil(fy(s) - 1e-9) - 1));
  return { x0, x1, y0, y1 };
}

/** A guard on one call of `within`: a view should never ask for more tiles of one zoom than this (a bug, not a tileset size). */
export const MAX_WITHIN = 65536;

export interface BoundsIndex extends TileIndex {
  /** Remember that the server has no such tile (it answered 204 or 404). */
  markMissing(t: TileAddress): void;
  /** Tiles remembered as missing. */
  readonly missing: number;
}

/** Every tile of the bounds at minzoom..maxzoom may exist, except those the server has said are missing. */
export function boundsIndex(bounds: LngLatBoundsArray, minzoom: number, maxzoom: number): BoundsIndex {
  const missing = new Set<string>();
  const zooms: number[] = [];
  for (let z = minzoom; z <= maxzoom; z++) zooms.push(z);
  const inZoom = (z: number): boolean => z >= minzoom && z <= maxzoom;
  return {
    zooms,
    has: (t) => {
      if (!inZoom(t.z) || missing.has(key(t))) return false;
      const r = coverRange(bounds, t.z);
      return t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1;
    },
    within: (view, z) => {
      if (!inZoom(z)) return [];
      const [w, s, e, n] = view;
      const cut: LngLatBoundsArray = [Math.max(w, bounds[0]), Math.max(s, bounds[1]), Math.min(e, bounds[2]), Math.min(n, bounds[3])];
      if (cut[0] >= cut[2] || cut[1] >= cut[3]) return [];
      const r = coverRange(cut, z);
      const count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
      if (count > MAX_WITHIN) throw new Error(`${count} tiles of z${z} in one view exceed ${MAX_WITHIN}`);
      const out: TileAddress[] = [];
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (!missing.has(`${z}/${x}/${y}`)) out.push({ z, x, y });
      return out;
    },
    markMissing: (t) => { missing.add(key(t)); },
    get missing() { return missing.size; },
  };
}

/** An index for either form: a list becomes an exact index. */
export const asIndex = (x: TileIndex | readonly TileAddress[]): TileIndex => (Array.isArray(x) ? listIndex(x as readonly TileAddress[]) : (x as TileIndex));
