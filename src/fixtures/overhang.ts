import type { Surfel } from "../surfel-block.js";

/**
 * Deterministic `overhang` fixture in the Surfel Block v2 frame:
 * x, y tile-local in [0, 1] (y south), z in metres (up), radius in metres.
 *
 * A rock shelf running east-west across the whole tile, open to the south.
 * Only exposed surfaces are sampled. Cross-section looking east (y grows
 * to the right, z up):
 *
 *        top (z = 16 m, +z)
 *     ______________________
 *                           | lip face (y = 10/16, z 8..16 m, +y)
 *                ___________|
 *               | underside (z = 8 m, y 6/16..10/16, -z)
 *     back wall |
 *  (y = 6/16,   |
 *   z 0..8, +y) |_______________________  ground (z = 0, y 6/16..1, +z)
 *     y = 0    6/16        10/16       1
 *
 * - top:       z = 16 m, y in [0, 10/16], normal +z.
 * - lip:       vertical face at y = 10/16, z in [8, 16] m, normal +y.
 * - underside: z = 8 m, y in [6/16, 10/16], normal -z.
 * - back wall: vertical face at y = 6/16, z in [0, 8] m, normal +y.
 * - ground:    z = 0 m, y in [6/16, 1], normal +z.
 *
 * Under the overhang (y in [6/16, 10/16]) three surfels share each x/y:
 * ground (+z), underside (-z) and top (+z).
 *
 * Sampling pitch C = 1/16 of the tile horizontally, P = tileWidthMetres / 16
 * in metres. Vertical faces use max(1, ceil(8 m / P)) evenly spaced rows.
 * Every surfel has radius P·√½ m. Tile-local coordinates are multiples of
 * 1/32 and the heights are whole metres, so they are float32-exact. Radius
 * and face row heights are rounded to float32 by the generator.
 */

const N = 16;
const C = 1 / N;

export const OVERHANG_TOP_Z = 16;
export const OVERHANG_UNDERSIDE_Z = 8;
/** Tile-local y of the recessed back wall. */
export const OVERHANG_WALL_Y = 6 / 16;
/** Tile-local y of the overhang's front lip. */
export const OVERHANG_LIP_Y = 10 / 16;
/** Grid rows (j index) under the overhang: y in [6/16, 10/16]. */
export const OVERHANG_ROWS = [6, 7, 8, 9] as const;

type Rgba = readonly [number, number, number, number];
const TOP: Rgba = [176, 164, 140, 255];
const FACE: Rgba = [140, 112, 88, 255];
const UNDERSIDE: Rgba = [96, 70, 96, 255];
const GROUND: Rgba = [96, 140, 72, 255];

export interface OverhangOptions {
  /** Width in metres of the tile that will carry the overhang (see tileWidthMetres). */
  tileWidthMetres: number;
}

export interface OverhangParts {
  top: Surfel[];
  lip: Surfel[];
  underside: Surfel[];
  wall: Surfel[];
  ground: Surfel[];
}

/** Row heights in metres for a vertical face spanning [z0, z0 + 8 m]. */
export function overhangFaceRowHeights(tileWidthMetres: number, z0: number): number[] {
  const height = OVERHANG_TOP_Z - OVERHANG_UNDERSIDE_Z; // both faces are 8 m tall
  const rows = Math.max(1, Math.ceil(height / (tileWidthMetres * C)));
  return Array.from({ length: rows }, (_, k) => Math.fround(z0 + (height * (k + 0.5)) / rows));
}

const centre = (k: number): number => (k + 0.5) * C;

export function generateOverhangParts(options: OverhangOptions): OverhangParts {
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

  const top: Surfel[] = [];
  const underside: Surfel[] = [];
  const ground: Surfel[] = [];
  for (let j = 0; j < N; j++) {
    const y = centre(j);
    for (let i = 0; i < N; i++) {
      const x = centre(i);
      if (y < OVERHANG_LIP_Y) top.push(surfel(x, y, OVERHANG_TOP_Z, 0, 0, 1, TOP));
      if (y > OVERHANG_WALL_Y && y < OVERHANG_LIP_Y) {
        underside.push(surfel(x, y, OVERHANG_UNDERSIDE_Z, 0, 0, -1, UNDERSIDE));
      }
      if (y > OVERHANG_WALL_Y) ground.push(surfel(x, y, 0, 0, 0, 1, GROUND));
    }
  }

  const lip: Surfel[] = [];
  const wall: Surfel[] = [];
  for (const z of overhangFaceRowHeights(w, OVERHANG_UNDERSIDE_Z)) {
    for (let i = 0; i < N; i++) lip.push(surfel(centre(i), OVERHANG_LIP_Y, z, 0, 1, 0, FACE));
  }
  for (const z of overhangFaceRowHeights(w, 0)) {
    for (let i = 0; i < N; i++) wall.push(surfel(centre(i), OVERHANG_WALL_Y, z, 0, 1, 0, FACE));
  }

  return { top, lip, underside, wall, ground };
}

/** All overhang surfels in a fixed order: top, lip, underside, wall, ground. */
export function generateOverhang(options: OverhangOptions): Surfel[] {
  const { top, lip, underside, wall, ground } = generateOverhangParts(options);
  return [...top, ...lip, ...underside, ...wall, ...ground];
}
