import type { Surfel } from "../surfel-block.js";
import { samplePatch, type PatchAxis } from "./sampling.js";

/**
 * Deterministic `boundary` fixture: geometry crossing tile boundaries.
 *
 * Generated in block-local coordinates for a 2 × 2 block of tiles
 * (src/tiling.ts): x, y in [0, 2) tile units (y south), z and radius in
 * metres. Split it into tiles with splitByTile.
 *
 * - ground: z = 0 m over the whole block except under the building,
 *   normal +z.
 * - building: a box centred on the block's middle corner, where all four
 *   tiles meet. Footprint x, y in [0.75, 1.25], so a quarter of it lies in
 *   each tile and it crosses both tile seams.
 *   - roof at z = 20 m, normal +z;
 *   - four walls from z = 0 to 20 m with outward normals −x (west),
 *     +x (east), −y (north), +y (south).
 *
 * Sampling uses samplePatch with maximum pitch P = tileWidthMetres / 16.
 * The ground and roof share one continuous 1/16-tile grid across the whole
 * block, so the grid does not restart at tile seams. Tile widths differ
 * slightly between the block's north and south rows; the fixture uses the
 * one width it is given for all four tiles.
 */

export const BOUNDARY_COLS = 2;
export const BOUNDARY_ROWS = 2;
export const BOUNDARY_ROOF_Z = 20;
/** Building footprint in block-local tile units: [min, max] on both axes. */
export const BOUNDARY_FOOTPRINT = [0.75, 1.25] as const;

type Rgba = readonly [number, number, number, number];
const GROUND: Rgba = [96, 140, 72, 255];
const ROOF: Rgba = [210, 120, 90, 255];
const WALL: Rgba = [220, 210, 190, 255];

export interface BoundaryOptions {
  /** Width in metres of the tiles that will carry the fixture. */
  tileWidthMetres: number;
}

export interface BoundaryParts {
  ground: Surfel[];
  roof: Surfel[];
  walls: Surfel[];
}

export function generateBoundaryParts(options: BoundaryOptions): BoundaryParts {
  const w = options.tileWidthMetres;
  if (!Number.isFinite(w) || w <= 0) {
    throw new RangeError(`tileWidthMetres must be a positive finite number, got ${w}`);
  }
  const pitch = w / 16;
  const [lo, hi] = BOUNDARY_FOOTPRINT;
  const X = (a: number, b: number): PatchAxis => ({ lo: a, hi: b, metresPerUnit: w });
  const Z = (a: number, b: number): PatchAxis => ({ lo: a, hi: b, metresPerUnit: 1 });
  const surfel = (
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    radius: number,
    [r, g, b, a]: Rgba,
  ): Surfel => ({ x, y, z, nx, ny, nz, radius, r, g, b, a });
  const inside = (v: number): boolean => v > lo && v < hi;

  const g = samplePatch(X(0, BOUNDARY_COLS), X(0, BOUNDARY_ROWS), pitch);
  const ground = g.v.flatMap((y) =>
    g.u.filter((x) => !(inside(x) && inside(y))).map((x) => surfel(x, y, 0, 0, 0, 1, g.radius, GROUND)),
  );

  const r = samplePatch(X(lo, hi), X(lo, hi), pitch);
  const roof = r.v.flatMap((y) => r.u.map((x) => surfel(x, y, BOUNDARY_ROOF_Z, 0, 0, 1, r.radius, ROOF)));

  const f = samplePatch(X(lo, hi), Z(0, BOUNDARY_ROOF_Z), pitch);
  const walls: Surfel[] = [];
  for (const z of f.v) {
    for (const t of f.u) {
      walls.push(surfel(lo, t, z, -1, 0, 0, f.radius, WALL)); // west
      walls.push(surfel(hi, t, z, 1, 0, 0, f.radius, WALL)); // east
      walls.push(surfel(t, lo, z, 0, -1, 0, f.radius, WALL)); // north
      walls.push(surfel(t, hi, z, 0, 1, 0, f.radius, WALL)); // south
    }
  }

  return { ground, roof, walls };
}

/** All boundary surfels in block-local coordinates: ground, roof, walls. */
export function generateBoundary(options: BoundaryOptions): Surfel[] {
  const { ground, roof, walls } = generateBoundaryParts(options);
  return [...ground, ...roof, ...walls];
}
