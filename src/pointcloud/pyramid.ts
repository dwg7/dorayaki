/**
 * Tile pyramid from a point cloud (documents/progressive-maxzoom.md).
 *
 * For each aggregated zoom, one Gaussian per voxel of tile width / 512,
 * placed on tiles of that zoom (single-level blocks). For the maxzoom, the
 * finest Gaussians (voxel = maxzoom tile width / (512 · 2^(levels − 1)))
 * placed on maxzoom tiles, in nested refinement order with a level table;
 * refinement levels drop Gaussians fitted to fewer than
 * `minRefinementSupport` points, and level 0 is kept whole.
 *
 * Input is a local metric frame (east, north, up metres) around a
 * geographic origin. No file or DOM access: producers write the tiles.
 */
import type { GeoOrigin, Gaussian, PlacedSplat } from "../gaussian/to-surfels.js";
import { placeGaussians } from "../gaussian/to-surfels.js";
import { BASE_CELLS, omitWeakRefinements, orderByRefinement } from "../progressive.js";
import { tileWidthMetres, type TileAddress } from "../tile-geometry.js";
import { splitByTile } from "../tiling.js";
import { fitVoxelGaussians, type LocalPoints } from "./voxel-gaussians.js";

export interface PyramidConfig {
  /** Zooms below maxzoom that hold aggregated Gaussians, one level each. */
  aggregatedZooms: readonly number[];
  maxzoom: number;
  /** Levels in a maxzoom tile (>= 1). 1 means no refinement: all splats at the maxzoom's level-0 cell size. */
  levels: number;
  /** Refinement surfels (levels 1 and later) with fewer source points are omitted. */
  minRefinementSupport: number;
}

export interface PyramidTile {
  tile: TileAddress;
  splats: PlacedSplat[];
  levels: number[];
}

export interface Pyramid {
  tiles: PyramidTile[];
  /** Gaussians fitted per zoom before omission (aggregated zooms and the maxzoom). */
  gaussiansPerZoom: Record<number, number>;
  /** Size in metres of the voxel of the finest level at the maxzoom. */
  finestVoxelMetres: number;
  /** The finest Gaussians, before tiling and omission. */
  finest: Gaussian[];
}

/** Tile width at the origin's latitude for a zoom (the tile's x does not matter). */
function widthAt(origin: GeoOrigin, z: number): number {
  const n = 2 ** z;
  const y = Math.floor(((1 - Math.asinh(Math.tan((origin.lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return tileWidthMetres({ z, x: 0, y });
}

/**
 * One Gaussian per occupied voxel. Voxels with fewer than 3 points get
 * scales of a quarter voxel; others are floored at 1 mm only, so planar
 * voxels keep their thin axis (E003).
 */
export const fitVoxels = (points: LocalPoints, voxel: number) =>
  fitVoxelGaussians(points, { voxelSize: voxel, minPoints: 1, minScale: 0.001, degenerateScale: voxel / 4 });

export function buildPyramid(points: LocalPoints, origin: GeoOrigin, config: PyramidConfig): Pyramid {
  if (!Number.isInteger(config.levels) || config.levels < 1) throw new RangeError("levels must be a positive integer");
  for (const z of config.aggregatedZooms) {
    if (!(z < config.maxzoom)) throw new RangeError(`aggregated zoom ${z} must be below the maxzoom ${config.maxzoom}`);
  }
  const tiles: PyramidTile[] = [];
  const gaussiansPerZoom: Record<number, number> = {};

  for (const z of config.aggregatedZooms) {
    const gaussians = fitVoxels(points, widthAt(origin, z) / BASE_CELLS);
    gaussiansPerZoom[z] = gaussians.length;
    const { block, splats } = placeGaussians(gaussians, origin, z);
    for (const t of splitByTile(splats, block)) {
      if (t.surfels.length > 0) tiles.push({ tile: t.tile, splats: t.surfels, levels: [t.surfels.length] });
    }
  }

  const finestVoxelMetres = widthAt(origin, config.maxzoom) / (BASE_CELLS * 2 ** (config.levels - 1));
  const finest = fitVoxels(points, finestVoxelMetres);
  gaussiansPerZoom[config.maxzoom] = finest.length;
  const { block, splats } = placeGaussians(finest, origin, config.maxzoom);
  for (const t of splitByTile(splats, block)) {
    if (t.surfels.length === 0) continue;
    const ordered = omitWeakRefinements(
      orderByRefinement(t.surfels, tileWidthMetres(t.tile), config.levels),
      (q) => (q.support ?? 0) >= config.minRefinementSupport,
    );
    tiles.push({ tile: t.tile, splats: ordered.surfels, levels: ordered.levels });
  }
  return { tiles, gaussiansPerZoom, finestVoxelMetres, finest };
}
