/**
 * Which tiles of one zoom to load for a view: those that intersect the view's
 * bounds, nearest to its centre first, at most `limit`. No DOM, network or WebGL.
 *
 * `centre` is the point the nearness is measured from: the point the map is looking at. Without it the centre of the
 * bounds is used, which is wrong for a tilted view (the bounds run out towards the horizon, so their centre lies on
 * the far side and the tiles under the camera are the ones dropped by `limit`).
 */
import { tileLatitude, tileLongitude, type TileAddress } from "../../src/tile-geometry.js";

/** [west, south, east, north] in degrees. */
export type LngLatBoundsArray = readonly [number, number, number, number];

/** [longitude, latitude] in degrees. */
export type LngLatArray = readonly [number, number];

export function viewTiles(candidates: readonly TileAddress[], zoom: number, bounds: LngLatBoundsArray, limit: number, centre?: LngLatArray): TileAddress[] {
  const [w, s, e, n] = bounds;
  const cx = centre ? centre[0] : (w + e) / 2, cy = centre ? centre[1] : (s + n) / 2;
  const scored: Array<{ tile: TileAddress; d: number }> = [];
  for (const t of candidates) {
    if (t.z !== zoom) continue;
    const tw = tileLongitude(t, 0), te = tileLongitude(t, 1), tn = tileLatitude(t, 0), ts = tileLatitude(t, 1);
    if (te <= w || tw >= e || tn <= s || ts >= n) continue; // no overlap (edges are exclusive)
    scored.push({ tile: t, d: ((tw + te) / 2 - cx) ** 2 + ((tn + ts) / 2 - cy) ** 2 });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, limit).map((x) => x.tile);
}
