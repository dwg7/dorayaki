/**
 * The frame of a map tile for points given in a Japan plane rectangular zone (E022, documents/build.md).
 *
 * A point of a survey is (easting, northing) in a plane rectangular zone. To build the splats of one tile on a voxel grid that lines up
 * with the tile's edges, the point is expressed in the frame of the tile it falls in: metres east and south of the tile's north-west
 * corner. The conversion from plane coordinates to Web Mercator tile units is exact in `src/geodesy/jprcs.ts` (the inverse Gauss-Kruger
 * series) and in `src/tile-geometry.ts`, but too slow for every point of hundreds of millions, so each tile gets an affine map fitted to
 * the exact conversion near its centre (central differences 50 m apart): over a tile of a few hundred metres its error is millimetres, and
 * the frame follows the grid convergence, which a flat east/north frame around a mesh centre does not (that frame put neighbouring meshes
 * up to 1.8 m apart).
 *
 * Everything is deterministic: the frame of a tile depends only on the tile (it is anchored at the plane point that the exact
 * conversion maps to the tile's centre, found by a fixed number of Newton steps from a fixed start), so independent processes agree on the
 * frame of every tile whatever points they saw first. No DOM, Node or MapLibre dependency.
 */
import { jprcsToLatLng, JPRCS_ORIGINS } from "./jprcs.js";
import { tileWidthMetres } from "../tile-geometry.js";

const DEG = Math.PI / 180;
/** Metres per radian of a sphere of the Earth's mean radius: only for the start of a Newton search. */
const R_MEAN = 6371000;

/** Web Mercator tile units (x east, y south; integers are tile corners) of a latitude and longitude at a zoom. */
export function tileUnits(lat: number, lng: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  return [((lng + 180) / 360) * n, ((1 - Math.asinh(Math.tan(lat * DEG)) / Math.PI) / 2) * n];
}

/** Tile units of a plane rectangular point (easting e, northing n, metres), by the exact conversion. */
export function exactTileUnits(zone: number, zoom: number, e: number, n: number): [number, number] {
  const g = jprcsToLatLng(zone, n, e); // the conversion takes the survey convention: x northing, y easting
  return tileUnits(g.lat, g.lng, zoom);
}

/** An affine map from plane coordinates to tile units: u = u0 + ue (e - e0) + un (n - n0), v = v0 + ve (e - e0) + vn (n - n0). */
export interface AffineFrame {
  e0: number;
  n0: number;
  u0: number;
  v0: number;
  ue: number;
  un: number;
  ve: number;
  vn: number;
}

/** Fit the affine map at a plane point: the exact conversion at the point and central differences `h` metres either side. */
export function fitAffine(zone: number, zoom: number, e0: number, n0: number, h = 50): AffineFrame {
  const [u0, v0] = exactTileUnits(zone, zoom, e0, n0);
  const [ua, va] = exactTileUnits(zone, zoom, e0 + h, n0), [ub, vb] = exactTileUnits(zone, zoom, e0 - h, n0);
  const [uc, vc] = exactTileUnits(zone, zoom, e0, n0 + h), [ud, vd] = exactTileUnits(zone, zoom, e0, n0 - h);
  return { e0, n0, u0, v0, ue: (ua - ub) / (2 * h), ve: (va - vb) / (2 * h), un: (uc - ud) / (2 * h), vn: (vc - vd) / (2 * h) };
}

export function applyAffine(f: AffineFrame, e: number, n: number): [number, number] {
  const de = e - f.e0, dn = n - f.n0;
  return [f.u0 + f.ue * de + f.un * dn, f.v0 + f.ve * de + f.vn * dn];
}

/**
 * The plane point whose exact conversion is the tile unit position (u, v): six Newton steps (the Jacobian is the fitted affine map) from
 * a start taken on a sphere around the zone's origin. Deterministic, and converged to far better than a millimetre.
 */
export function planePointOfTileUnits(zone: number, zoom: number, u: number, v: number): [number, number] {
  const origin = JPRCS_ORIGINS[zone];
  if (!origin) throw new RangeError(`unknown plane rectangular zone ${zone}`);
  const n = 2 ** zoom;
  const lng = (u / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI;
  let e = (lng - origin[1]) * DEG * R_MEAN * Math.cos(lat * DEG);
  let nn = (lat - origin[0]) * DEG * R_MEAN;
  for (let i = 0; i < 6; i++) {
    const f = fitAffine(zone, zoom, e, nn);
    const du = u - f.u0, dv = v - f.v0;
    const det = f.ue * f.vn - f.un * f.ve;
    e = f.e0 + (du * f.vn - dv * f.un) / det;
    nn = f.n0 + (dv * f.ue - du * f.ve) / det;
  }
  return [e, nn];
}

/** The frame of one tile: its address, its width in metres at its centre latitude, and the affine map anchored near its centre. */
export interface TileFrame {
  zoom: number;
  x: number;
  y: number;
  /** Metres per tile unit (tileWidthMetres): the tile-local metres of a point are (u - x) and (v - y) times this. */
  widthMetres: number;
  affine: AffineFrame;
}

/** Where a plane point falls. */
export interface TileLocation {
  x: number;
  y: number;
  /** Metres east of the tile's north-west corner, in [0, widthMetres). */
  east: number;
  /** Metres south of the tile's north-west corner, in [0, widthMetres). */
  south: number;
  widthMetres: number;
  /** True when the point was still outside its tile after stepping to neighbours (the frames of neighbours differ by millimetres at an edge) and was clamped into the last tile. */
  clamped: boolean;
}

/** The largest value below the tile width that a clamped coordinate takes: half a micrometre inside the edge. */
const INSIDE = 5e-7;

export class TileFramer {
  private readonly coarse = new Map<string, AffineFrame>();
  private readonly tiles = new Map<string, TileFrame>();

  /**
   * @param zone plane rectangular zone (1 to 19)
   * @param zoom the zoom of the tiles
   * @param coarseMetres side of the plane-coordinate cells that carry the coarse frames used to choose a tile (default 1000)
   */
  constructor(readonly zone: number, readonly zoom: number, private readonly coarseMetres = 1000) {
    if (!JPRCS_ORIGINS[zone]) throw new RangeError(`unknown plane rectangular zone ${zone}`);
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 24) throw new RangeError(`zoom ${zoom} outside 0..24`);
  }

  /** The coarse frame of the plane cell a point is in, anchored at the cell's centre. */
  private coarseFrame(e: number, n: number): AffineFrame {
    const ci = Math.floor(e / this.coarseMetres), cj = Math.floor(n / this.coarseMetres);
    const key = `${ci},${cj}`;
    let f = this.coarse.get(key);
    if (!f) this.coarse.set(key, (f = fitAffine(this.zone, this.zoom, (ci + 0.5) * this.coarseMetres, (cj + 0.5) * this.coarseMetres)));
    return f;
  }

  /** The frame of a tile (cached): the affine map anchored at the plane point of the tile's centre. */
  protected tileFrame(x: number, y: number): TileFrame {
    const key = `${x},${y}`;
    let t = this.tiles.get(key);
    if (!t) {
      const [e, n] = planePointOfTileUnits(this.zone, this.zoom, x + 0.5, y + 0.5);
      t = { zoom: this.zoom, x, y, widthMetres: tileWidthMetres({ z: this.zoom, x, y }), affine: fitAffine(this.zone, this.zoom, e, n) };
      this.tiles.set(key, t);
    }
    return t;
  }

  /** The frame of a tile, for callers that want it (for example to place splats of that tile). */
  frameOf(x: number, y: number): TileFrame {
    return this.tileFrame(x, y);
  }

  /**
   * The tile of a plane point and its position in the tile's frame. The tile is chosen with the coarse frame and then confirmed in the
   * tile's own frame; a point that falls outside it there steps to the neighbour it falls in, at most three times, and is then clamped
   * into the last tile (`clamped`), so that every point is assigned to exactly one tile.
   */
  locate(e: number, n: number): TileLocation {
    const [uc, vc] = applyAffine(this.coarseFrame(e, n), e, n);
    let x = Math.floor(uc), y = Math.floor(vc);
    let frame = this.tileFrame(x, y);
    let [u, v] = applyAffine(frame.affine, e, n);
    for (let step = 0; step < 3 && (u < x || u >= x + 1 || v < y || v >= y + 1); step++) {
      x = Math.floor(u); y = Math.floor(v);
      frame = this.tileFrame(x, y);
      [u, v] = applyAffine(frame.affine, e, n);
    }
    const w = frame.widthMetres;
    let east = (u - x) * w, south = (v - y) * w;
    const clamped = east < 0 || east >= w || south < 0 || south >= w;
    if (clamped) {
      east = Math.min(Math.max(east, 0), w - INSIDE);
      south = Math.min(Math.max(south, 0), w - INSIDE);
    }
    return { x, y, east, south, widthMetres: w, clamped };
  }
}
