import type { Surfel } from "../surfel-block.js";

/**
 * Deterministic `bridge` fixture in the Surfel Block v2 frame:
 * x, y tile-local in [0, 1] (y south), z in metres (up), radius in metres.
 *
 * The footprint is defined in tile-local units and spans the whole tile;
 * heights are fixed in metres. Sampling pitch C = 1/16 of the tile, so the
 * pitch in metres is P = tileWidthMetres / 16.
 *
 * - ground:    z = 0 m, the full tile, 16 × 16 surfels, normal +z.
 * - deck:      z = 12 m, x in [0, 1], y in [6/16, 10/16], normal +z.
 * - underside: z = 11 m, same footprint as the deck, normal -z.
 * - supports:  two square piers with footprints
 *              x in [4/16, 6/16] and [10/16, 12/16], y in [7/16, 9/16],
 *              from z = 0 up to the underside at z = 11 m. Each pier has
 *              four vertical faces with outward normals ±x and ±y, sampled
 *              in max(1, ceil(11 m / P)) evenly spaced rows.
 *
 * Ground, underside, and deck share the same x/y grid, so within the deck
 * footprint three surfels share each (x, y) with z = 0, 11 and 12 m.
 *
 * Every surfel has radius P·√½ m (half the horizontal cell diagonal).
 * Tile-local coordinates are multiples of 1/32 and deck heights are whole
 * metres, so they are float32-exact. Radius and pier row heights are
 * rounded to float32 by the generator.
 */

const N = 16;
const C = 1 / N;

export const BRIDGE_DECK_Z = 12;
export const BRIDGE_UNDERSIDE_Z = 11;
/** Grid rows (j index) covered by the deck: y in [6/16, 10/16]. */
export const BRIDGE_DECK_ROWS = [6, 7, 8, 9] as const;
/** Pier footprints in tile-local units as [xMin, xMax, yMin, yMax]. */
export const BRIDGE_PIERS = [
  [4 / 16, 6 / 16, 7 / 16, 9 / 16],
  [10 / 16, 12 / 16, 7 / 16, 9 / 16],
] as const;

type Rgba = readonly [number, number, number, number];
const GROUND: Rgba = [96, 140, 72, 255];
const DECK: Rgba = [200, 200, 200, 255];
const UNDERSIDE: Rgba = [90, 90, 110, 255];
const SUPPORT: Rgba = [150, 110, 80, 255];

export interface BridgeOptions {
  /** Width in metres of the tile that will carry the bridge (see tileWidthMetres). */
  tileWidthMetres: number;
}

export interface BridgeParts {
  ground: Surfel[];
  deck: Surfel[];
  underside: Surfel[];
  supports: Surfel[];
}

/** Heights in metres of the pier sample rows for a given tile width. */
export function bridgePierRowHeights(tileWidthMetres: number): number[] {
  const pitch = tileWidthMetres * C;
  const rows = Math.max(1, Math.ceil(BRIDGE_UNDERSIDE_Z / pitch));
  return Array.from({ length: rows }, (_, k) => Math.fround((BRIDGE_UNDERSIDE_Z * (k + 0.5)) / rows));
}

const centre = (k: number): number => (k + 0.5) * C;

/** Sample centres in [lo, hi] at pitch C (tile-local). */
function centres(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let v = lo + C / 2; v < hi; v += C) out.push(v);
  return out;
}

export function generateBridgeParts(options: BridgeOptions): BridgeParts {
  const w = options.tileWidthMetres;
  if (!Number.isFinite(w) || w <= 0) {
    throw new RangeError(`tileWidthMetres must be a positive finite number, got ${w}`);
  }
  const radius = Math.fround(w * C * Math.SQRT1_2);
  const surfel = (
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    [r, g, b, a]: Rgba,
  ): Surfel => ({ x, y, z, nx, ny, nz, radius, r, g, b, a });

  const ground: Surfel[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      ground.push(surfel(centre(i), centre(j), 0, 0, 0, 1, GROUND));
    }
  }

  const deck: Surfel[] = [];
  const underside: Surfel[] = [];
  for (const j of BRIDGE_DECK_ROWS) {
    for (let i = 0; i < N; i++) {
      deck.push(surfel(centre(i), centre(j), BRIDGE_DECK_Z, 0, 0, 1, DECK));
      underside.push(surfel(centre(i), centre(j), BRIDGE_UNDERSIDE_Z, 0, 0, -1, UNDERSIDE));
    }
  }

  const supports: Surfel[] = [];
  const heights = bridgePierRowHeights(w);
  for (const [x0, x1, y0, y1] of BRIDGE_PIERS) {
    for (const z of heights) {
      for (const y of centres(y0, y1)) {
        supports.push(surfel(x0, y, z, -1, 0, 0, SUPPORT));
        supports.push(surfel(x1, y, z, 1, 0, 0, SUPPORT));
      }
      for (const x of centres(x0, x1)) {
        supports.push(surfel(x, y0, z, 0, -1, 0, SUPPORT));
        supports.push(surfel(x, y1, z, 0, 1, 0, SUPPORT));
      }
    }
  }

  return { ground, deck, underside, supports };
}

/** All bridge surfels in a fixed order: ground, deck, underside, supports. */
export function generateBridge(options: BridgeOptions): Surfel[] {
  const { ground, deck, underside, supports } = generateBridgeParts(options);
  return [...ground, ...deck, ...underside, ...supports];
}
