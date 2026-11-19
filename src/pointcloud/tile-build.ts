/**
 * The tile-local build (E022 step 2, documents/tile-aligned-build.md): the points of one z17 tile in, the splats of that tile at z17 and
 * the pieces it contributes to z16 and z15 out.
 *
 * Points are given in the tile's own frame: metres east and south of its north-west corner (what `TileFramer.locate` returns), height up.
 * The voxel grid is the tile's: cells of tile width / 512 from the corner, so the cells of z16 and z15 are exactly 2 and 4 times larger
 * and nest, and with up to three merge levels (groups of 8) no merge group crosses the tile's edge. Everything a tile needs is in its own
 * points: no halo, no neighbour. The merge rule is the one of build-tileset.ts (every zoom merged by the same rule; the sparse threshold
 * multiplied for each zoom below z17).
 *
 * No file, stream or DOM access: the caller feeds the points, and the splats come back as plain objects, so the same function can run in a
 * worker. Splats are positioned in the tile of their zoom (x, y in [0, 1) tile units; a z16 piece lies in one quarter of its tile).
 */
import { splatOfGaussian, type Gaussian, type PlacedSplat } from "../gaussian/to-surfels.js";
import { tileWidthMetres, type TileAddress } from "../tile-geometry.js";
import { adaptiveGaussians, type AdaptiveOptions } from "./adaptive.js";
import { VoxelAccumulator } from "./voxel-accumulator.js";

/** Cells along a tile's edge at every zoom (BASE_CELLS of progressive.ts). */
const CELLS = 512;
const TILE_ZOOM = 17;

export interface TileBuildConfig {
  /** Zooms to build, each at most 17 (default 17, 16, 15). */
  zooms?: readonly number[];
  /** The merge rule; `sparseSupport` is the threshold at z17, multiplied by `sparseScale` for each zoom below. */
  adaptive: Omit<AdaptiveOptions, "sparseSupport"> & { sparseSupport?: number; sparseScale?: number };
  /** Class slots per voxel (0 = the points carry no class); the class is carried by `adaptive.opacityOf`. */
  classSlots?: number;
}

/** Feed the points: call `add` once per point. Color channels in 0..1; `slot` is the class slot (-1 or omitted for none). */
export type TilePointFeed = (add: (east: number, south: number, up: number, r: number, g: number, b: number, slot?: number) => void) => void;

export interface TilePiece {
  /** The tile the splats belong to (the z17 tile itself, or its ancestor at a lower zoom). */
  tile: TileAddress;
  /** Splats in tile units of `tile` (x east, y south, both in [0, 1)). */
  splats: PlacedSplat[];
  /** Merge level counts, as adaptiveGaussians reports them. */
  perLevel: number[];
  /** Points fed. */
  points: number;
  /** Voxels occupied before merging. */
  voxels: number;
}

/** The splats of one z17 tile and its contributions to lower zooms, one piece per zoom, in the order of `config.zooms`. */
export function buildTilePieces(feed: TilePointFeed, tile: TileAddress, config: TileBuildConfig): TilePiece[] {
  if (tile.z !== TILE_ZOOM) throw new RangeError(`the tile build works on z${TILE_ZOOM} tiles, got z${tile.z}`);
  const zooms = config.zooms ?? [17, 16, 15];
  for (const z of zooms) if (!Number.isInteger(z) || z > TILE_ZOOM || z < 0) throw new RangeError(`zoom ${z} must be an integer from 0 to ${TILE_ZOOM}`);
  const { maxLevel } = config.adaptive;
  if (!Number.isInteger(maxLevel) || maxLevel < 0 || maxLevel > 3) {
    // 512 cells divided into groups of 2^maxLevel: the tile-edge guarantee holds for the finest zoom up to 2^9 cells, but the rule of the plan is 3.
    throw new RangeError("maxLevel must be an integer from 0 to 3");
  }
  const width = tileWidthMetres(tile);
  const cell = width / CELLS;
  const slots = config.classSlots ?? 0;
  // The tile's frame is east-north-up with north counted from the corner (y <= 0): the Gaussians come out east-north-up, as placement expects.
  const accs = zooms.map((z) => new VoxelAccumulator(cell * 2 ** (TILE_ZOOM - z), 16, slots));
  feed((east, south, up, r, g, b, slot = -1) => { for (const a of accs) a.add(east, -south, up, r, g, b, slot); });

  return zooms.map((z, i) => {
    const acc = accs[i]!;
    const d = TILE_ZOOM - z;
    const sparse = (config.adaptive.sparseSupport ?? 0) * (config.adaptive.sparseScale ?? 1) ** d;
    const result = acc.voxels === 0
      ? { gaussians: [] as Gaussian[], perLevel: new Array<number>(maxLevel + 1).fill(0) }
      : adaptiveGaussians(acc, { ...config.adaptive, sparseSupport: sparse });
    const target: TileAddress = { z, x: tile.x >> d, y: tile.y >> d };
    const ox = tile.x - (target.x << d), oy = tile.y - (target.y << d);
    const scale = 2 ** d;
    const splats = result.gaussians.map((g) => splatOfGaussian(g, (ox + g.position[0] / width) / scale, (oy - g.position[1] / width) / scale));
    return { tile: target, splats, perLevel: result.perLevel, points: acc.points, voxels: acc.voxels };
  });
}
