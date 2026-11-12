import type { Surfel } from "../surfel-block.js";
import { samplePatch, type PatchAxis } from "./sampling.js";

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
 * Maximum sampling pitch P = tileWidthMetres / 16. Every surface is sampled
 * per patch with samplePatch (src/fixtures/sampling.ts): its own grid,
 * spacing <= P, radius = half its cell diagonal. Horizontal surfaces get
 * the same 1/16-of-tile grid (float32-exact multiples of 1/32), so they
 * share x/y; the 8 m faces are subdivided to fit their height.
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

export function generateOverhangParts(options: OverhangOptions): OverhangParts {
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

  const horizontal = (y: PatchAxis, z: number, nz: number, rgba: Rgba): Surfel[] => {
    const p = samplePatch(X(0, 1), y, pitch);
    return p.v.flatMap((yy) => p.u.map((xx) => surfel(xx, yy, z, 0, 0, nz, p.radius, rgba)));
  };
  /** Vertical face at tile-local y, spanning x in [0, 1] and z in [z0, z1], normal +y. */
  const southFace = (y: number, z0: number, z1: number): Surfel[] => {
    const p = samplePatch(X(0, 1), Z(z0, z1), pitch);
    return p.v.flatMap((z) => p.u.map((x) => surfel(x, y, z, 0, 1, 0, p.radius, FACE)));
  };

  return {
    top: horizontal(X(0, OVERHANG_LIP_Y), OVERHANG_TOP_Z, 1, TOP),
    lip: southFace(OVERHANG_LIP_Y, OVERHANG_UNDERSIDE_Z, OVERHANG_TOP_Z),
    underside: horizontal(X(OVERHANG_WALL_Y, OVERHANG_LIP_Y), OVERHANG_UNDERSIDE_Z, -1, UNDERSIDE),
    wall: southFace(OVERHANG_WALL_Y, 0, OVERHANG_UNDERSIDE_Z),
    ground: horizontal(X(OVERHANG_WALL_Y, 1), 0, 1, GROUND),
  };
}

/** All overhang surfels in a fixed order: top, lip, underside, wall, ground. */
export function generateOverhang(options: OverhangOptions): Surfel[] {
  const { top, lip, underside, wall, ground } = generateOverhangParts(options);
  return [...top, ...lip, ...underside, ...wall, ...ground];
}
