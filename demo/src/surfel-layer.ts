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

import type { PackedBlock, Splat } from "../../src/surfel-block.js";
import { tileWidthMetres, type TileAddress } from "../../src/tile-geometry.js";
import {
  createSurfelProgram,
  deleteSurfelBuffers,
  deleteSurfelProgram,
  drawSurfels,
  uploadInstances,
  uploadPacked,
  uploadSplats,
  type SurfelBuffers,
  type SurfelProgram,
} from "./gpu-surfels.js";
import type { SplatInstances } from "./splat-instances.js";
import { metricToMercatorMatrix, multiplyMat4, type Mat4 } from "./tile-matrix.js";
import { drawPlan, selectZoom, type TileDraw } from "./tile-selection.js";

export interface LayerTile {
  tile: TileAddress;
  /** The tile's contents: decoded splats, or instance data already built from them (smaller to hold). */
  splats?: readonly Splat[];
  instances?: SplatInstances;
  /** Or the block's 16-byte records, uploaded as they are and decoded in the vertex shader (the smallest form on the GPU). */
  packed?: Pick<PackedBlock, "count" | "records" | "zOrigin" | "zStep" | "recordBytes" | "scaleLog2Min">;
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
  /** Drawn with the program that decodes packed records of this many bytes (0: float attributes). */
  packed: 0 | 16 | 12;
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
  /**
   * Draw every tile handed over, whatever its zoom (`?mixed=1`: the streamer already chose the tiles by distance,
   * mixed-selection.ts). Off: draw the tiles of the one zoom picked from the map zoom.
   */
  drawAllTiles = false;
  /**
   * `"soft"` (`?look=soft`, E018): every splat is drawn twice, an opaque core that carries the depth, then a larger
   * Gaussian-feathered blended splat on top, so neighbours melt into each other. `"flat"`: opaque ellipses.
   */
  look: "flat" | "soft" = "flat";
  /** Soft look: the core's scale and the feathered splat's scale, as factors on the semi-axes. */
  coreScale = 0.8;
  softScale = 1.4;
  /** Soft look: exponent of the Gaussian falloff over the feathered quad (3.5 = Gaussian at 2.7 sigma across). */
  softFalloff = 3.5;
  /** Factor on every splat's semi-axes (`?extent=` in the demo); 1 draws the 2-sigma ellipse. */
  extent = 1;

  private tiles: TileState[] = [];
  /** Tiles handed over by setTiles, applied at the start of the next render (uploads need the GL context). */
  private pending: readonly LayerTile[] | undefined;
  private zOffset = 0;
  private map: MapLibreMap | undefined;
  private program: SurfelProgram | undefined;
  private packedProgram: SurfelProgram | undefined;
  private packed12Program: SurfelProgram | undefined;
  /** Summary of the most recent frame (for status display). */
  lastDraw: DrawSummary | undefined;
  /** Milliseconds spent creating the program and uploading tiles' buffers, summed over every upload. */
  uploadMs: number | undefined;
  /** CPU milliseconds of the most recent render() call (draw submission, not GPU time). */
  lastRenderMs: number | undefined;
  /** WebGL renderer string, when the browser exposes it. */
  gpu: string | undefined;

  constructor(id: string, tiles: readonly LayerTile[] = []) {
    this.id = id;
    this.pending = tiles;
  }

  /**
   * Replace the drawn tiles. Tiles already present (same address) keep their
   * GPU buffers; others are uploaded, and those no longer listed are freed. The
   * change happens at the start of the next frame.
   */
  setTiles(tiles: readonly LayerTile[]): void {
    this.pending = tiles;
    this.map?.triggerRepaint();
  }

  private applyPending(gl: WebGL2RenderingContext): void {
    const next = this.pending;
    if (!next) return;
    this.pending = undefined;
    const t0 = performance.now();
    const address = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;
    const have = new Map(this.tiles.map((t) => [address(t.tile), t]));
    const states = next.map(({ tile, splats, instances, packed, levels }): TileState => {
      const kept = have.get(address(tile));
      if (kept) { have.delete(address(tile)); return kept; }
      const widthMetres = tileWidthMetres(tile);
      const model = metricToMercatorMatrix(tile, widthMetres);
      if (this.zOffset) model[14] = this.zOffset * model[10]!;
      // The decoded splats are only needed for the upload; the state keeps none.
      const count = packed ? packed.count : instances ? instances.count : (splats ?? []).length;
      const buffers = packed
        ? uploadPacked(gl, packed.records, packed.count, packed.zOrigin, packed.zStep, packed.recordBytes, packed.scaleLog2Min)
        : instances ? uploadInstances(gl, instances) : uploadSplats(gl, splats ?? []);
      return { tile, splats: [], levels: levels ?? [count], widthMetres, model, buffers, packed: packed ? packed.recordBytes : 0 };
    });
    for (const gone of have.values()) if (gone.buffers) deleteSurfelBuffers(gl, gone.buffers);
    this.tiles = states;
    gl.finish(); // include the driver's copy in the measurement
    this.uploadMs = (this.uploadMs ?? 0) + (performance.now() - t0);
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const t0 = performance.now();
    this.program = createSurfelProgram(gl);
    this.packedProgram = createSurfelProgram(gl, 16);
    this.packed12Program = createSurfelProgram(gl, 12);
    this.uploadMs = performance.now() - t0;
    this.applyPending(gl);
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.packedProgram || !this.packed12Program || !this.map) return;
    this.applyPending(gl);
    const t0 = performance.now();
    const displayZoom = this.zoomOverride ?? this.map.getZoom();
    if (this.tiles.length === 0) return;
    const zoom = selectZoom(this.tiles.map((t) => t.tile.z), displayZoom);
    let drawn = 0, count = 0;
    let plan: TileDraw = { count: 0, levelsDrawn: 1, minRadius: 0 };
    const passes: Array<{ pass: "flat" | "core" | "soft"; scale: number }> = this.look === "soft"
      ? [{ pass: "core", scale: this.coreScale }, { pass: "soft", scale: this.softScale }]
      : [{ pass: "flat", scale: 1 }];
    for (const [pi, { pass, scale }] of passes.entries()) {
      for (const t of this.tiles) {
        if (!t.buffers || (!this.drawAllTiles && t.tile.z !== zoom)) continue;
        plan = drawPlan(t, displayZoom);
        const matrix = Float32Array.from(multiplyMat4(options.defaultProjectionData.mainMatrix, t.model));
        const program = t.packed === 16 ? this.packedProgram : t.packed === 12 ? this.packed12Program : this.program;
        if (!program) continue;
        drawSurfels(gl, program, t.buffers, {
          matrix,
          tileWidthMetres: t.widthMetres,
          count: plan.count,
          minRadius: plan.minRadius,
          extent: this.extent * scale,
          depthTest: this.depthTest,
          pass,
          falloff: this.softFalloff,
        });
        if (pi === 0) { drawn++; count += plan.count; }
      }
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
    if (this.packedProgram) deleteSurfelProgram(gl, this.packedProgram);
    if (this.packed12Program) deleteSurfelProgram(gl, this.packed12Program);
    this.program = undefined;
    this.packedProgram = undefined;
    this.packed12Program = undefined;
    this.map = undefined;
  }

  /** Debug aid (`?dz=`): raise every tile by `metres`, to test data at high elevation. */
  setZOffset(metres: number): void {
    this.zOffset = metres;
    for (const t of this.tiles) {
      t.model = metricToMercatorMatrix(t.tile, t.widthMetres);
      t.model[14] = metres * t.model[10]!; // z translation in Mercator units: s metres
    }
    this.map?.triggerRepaint();
  }

  setDepthTest(enabled: boolean): void {
    this.depthTest = enabled;
    this.map?.triggerRepaint();
  }
}
