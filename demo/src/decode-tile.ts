/**
 * Decoding: MLT tile bytes -> splats. No network, DOM, or WebGL here.
 */
import { extractSurfelBlocks } from "../../src/mlt-frame.js";
import { decodeSurfelBlockWithLevels, packedSurfelBlock, type PackedBlock, type Splat, type SurfelBlock } from "../../src/surfel-block.js";

/** Decode the single experimental surfel frame in a tile, with its level table. */
export function decodeSurfelTileWithLevels(tile: Uint8Array): SurfelBlock {
  const blocks = extractSurfelBlocks(tile);
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one surfel frame, found ${blocks.length}`);
  }
  return decodeSurfelBlockWithLevels(blocks[0] as Uint8Array);
}

/** Decode the single experimental surfel frame in a tile, ignoring its level table. */
export function decodeSurfelTile(tile: Uint8Array): Splat[] {
  return decodeSurfelTileWithLevels(tile).splats;
}

/** The single surfel frame's records as they are, for uploading to the GPU without making Splat objects. */
export function packSurfelTile(tile: Uint8Array): PackedBlock {
  const blocks = extractSurfelBlocks(tile);
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one surfel frame, found ${blocks.length}`);
  }
  return packedSurfelBlock(blocks[0] as Uint8Array);
}
