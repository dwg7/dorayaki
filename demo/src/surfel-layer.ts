/**
 * MapLibre custom-layer lifecycle for decoded surfels of one or more tiles.
 *
 * Only wires MapLibre's onAdd / render / onRemove to the GPU module, the
 * placement matrix, and tile selection (tile-selection.ts). Each tile keeps
 * its own buffers, model matrix and tile width; one shader program is
 * shared. Every frame it draws the tiles of one zoom, and a prefix of
 * progressive tiles, chosen from the current map zoom. Mercator projection only: it
 * uses defaultProjectionData.mainMatrix and does not support globe or
 * terrain.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";

import type { Splat } from "../../src/surfel-block.js";
import { tileWidthMetres, type TileAddress } from "../../src/tile-geometry.js";
import {
  createSurfelProgram,
  deleteSurfelBuffers,
  deleteSurfelProgram,
  drawSurfels,
  uploadSplats,
  type SurfelBuffers,
  type SurfelProgram,
} from "./gpu-surfels.js";
import { metricToMercatorMatrix, multiplyMat4, type Mat4 } from "./tile-matrix.js";
import { drawPlan, selectZoom, type TileDraw } from "./tile-selection.js";

export interface LayerTile {
  tile: TileAddress;
  splats: readonly Splat[];
  /** Level table; omitted means one level holding every surfel. */
  levels?: readonly number[];
}

/** What the last frame drew. */
export interface DrawSummary {
  zoom: number;
  tiles: number;
  surfels: number;
  levelsDrawn: number;
  minRadius: number;
}

interface TileState {
  tile: TileAddress;
  splats: readonly Splat[];
  levels: readonly number[];
  widthMetres: number;
  model: Mat4;
  buffers: SurfelBuffers | undefined;
}

export class SurfelLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  depthTest = true;
  /**
   * Debug aid: choose tiles and levels as if the map were at this zoom
   * (`?lod=` in the demo). Tile selection uses the map zoom by default, which
   * does not follow the camera's distance to the data (NOTES.md).
   */
  zoomOverride: number | undefined;

  private readonly tiles: TileState[];
  private map: MapLibreMap | undefined;
  private program: SurfelProgram | undefined;
  /** Summary of the most recent frame (for status display). */
  lastDraw: DrawSummary | undefined;
  /** Milliseconds spent creating the program and uploading every tile's buffers (onAdd). */
  uploadMs: number | undefined;
  /** CPU milliseconds of the most recent render() call (draw submission, not GPU time). */
  lastRenderMs: number | undefined;
  /** WebGL renderer string, when the browser exposes it. */
  gpu: string | undefined;

  constructor(id: string, tiles: readonly LayerTile[]) {
    this.id = id;
    this.tiles = tiles.map(({ tile, splats, levels }) => {
      const widthMetres = tileWidthMetres(tile);
      return {
        tile, splats, levels: levels ?? [splats.length], widthMetres,
        model: metricToMercatorMatrix(tile, widthMetres), buffers: undefined,
      };
    });
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const t0 = performance.now();
    this.program = createSurfelProgram(gl);
    for (const t of this.tiles) t.buffers = uploadSplats(gl, t.splats);
    gl.finish(); // include the driver's copy in the measurement
    this.uploadMs = performance.now() - t0;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.map) return;
    const t0 = performance.now();
    const displayZoom = this.zoomOverride ?? this.map.getZoom();
    const zoom = selectZoom(this.tiles.map((t) => t.tile.z), displayZoom);
    let drawn = 0, count = 0;
    let plan: TileDraw = { count: 0, levelsDrawn: 1, minRadius: 0 };
    for (const t of this.tiles) {
      if (!t.buffers || t.tile.z !== zoom) continue;
      plan = drawPlan(t, displayZoom);
      const matrix = Float32Array.from(multiplyMat4(options.defaultProjectionData.mainMatrix, t.model));
      drawSurfels(gl, this.program, t.buffers, {
        matrix,
        tileWidthMetres: t.widthMetres,
        count: plan.count,
        minRadius: plan.minRadius,
        depthTest: this.depthTest,
      });
      drawn++;
      count += plan.count;
    }
    this.lastDraw = { zoom, tiles: drawn, surfels: count, levelsDrawn: plan.levelsDrawn, minRadius: plan.minRadius };
    this.lastRenderMs = performance.now() - t0;
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
