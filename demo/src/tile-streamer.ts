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
import { viewTiles, type LngLatArray, type LngLatBoundsArray } from "./tile-view.js";

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
  /**
   * Choose the tiles to hold for a view instead of the tiles of one zoom: `maxZoom`, when given, asks for a set that
   * goes no finer than that (used for the staged first delivery). The zoom reported with a set is its finest tile's.
   */
  select?: (displayZoom: number, bounds: LngLatBoundsArray, maxZoom?: number) => TileAddress[];
  /** Show the next coarser zoom first when nothing has been delivered yet (default false). */
  staged?: boolean;
  /** Most tiles held at once, the nearest to the view's centre (default 9: a 3 x 3 block). */
  limit?: number;
  /**
   * Hand over what has arrived while a set is still loading, at most every this many milliseconds (off by default). Tiles of the
   * new set that are present are shown; a tile shown before stays while any new tile overlapping it is still on its way, so the
   * view has no hole (coarse and fine may overlap for a moment). Without it a set is shown only when complete, and a camera that
   * keeps moving while tiles take seconds to arrive shows nothing new at all (2026-11-27: a whole Sasebo tour over stars).
   */
  progressive?: number;
  /** Tiles kept after they leave the set (most recent first), so a camera coming back or a prefetch finds them (default 0). */
  cache?: number;
}

const key = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;
/** Whether two tiles cover any common ground (the same tile, or one inside the other). */
function overlaps(a: TileAddress, b: TileAddress): boolean {
  const [lo, hi] = a.z <= b.z ? [a, b] : [b, a];
  const d = hi.z - lo.z;
  return hi.x >> d === lo.x && hi.y >> d === lo.y;
}

export class TileStreamer<T> {
  private readonly zooms: number[];
  private readonly limit: number;
  private held = new Map<string, StreamedTile<T> | null>();
  /** Recently arrived tiles outside the present set (insertion order = age), up to `cache`. */
  private readonly recent = new Map<string, StreamedTile<T> | null>();
  /** The tiles handed over last. */
  private shown: Array<StreamedTile<T>> = [];
  private partialTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.recent.clear();
    this.shown = [];
    this.lastSignature = "";
    this.delivered = false;
  }

  /** A tile that has arrived (held or recent), or undefined. */
  private known(k: string): StreamedTile<T> | null | undefined {
    return this.held.has(k) ? this.held.get(k) : this.recent.get(k);
  }

  private remember(k: string, r: StreamedTile<T> | null): void {
    const max = this.opts.cache ?? 0;
    if (max <= 0 && !this.protectedKeys.has(k)) return;
    this.recent.delete(k);
    this.recent.set(k, r);
    this.trim();
  }

  /** The oldest recent tiles go first beyond the cache size, except tiles protected for a tour (E029). */
  private trim(): void {
    const max = this.opts.cache ?? 0;
    if (this.recent.size <= max) return;
    for (const old of [...this.recent.keys()]) {
      if (this.recent.size <= max) break;
      if (!this.protectedKeys.has(old)) this.recent.delete(old);
    }
  }

  /** Tiles kept beyond the cache size until `protect` is called again (E029: the tiles of a tour that is playing). */
  private protectedKeys = new Set<string>();
  protect(keys: Iterable<string>): void {
    this.protectedKeys = new Set(keys);
    this.trim();
  }

  /** Whether a tile has arrived, is on its way, or neither (E029's scheduler). */
  state(k: string): "have" | "inflight" | "none" {
    return this.known(k) !== undefined ? "have" : this.inflight.has(k) ? "inflight" : "none";
  }

  /** Loads on their way. */
  get inflightCount(): number {
    return this.inflight.size;
  }

  /** Start loading these tiles now (E029), whatever their number; held, recent and in-flight ones are skipped. */
  request(tiles: readonly TileAddress[]): void {
    for (const t of tiles) if (this.state(key(t)) === "none") void this.loadOne(t);
  }

  /** Start one load (or join the one in flight); the result is remembered as soon as it arrives. */
  private loadOne(t: TileAddress): Promise<StreamedTile<T> | null> {
    const k = key(t);
    let p = this.inflight.get(k);
    if (!p) {
      p = this.opts.load(t).then((data) => {
        const r = data === null ? null : { tile: t, data };
        this.inflight.delete(k);
        this.remember(k, r);
        return r;
      });
      this.inflight.set(k, p);
    }
    return p;
  }

  /** Fetch the tiles (reusing held, recent and in-flight ones); `arrived` is called once per tile as it becomes available. */
  private fetchSet(wanted: readonly TileAddress[], arrived?: () => void): Promise<Array<StreamedTile<T> | null>> {
    return Promise.all(wanted.map((t) => {
      const have = this.known(key(t));
      if (have !== undefined) { arrived?.(); return Promise.resolve(have); }
      return this.loadOne(t).then((r) => { this.held.set(key(t), r); arrived?.(); return r; }); // held at once, for progressive delivery
    }));
  }

  /** Load tiles ahead of need (e.g. where a camera tour is going), without showing them; at most `max` new loads. */
  prefetch(tiles: readonly TileAddress[], max = 8): number {
    let started = 0;
    for (const t of tiles) {
      if (started >= max) break;
      const k = key(t);
      if (this.known(k) !== undefined || this.inflight.has(k)) continue;
      void this.loadOne(t);
      started++;
    }
    return started;
  }

  /** What to show while `wanted` is incomplete: its tiles that have arrived, and earlier tiles still covering ones that have not. */
  private partialOf(wanted: readonly TileAddress[]): Array<StreamedTile<T>> {
    const arrived: Array<StreamedTile<T>> = [];
    const pending: TileAddress[] = [];
    for (const t of wanted) {
      const r = this.known(key(t));
      if (r === undefined) pending.push(t);
      else if (r !== null) arrived.push(r);
    }
    const taken = new Set(arrived.map((r) => key(r.tile)));
    const keep = this.shown.filter((s) => !taken.has(key(s.tile)) && pending.some((t) => overlaps(s.tile, t)));
    return [...arrived, ...keep];
  }

  /**
   * Ask for the tiles of the zoom selected for `displayZoom` that intersect `bounds`; when there are more than `limit`,
   * keep those nearest to `centre` (the point the map looks at; default: the centre of `bounds`).
   */
  update(displayZoom: number, bounds: LngLatBoundsArray, centre?: LngLatArray): void {
    const wanted = this.opts.select
      ? this.opts.select(displayZoom, bounds)
      : viewTiles(this.opts.candidates, selectZoom(this.zooms, displayZoom), bounds, this.limit, centre);
    const zoom = this.opts.select ? Math.max(-Infinity, ...wanted.map((t) => t.z)) : selectZoom(this.zooms, displayZoom);
    const signature = wanted.map(key).join(",");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    const generation = ++this.generation;
    let done = 0;
    this.opts.onProgress?.({ zoom, wanted: wanted.length, done });

    // First delivery: the next coarser zoom of this view, if the target is still loading when it arrives.
    const stageZoom = this.opts.staged && !this.delivered ? Math.max(-Infinity, ...this.zooms.filter((z) => z < zoom)) : -Infinity;
    if (Number.isFinite(stageZoom)) {
      const stage = this.opts.select ? this.opts.select(displayZoom, bounds, stageZoom) : viewTiles(this.opts.candidates, stageZoom, bounds, this.limit, centre);
      void this.fetchSet(stage).then((results) => {
        for (const [i, t] of stage.entries()) { this.inflight.delete(key(t)); this.held.set(key(t), results[i] ?? null); }
        if (generation !== this.generation || this.delivered) return; // superseded, or the target set got there first
        this.delivered = true;
        this.opts.onReady(results.filter((r): r is StreamedTile<T> => r !== null), stageZoom);
      });
    }

    if (this.partialTimer !== undefined) { clearTimeout(this.partialTimer); this.partialTimer = undefined; }
    void this.fetchSet(wanted, () => {
      if (generation !== this.generation) return;
      this.opts.onProgress?.({ zoom, wanted: wanted.length, done: ++done });
      const every = this.opts.progressive;
      if (every !== undefined && done < wanted.length && this.partialTimer === undefined) {
        this.partialTimer = setTimeout(() => {
          this.partialTimer = undefined;
          if (generation !== this.generation) return;
          const set = this.partialOf(wanted);
          if (set.length === 0) return;
          this.shown = set;
          this.delivered = true;
          this.opts.onReady(set, zoom);
        }, every);
      }
    }).then((results) => {
      for (const [i, t] of wanted.entries()) {
        this.inflight.delete(key(t));
        this.held.set(key(t), results[i] ?? null);
      }
      if (generation !== this.generation) return; // superseded: a newer request will deliver
      if (this.partialTimer !== undefined) { clearTimeout(this.partialTimer); this.partialTimer = undefined; }
      const next = new Map<string, StreamedTile<T> | null>();
      for (const [i, t] of wanted.entries()) next.set(key(t), results[i] ?? null);
      for (const [k, r] of this.held) if (!next.has(k)) this.remember(k, r); // tiles outside the new set leave the set, into the cache
      this.held = next;
      this.delivered = true;
      this.shown = results.filter((r): r is StreamedTile<T> => r !== null);
      this.opts.onReady(this.shown, zoom);
    });
  }
}
