/**
 * The camera of a map view, as MapLibre builds it, in a metric frame (east, north, up in metres) whose origin is the
 * view centre on the ground at height 0 and whose scale is Mercator at the view's latitude. Shared by the software
 * renderer (cpu-render.ts) and the choice of tiles by distance (mixed-selection.ts). No DOM or WebGL here.
 */
import { EARTH_CIRCUMFERENCE_METRES } from "../../src/tile-geometry.js";

export interface View {
  lng: number;
  lat: number;
  /** MapLibre zoom (512-pixel tiles). */
  zoom: number;
  /** Degrees clockwise from north. */
  bearing: number;
  /** Degrees from straight down. */
  pitch: number;
  width: number;
  height: number;
  /** Height in metres of the point the camera looks at. */
  centreZ: number;
}

/** MapLibre's vertical field of view, radians. */
export const FOV = 0.6435011087932844;

export type V3 = [number, number, number];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const mercator = (lng: number, lat: number): [number, number] => {
  const x = (lng + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
};

export interface CameraModel {
  /** Metres per Mercator unit at the view's latitude. */
  K: number;
  /** Mercator coordinates of the view centre. */
  mx: number;
  my: number;
  /** Forward, right and up unit vectors (east, north, up). */
  f: V3;
  right: V3;
  up: V3;
  /** Camera position in the metric frame. */
  position: V3;
  /** Pixels per unit of x / depth. */
  pxPerUnit: number;
}

/**
 * Metres from the camera to the point it looks at (the map centre) for a MapLibre zoom, a canvas `heightPx` CSS pixels
 * tall, at latitude `lat`: the centre is drawn at 512 * 2^zoom pixels per Mercator unit, and the camera sits where the
 * vertical field of view spans the canvas height. The same relation cameraModel uses; `zoomForDistance` inverts it.
 */
export function distanceForZoom(zoom: number, heightPx: number, lat: number): number {
  const K = EARTH_CIRCUMFERENCE_METRES * Math.cos((lat * Math.PI) / 180);
  const ppm = (512 * 2 ** zoom) / K; // pixels per metre at the view centre
  return heightPx / 2 / Math.tan(FOV / 2) / ppm;
}

/** The MapLibre zoom that puts the camera `distance` metres from the point it looks at (the inverse of `distanceForZoom`). */
export function zoomForDistance(distance: number, heightPx: number, lat: number): number {
  const K = EARTH_CIRCUMFERENCE_METRES * Math.cos((lat * Math.PI) / 180);
  return Math.log2((heightPx / 2 / Math.tan(FOV / 2) / distance) * K / 512);
}

export function cameraModel(view: View): CameraModel {
  const K = EARTH_CIRCUMFERENCE_METRES * Math.cos((view.lat * Math.PI) / 180);
  const [mx, my] = mercator(view.lng, view.lat);
  const th = (view.bearing * Math.PI) / 180;
  const ph = (view.pitch * Math.PI) / 180;
  const f: V3 = [Math.sin(th) * Math.sin(ph), Math.cos(th) * Math.sin(ph), -Math.cos(ph)];
  const right: V3 = [Math.cos(th), -Math.sin(th), 0];
  const up: V3 = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const tanHalf = Math.tan(FOV / 2);
  const distance = distanceForZoom(view.zoom, view.height, view.lat);
  const position: V3 = [-f[0] * distance, -f[1] * distance, view.centreZ - f[2] * distance];
  return { K, mx, my, f, right, up, position, pxPerUnit: view.height / 2 / tanHalf };
}

/**
 * The map zoom at which a point (in the metric frame) would be drawn at the same scale as it is now: the view centre
 * gives the view's zoom, a point twice as far along the view direction gives one zoom less. Points at or behind the
 * camera give Infinity.
 */
export function effectiveZoom(camera: CameraModel, point: V3): number {
  const rel: V3 = [point[0] - camera.position[0], point[1] - camera.position[1], point[2] - camera.position[2]];
  const depth = dot(rel, camera.f);
  if (depth <= 0) return Infinity;
  return Math.log2((camera.pxPerUnit / depth) * camera.K / 512);
}

/**
 * The ground the view can see, as [west, south, east, north] in degrees: the screen's corners and the middle of its
 * top and bottom edges, cast onto the horizontal plane at the view's ground height. A ray that rises or meets the plane
 * beyond `maxDistance` metres is cut at that distance (a tilted view shows to the horizon, which has no bound).
 */
export function visibleBounds(view: View, maxDistance = 20000): [number, number, number, number] {
  const c = cameraModel(view);
  const lngs: number[] = [];
  const lats: number[] = [];
  const W = view.width, H = view.height;
  for (const [sx, sy] of [[0, 0], [W / 2, 0], [W, 0], [0, H], [W / 2, H], [W, H]] as const) {
    const kx = (sx - W / 2) / c.pxPerUnit;
    const ky = -(sy - H / 2) / c.pxPerUnit;
    const dir: V3 = [c.f[0] + kx * c.right[0] + ky * c.up[0], c.f[1] + kx * c.right[1] + ky * c.up[1], c.f[2] + kx * c.right[2] + ky * c.up[2]];
    let t = dir[2] < 0 ? (view.centreZ - c.position[2]) / dir[2] : Infinity;
    const horizontal = Math.hypot(dir[0], dir[1]);
    if (!(t * horizontal <= maxDistance)) t = maxDistance / Math.max(horizontal, 1e-9);
    const e = c.position[0] + t * dir[0];
    const n = c.position[1] + t * dir[1];
    const X = c.mx + e / c.K;
    const Y = c.my - n / c.K;
    lngs.push(X * 360 - 180);
    lats.push((Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180) / Math.PI);
  }
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}
