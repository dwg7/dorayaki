/**
 * Tile ownership: distributing surfels of a multi-tile area to tiles.
 *
 * Rule (Dorayaki producer convention, not checked by the decoder):
 * a surfel belongs to the one tile that contains its centre, using
 * half-open intervals: tile-local x and y in [0, 1). Its disc may extend
 * into neighbouring tiles. Surfels are neither duplicated nor clipped at
 * tile edges.
 *
 * Geometry is produced in block-local coordinates for a rectangular block
 * of tiles at one zoom level: x in [0, cols), y in [0, rows), in tile
 * units, with the block's north-west tile at (0, 0). x and y are Web
 * Mercator tile units, so they are continuous across tiles; z and radius
 * stay in metres.
 */
import type { Surfel } from "./surfel-block.js";
import type { TileAddress } from "./tile-geometry.js";

export interface TileBlock {
  /** North-west tile of the block. */
  origin: TileAddress;
  cols: number;
  rows: number;
}

export interface TileSurfels {
  tile: TileAddress;
  /** Surfels in tile-local coordinates, in their original relative order. */
  surfels: Surfel[];
}

function checkBlock(b: TileBlock): void {
  for (const [name, v] of [["cols", b.cols], ["rows", b.rows]] as const) {
    if (!Number.isInteger(v) || v < 1) throw new RangeError(`${name} must be a positive integer, got ${v}`);
  }
}

/** Tiles of the block in row-major order (north to south, west to east). */
export function blockTiles(b: TileBlock): TileAddress[] {
  checkBlock(b);
  const out: TileAddress[] = [];
  for (let j = 0; j < b.rows; j++) {
    for (let i = 0; i < b.cols; i++) out.push({ z: b.origin.z, x: b.origin.x + i, y: b.origin.y + j });
  }
  return out;
}

/**
 * Split block-local surfels into per-tile, tile-local surfels by the
 * centre-ownership rule. Returns every tile of the block, in blockTiles
 * order, including tiles that receive no surfels. Throws if a centre lies
 * outside the block.
 */
export function splitByTile(surfels: readonly Surfel[], b: TileBlock): TileSurfels[] {
  const tiles = blockTiles(b).map((tile) => ({ tile, surfels: [] as Surfel[] }));
  surfels.forEach((s, n) => {
    const i = Math.floor(s.x);
    const j = Math.floor(s.y);
    if (!(i >= 0 && i < b.cols && j >= 0 && j < b.rows)) {
      throw new RangeError(`surfel ${n} centre (${s.x}, ${s.y}) is outside the ${b.cols}×${b.rows} block`);
    }
    // Exact for float32 inputs: subtracting an integer from a value in
    // [i, i + 1) is representable, so tile-local values stay float32-exact.
    (tiles[j * b.cols + i] as TileSurfels).surfels.push({ ...s, x: s.x - i, y: s.y - j });
  });
  return tiles;
}
