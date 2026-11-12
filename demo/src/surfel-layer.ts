/**
 * MapLibre custom-layer lifecycle for one tile of decoded surfels.
 *
 * Only wires MapLibre's onAdd / render / onRemove to the GPU module and
 * the placement matrix. Mercator projection only: it uses
 * defaultProjectionData.mainMatrix and does not support globe or terrain.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";

import type { Surfel } from "../../src/surfel-block.js";
import type { TileAddress } from "./demo-tile.js";
import {
  createSurfelProgram,
  deleteSurfelResources,
  drawSurfels,
  uploadSurfels,
  type SurfelBuffers,
  type SurfelProgram,
} from "./gpu-surfels.js";
import { multiplyMat4, tileToMercatorMatrix, type Mat4 } from "./tile-matrix.js";

export class SurfelLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  depthTest = true;

  private readonly surfels: readonly Surfel[];
  private readonly model: Mat4;
  private map: MapLibreMap | undefined;
  private gpu: { program: SurfelProgram; buffers: SurfelBuffers } | undefined;

  constructor(id: string, tile: TileAddress, surfels: readonly Surfel[]) {
    this.id = id;
    this.surfels = surfels;
    this.model = tileToMercatorMatrix(tile);
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.gpu = { program: createSurfelProgram(gl), buffers: uploadSurfels(gl, this.surfels) };
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.gpu) return;
    const matrix = Float32Array.from(multiplyMat4(options.defaultProjectionData.mainMatrix, this.model));
    drawSurfels(gl, this.gpu.program, this.gpu.buffers, { matrix, depthTest: this.depthTest });
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    if (this.gpu) deleteSurfelResources(gl, this.gpu.program, this.gpu.buffers);
    this.gpu = undefined;
    this.map = undefined;
  }

  setDepthTest(enabled: boolean): void {
    this.depthTest = enabled;
    this.map?.triggerRepaint();
  }
}
