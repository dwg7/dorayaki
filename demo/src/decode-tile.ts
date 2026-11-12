/**
 * Decoding: MLT tile bytes -> surfels. No network, DOM, or WebGL here.
 */
import { extractSurfelBlocks } from "../../src/mlt-frame.js";
import { decodeSurfelBlock, type Surfel } from "../../src/surfel-block.js";

/** Decode the single experimental surfel frame in a tile. */
export function decodeSurfelTile(tile: Uint8Array): Surfel[] {
  const blocks = extractSurfelBlocks(tile);
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one surfel frame, found ${blocks.length}`);
  }
  return decodeSurfelBlock(blocks[0] as Uint8Array);
}
