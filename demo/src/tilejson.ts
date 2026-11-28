/**
 * External tilesets described by TileJSON: a local tilejson.json written by `build:tiled`, or a server such as Martin on
 * stars.optgeo.org that serves a PMTiles archive as z/x/y. Since D25 (2026-11-28) nothing is listed up front: the bounds and the zoom
 * range become a tile index (tile-index.ts) that answers one view at a time, as an ordinary web map reads its tiles; the former list of
 * every tile was capped at 4,096 (D10), which a prefecture exceeds.
 */
import type { TileAddress } from "../../src/tile-geometry.js";
import { boundsIndex, coverRange, type BoundsIndex } from "./tile-index.js";

export interface TileSource {
  /** Tile URL template with {z}, {x}, {y}, already absolute. */
  template: string;
  /** The tiles that may exist, by view (a tile the server answers 204 or 404 for is then marked missing). */
  index: BoundsIndex;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  center: [number, number];
  attribution: string;
}

interface TileJson {
  tiles?: string[];
  bounds?: [number, number, number, number];
  minzoom?: number;
  maxzoom?: number;
  center?: number[];
  attribution?: string;
}

/**
 * Tiles of zoom z whose extent intersects [west, south, east, north]. The
 * east and south edges are exclusive, so bounds that end exactly on a tile
 * edge (as a tile pyramid's own bounds do) do not pull in the next tile.
 */
export function tilesCovering(bounds: readonly [number, number, number, number], z: number): TileAddress[] {
  const { x0, x1, y0, y1 } = coverRange(bounds, z);
  const out: TileAddress[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ z, x: tx, y: ty });
  return out;
}


export function tileUrl(template: string, t: TileAddress): string {
  return template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
}

/** Read a TileJSON into a tile source (no tile is listed). `baseUrl` resolves a relative `url` (the page's base URI). */
export async function loadTileJson(url: string, baseUrl: string): Promise<TileSource> {
  const base = new URL(url, baseUrl);
  const response = await fetch(base);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  const tj = (await response.json()) as TileJson;
  const template = tj.tiles?.[0];
  if (!template || !tj.bounds || tj.minzoom === undefined || tj.maxzoom === undefined) {
    throw new Error(`${url}: TileJSON needs tiles, bounds, minzoom and maxzoom`);
  }
  const [w, s, e, n] = tj.bounds;
  return {
    // Placeholders are kept literally by URL(); resolve relative templates against the TileJSON URL.
    template: decodeURI(new URL(template, base).href),
    index: boundsIndex(tj.bounds, tj.minzoom, tj.maxzoom),
    bounds: [w, s, e, n],
    minzoom: tj.minzoom,
    maxzoom: tj.maxzoom,
    center: tj.center && tj.center.length >= 2 ? [tj.center[0]!, tj.center[1]!] : [(w + e) / 2, (s + n) / 2],
    attribution: tj.attribution ?? "",
  };
}
