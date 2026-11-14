import { BOUNDARY_COLS, BOUNDARY_ROWS, generateBoundary } from "../../src/fixtures/boundary.js";
import { generateBridge } from "../../src/fixtures/bridge.js";
import { generateOverhang } from "../../src/fixtures/overhang.js";
import { toyGaussianPly } from "../../src/fixtures/toy-gaussians.js";
import { readPly } from "../../src/gaussian/ply.js";
import { gaussiansFromPly, placeGaussians } from "../../src/gaussian/to-surfels.js";
import { concatFrames, encodeFrame, wrapSurfelBlock } from "../../src/mlt-frame.js";
import { surfelToSplat } from "../../src/splat.js";
import { encodeSurfelBlock, type Splat, type Surfel } from "../../src/surfel-block.js";
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
 * Block and block-local splats of a tileset. Synthetic fixtures use a fixed
 * block with DEMO_TILE at its north-west corner, sized for that tile's
 * width. `toy-gs` converts the toy 3DGS PLY around DEMO_ORIGIN, and its
 * block follows from the data's extent.
 */
function tilesetContent(tileset: DemoTileset): { block: TileBlock; splats: Splat[] } {
  if (tileset === "toy-gs") {
    return placeGaussians(gaussiansFromPly(readPly(toyGaussianPly())), DEMO_ORIGIN, DEMO_TILE.z);
  }
  const { block, generate } = SYNTHETIC[tileset];
  return { block, splats: generate({ tileWidthMetres: tileWidthMetres(block.origin) }).map(surfelToSplat) };
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

/** Splats of every tile of a tileset, distributed by the centre-ownership rule (src/tiling.ts). */
export function demoTileSplats(tileset: DemoTileset): TileSurfels<Splat>[] {
  const { block, splats } = tilesetContent(tileset);
  return splitByTile(splats, block);
}

/** Bytes of one tile: a synthetic unknown frame, then the surfel frame (with an optional level table). */
export function encodeDemoTile(splats: readonly Splat[], levels?: readonly number[]): Uint8Array {
  return concatFrames([
    encodeFrame(DEMO_UNKNOWN_TAG, new TextEncoder().encode("dorayaki demo: unknown frame")),
    wrapSurfelBlock(encodeSurfelBlock(splats, levels)),
  ]);
}

/** Deterministic bytes of every tile of a tileset. */
export function buildDemoTiles(tileset: DemoTileset): Array<{ tile: TileAddress; bytes: Uint8Array }> {
  return demoTileSplats(tileset).map(({ tile, surfels }) => ({ tile, bytes: encodeDemoTile(surfels) }));
}
