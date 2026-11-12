/**
 * MapLibre custom-layer lifecycle for decoded surfels of one or more tiles.
 *
 * Only wires MapLibre's onAdd / render / onRemove to the GPU module and
 * the placement matrix. Each tile keeps its own buffers, model matrix and
 * tile width; one shader program is shared. Mercator projection only: it
 * uses defaultProjectionData.mainMatrix and does not support globe or
 * terrain.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";

import type { Surfel } from "../../src/surfel-block.js";
import { tileWidthMetres, type TileAddress } from "../../src/tile-geometry.js";
import {
  createSurfelProgram,
  deleteSurfelBuffers,
  deleteSurfelProgram,
  drawSurfels,
  uploadSurfels,
  type SurfelBuffers,
  type SurfelProgram,
} from "./gpu-surfels.js";
import { metricToMercatorMatrix, multiplyMat4, type Mat4 } from "./tile-matrix.js";

export interface LayerTile {
  tile: TileAddress;
  surfels: readonly Surfel[];
}

interface TileState {
  tile: TileAddress;
  surfels: readonly Surfel[];
  widthMetres: number;
  model: Mat4;
  buffers: SurfelBuffers | undefined;
}

export class SurfelLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  depthTest = true;

  private readonly tiles: TileState[];
  private map: MapLibreMap | undefined;
  private program: SurfelProgram | undefined;

  constructor(id: string, tiles: readonly LayerTile[]) {
    this.id = id;
    this.tiles = tiles.map(({ tile, surfels }) => {
      const widthMetres = tileWidthMetres(tile);
      return { tile, surfels, widthMetres, model: metricToMercatorMatrix(tile, widthMetres), buffers: undefined };
    });
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.program = createSurfelProgram(gl);
    for (const t of this.tiles) t.buffers = uploadSurfels(gl, t.surfels);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program) return;
    for (const t of this.tiles) {
      if (!t.buffers) continue;
      const matrix = Float32Array.from(multiplyMat4(options.defaultProjectionData.mainMatrix, t.model));
      drawSurfels(gl, this.program, t.buffers, {
        matrix,
        tileWidthMetres: t.widthMetres,
        depthTest: this.depthTest,
      });
    }
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    for (const t of this.tiles) {
      if (t.buffers) deleteSurfelBuffers(gl, t.buffers);
      t.buffers = undefined;
    }
    if (this.program) deleteSurfelProgram(gl, this.program);
    this.program = undefined;
    this.map = undefined;
  }

  setDepthTest(enabled: boolean): void {
    this.depthTest = enabled;
    this.map?.triggerRepaint();
  }
}
