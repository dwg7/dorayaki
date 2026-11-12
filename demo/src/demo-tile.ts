import { BOUNDARY_COLS, BOUNDARY_ROWS, generateBoundary } from "../../src/fixtures/boundary.js";
import { generateBridge } from "../../src/fixtures/bridge.js";
import { generateOverhang } from "../../src/fixtures/overhang.js";
import { toyGaussianPly } from "../../src/fixtures/toy-gaussians.js";
import { readPly } from "../../src/gaussian/ply.js";
import { gaussianToDisc, gaussiansFromPly, placeDiscs } from "../../src/gaussian/to-surfels.js";
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
export const DEMO_TILESETS = ["bridge", "overhang", "boundary", "toy-gs"] as const;
export type DemoTileset = (typeof DEMO_TILESETS)[number];

/** Geographic origin of the demo: Sapporo Station. */
export const DEMO_ORIGIN = { lng: 141.35077, lat: 43.06866 } as const;

/** Synthetic fixtures generated in block-local coordinates on a fixed block. */
const SYNTHETIC: Record<Exclude<DemoTileset, "toy-gs">, { block: TileBlock; generate: (o: { tileWidthMetres: number }) => Surfel[] }> = {
  bridge: { block: { origin: DEMO_TILE, cols: 1, rows: 1 }, generate: generateBridge },
  overhang: { block: { origin: DEMO_TILE, cols: 1, rows: 1 }, generate: generateOverhang },
  boundary: { block: { origin: DEMO_TILE, cols: BOUNDARY_COLS, rows: BOUNDARY_ROWS }, generate: generateBoundary },
};

/**
 * Block and block-local surfels of a tileset. Synthetic fixtures use a fixed
 * block with DEMO_TILE at its north-west corner, sized for that tile's
 * width. `toy-gs` converts the toy 3DGS PLY around DEMO_ORIGIN, and its
 * block follows from the data's extent.
 */
function tilesetContent(tileset: DemoTileset): { block: TileBlock; surfels: Surfel[] } {
  if (tileset === "toy-gs") {
    const discs = gaussiansFromPly(readPly(toyGaussianPly())).map(gaussianToDisc);
    return placeDiscs(discs, DEMO_ORIGIN, DEMO_TILE.z);
  }
  const { block, generate } = SYNTHETIC[tileset];
  return { block, surfels: generate({ tileWidthMetres: tileWidthMetres(block.origin) }) };
}

export function isDemoTileset(name: string): name is DemoTileset {
  return (DEMO_TILESETS as readonly string[]).includes(name);
}

/** Tiles of a tileset, row-major from the north-west tile. */
export function tilesetTiles(tileset: DemoTileset): TileAddress[] {
  return blockTiles(tilesetContent(tileset).block);
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

/** Surfels of every tile of a tileset, distributed by the centre-ownership rule (src/tiling.ts). */
export function demoTileSurfels(tileset: DemoTileset): TileSurfels[] {
  const { block, surfels } = tilesetContent(tileset);
  return splitByTile(surfels, block);
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
