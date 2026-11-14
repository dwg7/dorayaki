/**
 * External tilesets described by TileJSON: a local tilejson.json written by
 * `npm run demo:numazu`, or a server such as Martin on stars.optgeo.org that
 * serves a PMTiles archive as z/x/y. Tile selection here is static: every
 * tile covering the bounds at every zoom from minzoom to maxzoom (selection
 * by viewport is not implemented), capped to stay small.
 */
import { tileLatitude, tileLongitude, type TileAddress } from "../../src/tile-geometry.js";

export interface TileSource {
  /** Tile URL template with {z}, {x}, {y}, already absolute. */
  template: string;
  tiles: TileAddress[];
  center: [number, number];
  attribution: string;
}

/** Upper bound on tiles fetched from one TileJSON (no viewport selection yet). */
export const MAX_TILES = 64;

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
  const n = 2 ** z;
  const fx = (lng: number) => ((lng + 180) / 360) * n;
  const fy = (lat: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v));
  const [w, s, e, nth] = bounds;
  const x0 = clamp(Math.floor(fx(w))), x1 = clamp(Math.max(x0, Math.ceil(fx(e) - 1e-9) - 1));
  const y0 = clamp(Math.floor(fy(nth))), y1 = clamp(Math.max(y0, Math.ceil(fy(s) - 1e-9) - 1));
  const out: TileAddress[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ z, x: tx, y: ty });
  return out;
}

export function tileUrl(template: string, t: TileAddress): string {
  return template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
}

/** Read a TileJSON and list the tiles to fetch. `baseUrl` resolves a relative `url` (the page's base URI). */
export async function loadTileJson(url: string, baseUrl: string): Promise<TileSource> {
  const base = new URL(url, baseUrl);
  const response = await fetch(base);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  const tj = (await response.json()) as TileJson;
  const template = tj.tiles?.[0];
  if (!template || !tj.bounds || tj.minzoom === undefined || tj.maxzoom === undefined) {
    throw new Error(`${url}: TileJSON needs tiles, bounds, minzoom and maxzoom`);
  }
  const tiles: TileAddress[] = [];
  for (let z = tj.minzoom; z <= tj.maxzoom; z++) tiles.push(...tilesCovering(tj.bounds, z));
  if (tiles.length > MAX_TILES) throw new Error(`${url}: ${tiles.length} tiles exceed the demo's limit of ${MAX_TILES}`);
  const [w, s, e, n] = tj.bounds;
  const first = tiles[0]!;
  return {
    // Placeholders are kept literally by URL(); resolve relative templates against the TileJSON URL.
    template: decodeURI(new URL(template, base).href),
    tiles,
    center: tj.center && tj.center.length >= 2 ? [tj.center[0]!, tj.center[1]!] : [(w + e) / 2 || tileLongitude(first, 0.5), (s + n) / 2 || tileLatitude(first, 0.5)],
    attribution: tj.attribution ?? "",
  };
}
