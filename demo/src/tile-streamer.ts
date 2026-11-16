/**
 * Loads the tiles of the selected zoom that are in view, and hands the whole
 * set over at once when every tile of it has arrived, so the layer keeps drawing
 * the previous set (no holes) until then. With `staged`, the very first
 * delivery (nothing drawn yet, or after `reset`) is preceded by the next coarser
 * zoom's tiles of the same view, which are smaller and arrive sooner, so the
 * view is not empty while the target zoom loads. A newer request supersedes an older
 * one; tiles already in flight or already held are reused. No DOM, network or
 * WebGL here: the caller supplies how to load one tile (and gets null for a
 * tile that does not exist).
 */
import type { TileAddress } from "../../src/tile-geometry.js";
import { selectZoom } from "./tile-selection.js";
import { viewTiles, type LngLatBoundsArray } from "./tile-view.js";

export interface StreamedTile<T> { tile: TileAddress; data: T }

export interface TileStreamerOptions<T> {
  /** Every tile that may exist (from the TileJSON or the fixture). */
  candidates: readonly TileAddress[];
  /** Load one tile; null when it does not exist. */
  load: (tile: TileAddress) => Promise<T | null>;
  /** Called with the complete set for the latest request. */
  onReady: (tiles: Array<StreamedTile<T>>, zoom: number) => void;
  /** Called when a request starts and whenever one of its tiles arrives. */
  onProgress?: (info: { zoom: number; wanted: number; done: number }) => void;
  /** Show the next coarser zoom first when nothing has been delivered yet (default false). */
  staged?: boolean;
  /** Most tiles held at once, the nearest to the view's centre (default 9: a 3 x 3 block). */
  limit?: number;
}

const key = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;

export class TileStreamer<T> {
  private readonly zooms: number[];
  private readonly limit: number;
  private held = new Map<string, StreamedTile<T> | null>();
  private readonly inflight = new Map<string, Promise<StreamedTile<T> | null>>();
  private generation = 0;
  private lastSignature = "";
  /** Whether any set has been handed over since the start or the last reset. */
  private delivered = false;

  constructor(private readonly opts: TileStreamerOptions<T>) {
    this.zooms = [...new Set(opts.candidates.map((t) => t.z))];
    this.limit = opts.limit ?? 9;
  }

  /** Forget everything held (the consumer lost its copies, e.g. after a lost WebGL context); the next update reloads. */
  reset(): void {
    this.held = new Map();
    this.lastSignature = "";
    this.delivered = false;
  }

  /** Fetch the tiles (reusing held and in-flight ones); `arrived` is called once per tile as it becomes available. */
  private fetchSet(wanted: readonly TileAddress[], arrived?: () => void): Promise<Array<StreamedTile<T> | null>> {
    return Promise.all(wanted.map((t) => {
      const k = key(t);
      if (this.held.has(k)) { arrived?.(); return Promise.resolve(this.held.get(k)!); }
      let p = this.inflight.get(k);
      if (!p) {
        p = this.opts.load(t).then((data) => (data === null ? null : { tile: t, data }));
        this.inflight.set(k, p);
      }
      return p.then((r) => { arrived?.(); return r; });
    }));
  }

  /** Ask for the tiles of the zoom selected for `displayZoom` that intersect `bounds`. */
  update(displayZoom: number, bounds: LngLatBoundsArray): void {
    const zoom = selectZoom(this.zooms, displayZoom);
    const wanted = viewTiles(this.opts.candidates, zoom, bounds, this.limit);
    const signature = wanted.map(key).join(",");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    const generation = ++this.generation;
    let done = 0;
    this.opts.onProgress?.({ zoom, wanted: wanted.length, done });

    // First delivery: the next coarser zoom of this view, if the target is still loading when it arrives.
    const stageZoom = this.opts.staged && !this.delivered ? Math.max(-Infinity, ...this.zooms.filter((z) => z < zoom)) : -Infinity;
    if (Number.isFinite(stageZoom)) {
      const stage = viewTiles(this.opts.candidates, stageZoom, bounds, this.limit);
      void this.fetchSet(stage).then((results) => {
        for (const [i, t] of stage.entries()) { this.inflight.delete(key(t)); this.held.set(key(t), results[i] ?? null); }
        if (generation !== this.generation || this.delivered) return; // superseded, or the target set got there first
        this.delivered = true;
        this.opts.onReady(results.filter((r): r is StreamedTile<T> => r !== null), stageZoom);
      });
    }

    void this.fetchSet(wanted, () => {
      if (generation === this.generation) this.opts.onProgress?.({ zoom, wanted: wanted.length, done: ++done });
    }).then((results) => {
      for (const [i, t] of wanted.entries()) {
        this.inflight.delete(key(t));
        this.held.set(key(t), results[i] ?? null);
      }
      if (generation !== this.generation) return; // superseded: a newer request will deliver
      const next = new Map<string, StreamedTile<T> | null>();
      for (const [i, t] of wanted.entries()) next.set(key(t), results[i] ?? null);
      this.held = next; // tiles outside the new set are dropped
      this.delivered = true;
      this.opts.onReady(results.filter((r): r is StreamedTile<T> => r !== null), zoom);
    });
  }
}
