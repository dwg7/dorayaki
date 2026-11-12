import { BOUNDARY_COLS, BOUNDARY_ROWS, generateBoundary } from "../../src/fixtures/boundary.js";
import { generateBridge } from "../../src/fixtures/bridge.js";
import { generateOverhang } from "../../src/fixtures/overhang.js";
import { concatFrames, encodeFrame, wrapSurfelBlock } from "../../src/mlt-frame.js";
import { encodeSurfelBlock, type Surfel } from "../../src/surfel-block.js";
import { tileWidthMetres, type TileAddress } from "../../src/tile-geometry.js";
import { blockTiles, splitByTile, type TileBlock, type TileSurfels } from "../../src/tiling.js";

export type { TileAddress };

/** Tile address of the single demo tile (at Sapporo Station, ~111.7 m wide). */
export const DEMO_TILE = { z: 18, x: 234000, y: 96256 } as const;

/**
 * Demo tilesets. Each is a directory of z/x/y tiles holding one fixture;
 * different fixtures at the same tile address live in different tilesets.
 */
export const DEMO_TILESETS = ["bridge", "overhang", "boundary"] as const;
export type DemoTileset = (typeof DEMO_TILESETS)[number];

/** Block of tiles each tileset covers. DEMO_TILE is always its north-west tile. */
const BLOCKS: Record<DemoTileset, TileBlock> = {
  bridge: { origin: DEMO_TILE, cols: 1, rows: 1 },
  overhang: { origin: DEMO_TILE, cols: 1, rows: 1 },
  boundary: { origin: DEMO_TILE, cols: BOUNDARY_COLS, rows: BOUNDARY_ROWS },
};

const FIXTURES: Record<DemoTileset, (o: { tileWidthMetres: number }) => Surfel[]> = {
  bridge: generateBridge,
  overhang: generateOverhang,
  boundary: generateBoundary,
};

export function isDemoTileset(name: string): name is DemoTileset {
  return (DEMO_TILESETS as readonly string[]).includes(name);
}

/** Tiles of a tileset, row-major from the north-west tile. */
export function tilesetTiles(tileset: DemoTileset): TileAddress[] {
  return blockTiles(BLOCKS[tileset]);
}

/** URL path of a tile relative to the demo page (demo/index.html). */
export function tileUrlPath(tileset: DemoTileset, t: TileAddress): string {
  return `tiles/${tileset}/${t.z}/${t.x}/${t.y}.mlt`;
}

/** File path of a tile relative to the repository root. */
export function demoTilePath(tileset: DemoTileset, t: TileAddress): string {
  return `demo/${tileUrlPath(tileset, t)}`;
}

/** Synthetic unknown frame placed before the surfel frame, to exercise skipping. */
export const DEMO_UNKNOWN_TAG = 0x7e;

/**
 * Surfels of every tile of a tileset. The fixture is generated in
 * block-local coordinates (sized for the north-west tile's width) and
 * distributed with the centre-ownership rule (src/tiling.ts).
 */
export function demoTileSurfels(tileset: DemoTileset): TileSurfels[] {
  const block = BLOCKS[tileset];
  return splitByTile(FIXTURES[tileset]({ tileWidthMetres: tileWidthMetres(block.origin) }), block);
}

/** Bytes of one tile: a synthetic unknown frame, then the surfel frame. */
export function encodeDemoTile(surfels: readonly Surfel[]): Uint8Array {
  return concatFrames([
    encodeFrame(DEMO_UNKNOWN_TAG, new TextEncoder().encode("dorayaki demo: unknown frame")),
    wrapSurfelBlock(encodeSurfelBlock(surfels)),
  ]);
}

/** Deterministic bytes of every tile of a tileset. */
export function buildDemoTiles(tileset: DemoTileset): Array<{ tile: TileAddress; bytes: Uint8Array }> {
  return demoTileSurfels(tileset).map(({ tile, surfels }) => ({ tile, bytes: encodeDemoTile(surfels) }));
}
