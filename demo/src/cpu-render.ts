/**
 * A software renderer for measurement: draws splats of tiles from a given map
 * view into an RGB image with a depth buffer, in plain Node (no DOM, GL or
 * MapLibre). It is a proxy for the browser's custom layer, not a copy of it:
 * flat colour (no lighting, no opacity), the same camera model as MapLibre
 * (vertical field of view 36.87 degrees, 512-pixel tiles, bearing, pitch) and
 * the same placement (documents/surfel-block-format.md). Used to compare two
 * tile sets as seen from fixed cameras (EXPERIMENTS.md E012).
 *
 * World frame: east, north, up in metres, with Mercator scale fixed at the
 * view's latitude. A splat's tile-local x, y are fractions of the tile; its
 * axes are in metres (see splat-instances.ts).
 */
import { EARTH_CIRCUMFERENCE_METRES, type TileAddress } from "../../src/tile-geometry.js";
import type { SplatInstances } from "./splat-instances.js";

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

export interface TileInstances {
  tile: TileAddress;
  instances: SplatInstances;
}

export interface Image {
  width: number;
  height: number;
  /** r, g, b per pixel. */
  rgb: Uint8Array;
  /** Distance along the view direction in metres; Infinity where nothing was drawn. */
  depth: Float32Array;
}

/** MapLibre's vertical field of view, radians. */
export const FOV = 0.6435011087932844;

const mercator = (lng: number, lat: number): [number, number] => {
  const x = (lng + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
};

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function renderTiles(tiles: readonly TileInstances[], view: View): Image {
  const { width: W, height: H } = view;
  const image: Image = { width: W, height: H, rgb: new Uint8Array(W * H * 3), depth: new Float32Array(W * H).fill(Infinity) };

  const K = EARTH_CIRCUMFERENCE_METRES * Math.cos((view.lat * Math.PI) / 180); // metres per Mercator unit
  const [mx, my] = mercator(view.lng, view.lat);
  const th = (view.bearing * Math.PI) / 180;
  const ph = (view.pitch * Math.PI) / 180;
  const f: V3 = [Math.sin(th) * Math.sin(ph), Math.cos(th) * Math.sin(ph), -Math.cos(ph)];
  const right: V3 = [Math.cos(th), -Math.sin(th), 0];
  const up: V3 = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const tanHalf = Math.tan(FOV / 2);
  const ppm = (512 * 2 ** view.zoom) / K; // pixels per metre at the view centre
  const distance = H / 2 / tanHalf / ppm;
  // The view centre is (0, 0, centreZ); the camera sits `distance` behind it.
  const camAbs: V3 = [-f[0] * distance, -f[1] * distance, view.centreZ - f[2] * distance];
  const pxPerUnit = H / 2 / tanHalf; // pixels at depth 1

  for (const { tile, instances: s } of tiles) {
    const n = 2 ** tile.z;
    for (let i = 0; i < s.count; i++) {
      // Centre in the view's metric frame (east, north, up), origin at the view centre on the ground.
      const c: V3 = [
        ((tile.x + s.position[i * 3]!) / n - mx) * K,
        -((tile.y + s.position[i * 3 + 1]!) / n - my) * K,
        s.position[i * 3 + 2]!,
      ];
      const rel: V3 = [c[0] - camAbs[0], c[1] - camAbs[1], c[2] - camAbs[2]];
      const depth = dot(rel, f);
      if (depth < 1) continue;

      let u: V3, v: V3, nrm: V3;
      if (s.round[i] === 1) {
        const r = Math.hypot(s.axisU[i * 3]!, s.axisU[i * 3 + 1]!, s.axisU[i * 3 + 2]!);
        u = [right[0] * r, right[1] * r, right[2] * r];
        v = [up[0] * r, up[1] * r, up[2] * r];
        nrm = f;
      } else {
        // Tile frame is (east, south, up): flip y to north.
        u = [s.axisU[i * 3]!, -s.axisU[i * 3 + 1]!, s.axisU[i * 3 + 2]!];
        v = [s.axisV[i * 3]!, -s.axisV[i * 3 + 1]!, s.axisV[i * 3 + 2]!];
        nrm = [s.normal[i * 3]!, -s.normal[i * 3 + 1]!, s.normal[i * 3 + 2]!];
      }

      // Screen bounding box of the parallelogram c +- u +- v.
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
      for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const p: V3 = [rel[0] + su * u[0] + sv * v[0], rel[1] + su * u[1] + sv * v[1], rel[2] + su * u[2] + sv * v[2]];
        const d = dot(p, f);
        if (d < 0.5) { behind = true; break; }
        const sx = W / 2 + (dot(p, right) / d) * pxPerUnit;
        const sy = H / 2 - (dot(p, up) / d) * pxPerUnit;
        if (sx < x0) x0 = sx;
        if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy;
        if (sy > y1) y1 = sy;
      }
      if (behind || x1 < 0 || y1 < 0 || x0 >= W || y0 >= H) continue;
      const ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(W - 1, Math.floor(x1));
      const iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(H - 1, Math.floor(y1));
      const uu = dot(u, u), vv = dot(v, v);
      if (uu === 0 || vv === 0) continue;
      const planeD = dot(rel, nrm);
      const cr = s.colour[i * 4]!, cg = s.colour[i * 4 + 1]!, cb = s.colour[i * 4 + 2]!;

      for (let py = iy0; py <= iy1; py++) {
        const ky = -((py + 0.5 - H / 2) / pxPerUnit);
        for (let px = ix0; px <= ix1; px++) {
          const kx = (px + 0.5 - W / 2) / pxPerUnit;
          // Ray from the camera: f + kx * right + ky * up (depth along f is t).
          const dir: V3 = [f[0] + kx * right[0] + ky * up[0], f[1] + kx * right[1] + ky * up[1], f[2] + kx * right[2] + ky * up[2]];
          const denom = dot(dir, nrm);
          if (Math.abs(denom) < 1e-9) continue;
          const t = planeD / denom;
          if (t <= 0 || t >= image.depth[py * W + px]!) continue;
          const q: V3 = [t * dir[0] - rel[0], t * dir[1] - rel[1], t * dir[2] - rel[2]];
          const a = dot(q, u) / uu;
          const b = dot(q, v) / vv;
          if (a * a + b * b > 1) continue;
          const o = py * W + px;
          image.depth[o] = t;
          image.rgb[o * 3] = cr;
          image.rgb[o * 3 + 1] = cg;
          image.rgb[o * 3 + 2] = cb;
        }
      }
    }
  }
  return image;
}
