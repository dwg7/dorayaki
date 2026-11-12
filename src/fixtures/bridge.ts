import type { Surfel } from "../surfel-block.js";
import { samplePatch, type PatchAxis } from "./sampling.js";

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
 *              four vertical faces with outward normals ±x and ±y.
 *
 * Ground, underside, and deck get the same 1/16-of-tile x/y grid, so within
 * the deck footprint three surfels share each (x, y) with z = 0, 11 and
 * 12 m. Their positions are multiples of 1/32 (float32-exact). Pier faces
 * are subdivided more finely to fit their 11 m height.
 */

const N = 16;
const C = 1 / N;

export const BRIDGE_DECK_Z = 12;
export const BRIDGE_UNDERSIDE_Z = 11;
/** Grid rows (j index) covered by the deck: y in [6/16, 10/16]. */
export const BRIDGE_DECK_ROWS = [6, 7, 8, 9] as const;
const Y_RANGE = [6 / 16, 10 / 16] as const;
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

export function generateBridgeParts(options: BridgeOptions): BridgeParts {
  const w = options.tileWidthMetres;
  if (!Number.isFinite(w) || w <= 0) {
    throw new RangeError(`tileWidthMetres must be a positive finite number, got ${w}`);
  }
  const pitch = w * C;
  const X = (lo: number, hi: number): PatchAxis => ({ lo, hi, metresPerUnit: w });
  const Z = (lo: number, hi: number): PatchAxis => ({ lo, hi, metresPerUnit: 1 });
  const surfel = (
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    radius: number,
    [r, g, b, a]: Rgba,
  ): Surfel => ({ x, y, z, nx, ny, nz, radius, r, g, b, a });

  /** Horizontal patch at height z with normal ±z. */
  const horizontal = (x: PatchAxis, y: PatchAxis, z: number, nz: number, rgba: Rgba): Surfel[] => {
    const p = samplePatch(x, y, pitch);
    return p.v.flatMap((yy) => p.u.map((xx) => surfel(xx, yy, z, 0, 0, nz, p.radius, rgba)));
  };

  const deckY = Y_RANGE;
  const ground = horizontal(X(0, 1), X(0, 1), 0, 1, GROUND);
  const deck = horizontal(X(0, 1), X(deckY[0], deckY[1]), BRIDGE_DECK_Z, 1, DECK);
  const underside = horizontal(X(0, 1), X(deckY[0], deckY[1]), BRIDGE_UNDERSIDE_Z, -1, UNDERSIDE);

  const supports: Surfel[] = [];
  for (const [x0, x1, y0, y1] of BRIDGE_PIERS) {
    const xFaces = samplePatch(X(y0, y1), Z(0, BRIDGE_UNDERSIDE_Z), pitch); // faces at x0 and x1
    const yFaces = samplePatch(X(x0, x1), Z(0, BRIDGE_UNDERSIDE_Z), pitch); // faces at y0 and y1
    for (const z of xFaces.v) {
      for (const y of xFaces.u) {
        supports.push(surfel(x0, y, z, -1, 0, 0, xFaces.radius, SUPPORT));
        supports.push(surfel(x1, y, z, 1, 0, 0, xFaces.radius, SUPPORT));
      }
    }
    for (const z of yFaces.v) {
      for (const x of yFaces.u) {
        supports.push(surfel(x, y0, z, 0, -1, 0, yFaces.radius, SUPPORT));
        supports.push(surfel(x, y1, z, 0, 1, 0, yFaces.radius, SUPPORT));
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
