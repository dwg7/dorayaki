/**
 * How far to raise the splats, in metres, at a map zoom, so that MapLibre's terrain does not cover them.
 *
 * MapLibre builds the terrain from DEM tiles of about the map's zoom, so at low zoom the terrain is a smoothed
 * version of the ground and lies above it in places, hiding the splats there (white holes in the data). Measured on
 * the Kawazu area (64 points, terrain at the zoom minus terrain at zoom 16.6, after the fixed 2 m lowering of the
 * DEM): zoom 14.5: -2.3 to +2.7 m; zoom 12.7: -11.7 to +13.7 m (NOTES.md). The lift is linear in the zoom below 15,
 * capped at `MAX_LIFT`. The slope and cap are first guesses to be tuned by looking (NOTES.md has what was tried);
 * another region needs its own measurement.
 */
export const LIFT_PER_ZOOM = 9;
export const FULL_DETAIL_ZOOM = 15;
export const MAX_LIFT = 40;

export function terrainLift(zoom: number): number {
  if (!(zoom < FULL_DETAIL_ZOOM)) return 0;
  return Math.min(MAX_LIFT, (FULL_DETAIL_ZOOM - zoom) * LIFT_PER_ZOOM);
}
