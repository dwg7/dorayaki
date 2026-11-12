/**
 * Tile geometry on the spherical Web Mercator Earth.
 *
 * Used to relate tile-local x, y to the metric z and radius of Surfel
 * Block version 2 (docs/surfel-block-format.md). No MapLibre dependency.
 */

/** Spherical Web Mercator Earth radius (EPSG:3857), metres. */
export const EARTH_RADIUS_METRES = 6378137;
export const EARTH_CIRCUMFERENCE_METRES = 2 * Math.PI * EARTH_RADIUS_METRES;

export interface TileAddress {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** Latitude in degrees of tile-local y (0 = north edge, 1 = south edge). */
export function tileLatitude(t: TileAddress, localY: number): number {
  const n = Math.PI * (1 - (2 * (t.y + localY)) / 2 ** t.z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Longitude in degrees of tile-local x (0 = west edge, 1 = east edge). */
export function tileLongitude(t: TileAddress, localX: number): number {
  return ((t.x + localX) / 2 ** t.z) * 360 - 180;
}

/**
 * Tile width in metres, evaluated at the tile's centre latitude.
 * This is the scale used to convert tile-local x, y to metres.
 */
export function tileWidthMetres(t: TileAddress): number {
  const lat = (tileLatitude(t, 0.5) * Math.PI) / 180;
  return (EARTH_CIRCUMFERENCE_METRES * Math.cos(lat)) / 2 ** t.z;
}
