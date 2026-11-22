/**
 * Keeps the camera a minimum height above the ground under it. No DOM or WebGL here.
 *
 * With terrain on, panning toward higher ground at a high pitch brings the camera to within a metre of the slope
 * (measured with MapLibre GL JS 6.16.0 on the Kawazu data: 30 m, 6.7 m, 0.6 m in three 10 m steps at zoom 20, pitch 78).
 * MapLibre then lowers the pitch itself, but leaves almost no clearance, and the terrain and the near plane hide the
 * splats in front of the camera (NOTES.md). This lowers the pitch, around the same center, just until the camera is
 * `minClearance` metres above the ground under it. It is a workaround in the demo, not a change to MapLibre.
 */

/** The map view this needs, with the ground height at the center already looked up. */
export interface ClearanceView {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  /** Canvas height in CSS pixels. */
  heightPx: number;
  /** Ground height at the center, metres. */
  centreElevation: number;
}

/** MapLibre's vertical field of view in radians (36.87 degrees). */
const FOV = 0.6435011087932844;
const EARTH_CIRCUMFERENCE = 40075016.686;
const METRES_PER_DEGREE = 111320;
const TILE_SIZE = 512;

/** Where the camera is for `view`: longitude, latitude and height above sea level in metres. */
export function cameraPosition(view: ClearanceView): { lng: number; lat: number; altitude: number } {
  const pitch = (view.pitch * Math.PI) / 180;
  const bearing = (view.bearing * Math.PI) / 180;
  const distancePx = 0.5 / Math.tan(FOV / 2) * view.heightPx;
  const pixelsPerMetre = (TILE_SIZE * 2 ** view.zoom) / (EARTH_CIRCUMFERENCE * Math.cos((view.lat * Math.PI) / 180));
  const up = (distancePx * Math.cos(pitch)) / pixelsPerMetre;
  const back = (distancePx * Math.sin(pitch)) / pixelsPerMetre;
  return {
    lng: view.lng - (Math.sin(bearing) * back) / (METRES_PER_DEGREE * Math.cos((view.lat * Math.PI) / 180)),
    lat: view.lat - (Math.cos(bearing) * back) / METRES_PER_DEGREE,
    altitude: view.centreElevation + up,
  };
}

/**
 * The pitch to use: the view's own when the camera is at least `minClearance` metres above `groundAt` there, otherwise
 * the largest lower pitch that keeps that clearance (0 when none does). `groundAt` returns null where the ground is unknown.
 */
export function pitchForClearance(
  view: ClearanceView,
  groundAt: (lng: number, lat: number) => number | null,
  minClearance: number,
): number {
  const clearance = (pitch: number): number => {
    const c = cameraPosition({ ...view, pitch });
    const ground = groundAt(c.lng, c.lat);
    return ground === null ? Infinity : c.altitude - ground;
  };
  if (clearance(view.pitch) >= minClearance) return view.pitch;
  if (clearance(0) < minClearance) return 0;
  let ok = 0;
  let bad = view.pitch;
  for (let i = 0; i < 20; i++) {
    const mid = (ok + bad) / 2;
    if (clearance(mid) >= minClearance) ok = mid;
    else bad = mid;
  }
  return ok;
}

/** The part of a MapLibre map this needs. */
export interface ClearanceMap {
  on(type: "move", listener: () => void): unknown;
  off(type: "move", listener: () => void): unknown;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getPitch(): number;
  getBearing(): number;
  getCanvas(): { clientHeight: number };
  getCenterElevation(): number;
  queryTerrainElevation(lngLat: { lng: number; lat: number }): number | null | undefined;
  setPitch(pitch: number): unknown;
}

/** Starts keeping the camera `minClearance` metres above the ground on `map`; returns a function that stops it. */
export function keepCameraClearance(map: ClearanceMap, minClearance: number): () => void {
  let working = false;
  const onMove = (): void => {
    if (working) return;
    const c = map.getCenter();
    const view: ClearanceView = {
      lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
      heightPx: map.getCanvas().clientHeight, centreElevation: map.getCenterElevation(),
    };
    const pitch = pitchForClearance(view, (lng, lat) => map.queryTerrainElevation({ lng, lat }) ?? null, minClearance);
    if (pitch >= view.pitch - 1e-6) return;
    working = true;
    try {
      map.setPitch(pitch);
    } finally {
      working = false;
    }
  };
  map.on("move", onMove);
  return () => map.off("move", onMove);
}
