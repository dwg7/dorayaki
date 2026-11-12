import type { Surfel } from "../surfel-block.js";

/**
 * Deterministic `bridge` fixture.
 *
 * Same abstract local frame as `plane`: x and y cover the unit square,
 * z is up, and z uses the same unit as x and y. Every coordinate is a
 * multiple of 1/32, so all values are float32-exact.
 *
 * Geometry (C = 1/16 is the sampling pitch):
 *
 * - ground:    z = 0, the full unit square, 16 × 16 surfels, normal +z.
 * - deck:      z = 5/16, x in [0, 1], y in [6/16, 10/16], normal +z.
 * - underside: z = 4/16, same footprint as the deck, normal -z.
 * - supports:  two square piers with footprints
 *              x in [4/16, 6/16] and [10/16, 12/16], y in [7/16, 9/16],
 *              from z = 0 up to the underside at z = 4/16. Each pier has
 *              four vertical faces with outward normals ±x and ±y.
 *
 * Ground, underside, and deck surfels are sampled on the same x/y grid,
 * so within the deck footprint three surfels share each (x, y) with
 * z = 0, 4/16 and 5/16. Ground surfels inside pier footprints are kept.
 *
 * Every surfel has radius C·√½ (half the cell diagonal).
 */

const N = 16;
const C = 1 / N;
const RADIUS = Math.fround(C * Math.SQRT1_2);

export const BRIDGE_DECK_Z = 5 / 16;
export const BRIDGE_UNDERSIDE_Z = 4 / 16;
/** Grid rows (j index) covered by the deck: y in [6/16, 10/16]. */
export const BRIDGE_DECK_ROWS = [6, 7, 8, 9] as const;
/** Pier footprints as [xMin, xMax, yMin, yMax]. */
export const BRIDGE_PIERS = [
  [4 / 16, 6 / 16, 7 / 16, 9 / 16],
  [10 / 16, 12 / 16, 7 / 16, 9 / 16],
] as const;

type Rgba = readonly [number, number, number, number];
const GROUND: Rgba = [96, 140, 72, 255];
const DECK: Rgba = [200, 200, 200, 255];
const UNDERSIDE: Rgba = [90, 90, 110, 255];
const SUPPORT: Rgba = [150, 110, 80, 255];

export interface BridgeParts {
  ground: Surfel[];
  deck: Surfel[];
  underside: Surfel[];
  supports: Surfel[];
}

function surfel(
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  [r, g, b, a]: Rgba,
): Surfel {
  return { x, y, z, nx, ny, nz, radius: RADIUS, r, g, b, a };
}

const centre = (k: number): number => (k + 0.5) * C;

/** Sample centres in [lo, hi] at pitch C. */
function centres(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let v = lo + C / 2; v < hi; v += C) out.push(v);
  return out;
}

export function generateBridgeParts(): BridgeParts {
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
  const heights = centres(0, BRIDGE_UNDERSIDE_Z);
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
export function generateBridge(): Surfel[] {
  const { ground, deck, underside, supports } = generateBridgeParts();
  return [...ground, ...deck, ...underside, ...supports];
}
