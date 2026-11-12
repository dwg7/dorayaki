import { generateBridge } from "../../src/fixtures/bridge.js";
import { concatFrames, encodeFrame, wrapSurfelBlock } from "../../src/mlt-frame.js";
import { encodeSurfelBlock } from "../../src/surfel-block.js";

/** Tile address of the single demo tile (near Tokyo Station, ~497 m wide). */
export const DEMO_TILE = { z: 16, x: 58211, y: 25806 } as const;

export type TileAddress = { readonly z: number; readonly x: number; readonly y: number };

/** URL path of a tile relative to the demo page (demo/index.html). */
export function tileUrlPath(t: TileAddress = DEMO_TILE): string {
  return `tiles/${t.z}/${t.x}/${t.y}.mlt`;
}

/** File path of a tile relative to the repository root. */
export function demoTilePath(t: TileAddress = DEMO_TILE): string {
  return `demo/${tileUrlPath(t)}`;
}

/** Synthetic unknown frame placed before the surfel frame, to exercise skipping. */
export const DEMO_UNKNOWN_TAG = 0x7e;

/**
 * Bytes of the demo tile: one synthetic unknown frame, then the bridge
 * fixture as an experimental surfel frame. Deterministic.
 */
export function buildDemoTile(): Uint8Array {
  return concatFrames([
    encodeFrame(DEMO_UNKNOWN_TAG, new TextEncoder().encode("dorayaki demo: unknown frame")),
    wrapSurfelBlock(encodeSurfelBlock(generateBridge())),
  ]);
}
