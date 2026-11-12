/**
 * Decoding: MLT tile bytes -> surfels. No network, DOM, or WebGL here.
 */
import { extractSurfelBlocks } from "../../src/mlt-frame.js";
import { decodeSurfelBlockWithLevels, type Surfel, type SurfelBlock } from "../../src/surfel-block.js";

/** Decode the single experimental surfel frame in a tile, with its level table. */
export function decodeSurfelTileWithLevels(tile: Uint8Array): SurfelBlock {
  const blocks = extractSurfelBlocks(tile);
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one surfel frame, found ${blocks.length}`);
  }
  return decodeSurfelBlockWithLevels(blocks[0] as Uint8Array);
}

/** Decode the single experimental surfel frame in a tile, ignoring its level table. */
export function decodeSurfelTile(tile: Uint8Array): Surfel[] {
  return decodeSurfelTileWithLevels(tile).surfels;
}
