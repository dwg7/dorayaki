export * from "./surfel-block.js";
export { generatePlane, type PlaneOptions } from "./fixtures/plane.js";
export {
  BRIDGE_DECK_ROWS,
  BRIDGE_DECK_Z,
  BRIDGE_PIERS,
  BRIDGE_UNDERSIDE_Z,
  generateBridge,
  generateBridgeParts,
  type BridgeParts,
} from "./fixtures/bridge.js";
export * from "./mlt-frame.js";
export * from "./tile-geometry.js";
export {
  OVERHANG_LIP_Y,
  OVERHANG_ROWS,
  OVERHANG_TOP_Z,
  OVERHANG_UNDERSIDE_Z,
  OVERHANG_WALL_Y,
  generateOverhang,
  generateOverhangParts,
  type OverhangOptions,
  type OverhangParts,
} from "./fixtures/overhang.js";
export { patchOvershoot, samplePatch, type PatchAxis, type PatchSamples } from "./fixtures/sampling.js";
export { blockTiles, splitByTile, type TileBlock, type TileSurfels } from "./tiling.js";
export {
  BOUNDARY_COLS,
  BOUNDARY_FOOTPRINT,
  BOUNDARY_ROOF_Z,
  BOUNDARY_ROWS,
  generateBoundary,
  generateBoundaryParts,
  type BoundaryOptions,
  type BoundaryParts,
} from "./fixtures/boundary.js";
