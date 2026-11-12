import { generateBridge } from "../../src/fixtures/bridge.js";
import { generateOverhang } from "../../src/fixtures/overhang.js";
import { concatFrames, encodeFrame, wrapSurfelBlock } from "../../src/mlt-frame.js";
import { encodeSurfelBlock, type Surfel } from "../../src/surfel-block.js";
import { tileWidthMetres, type TileAddress } from "../../src/tile-geometry.js";

export type { TileAddress };

/** Tile address of the single demo tile (near Tokyo Station, ~124 m wide). */
export const DEMO_TILE = { z: 18, x: 232847, y: 103226 } as const;

/**
 * Demo tilesets. Each is a directory of z/x/y tiles holding one fixture;
 * different fixtures at the same tile address live in different tilesets.
 */
export const DEMO_TILESETS = ["bridge", "overhang"] as const;
export type DemoTileset = (typeof DEMO_TILESETS)[number];

const FIXTURES: Record<DemoTileset, (o: { tileWidthMetres: number }) => Surfel[]> = {
  bridge: generateBridge,
  overhang: generateOverhang,
};

export function isDemoTileset(name: string): name is DemoTileset {
  return (DEMO_TILESETS as readonly string[]).includes(name);
}

/** URL path of a tile relative to the demo page (demo/index.html). */
export function tileUrlPath(tileset: DemoTileset, t: TileAddress = DEMO_TILE): string {
  return `tiles/${tileset}/${t.z}/${t.x}/${t.y}.mlt`;
}

/** File path of a tile relative to the repository root. */
export function demoTilePath(tileset: DemoTileset, t: TileAddress = DEMO_TILE): string {
  return `demo/${tileUrlPath(tileset, t)}`;
}

/** Synthetic unknown frame placed before the surfel frame, to exercise skipping. */
export const DEMO_UNKNOWN_TAG = 0x7e;

/**
 * Bytes of a demo tile: one synthetic unknown frame, then the tileset's
 * fixture (sized for the tile's width) as an experimental surfel frame.
 * Deterministic.
 */
export function buildDemoTile(tileset: DemoTileset, t: TileAddress = DEMO_TILE): Uint8Array {
  const surfels = FIXTURES[tileset]({ tileWidthMetres: tileWidthMetres(t) });
  return concatFrames([
    encodeFrame(DEMO_UNKNOWN_TAG, new TextEncoder().encode("dorayaki demo: unknown frame")),
    wrapSurfelBlock(encodeSurfelBlock(surfels)),
  ]);
}
