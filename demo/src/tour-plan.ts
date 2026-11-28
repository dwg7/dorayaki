/**
 * E029: route-aware loading for a camera tour. A tour's route is known before it plays (documents/director.md), so the tiles it will
 * want, and when, can be listed in advance: the player's own timeline sampled every `dt` seconds, the view's own budgeted selection at
 * each sample, each tile's deadline the first time it is wanted. The demo then fetches in deadline order (earliest deadline first)
 * from the moment the tour is planned, waits before playing until the link it measures can deliver everything in time, and keeps the
 * tour's tiles from being evicted while it plays. No DOM here: tested in test/tour-plan.test.ts.
 */
import { visibleBounds, type View } from "./camera.js";
import { selectBudgetedTiles } from "./mixed-selection.js";
import { buildTimeline, mapViewOf, sampleTimeline, type CameraState, type GroundAt, type Shot } from "./shot-player.js";
import type { TileAddress } from "../../src/tile-geometry.js";
import type { TileIndex } from "./tile-index.js";

export interface TourNeed {
  tile: TileAddress;
  key: string;
  /** Seconds into the tour when the tile is first wanted. */
  t: number;
  /** Known or guessed bytes. */
  bytes: number;
}

export interface TourPlanOptions {
  candidates: TileIndex | readonly TileAddress[];
  width: number;
  height: number;
  maxBytes: number;
  maxSplats: number;
  knownBytes: (t: TileAddress) => number | undefined;
  priorBytes: (zoom: number) => number;
  groundAt?: GroundAt;
  /** Sampling step in seconds (default 0.25). */
  dt?: number;
}

const keyOf = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;

/** The tiles a tour will want, earliest deadline first. */
export function planTour(shots: readonly Shot[], start: CameraState, o: TourPlanOptions): TourNeed[] {
  const timeline = buildTimeline(shots, start, o.height, o.groundAt);
  const dt = o.dt ?? 0.25;
  const seen = new Map<string, TourNeed>();
  for (let t = 0; t <= timeline.duration + 1e-9; t += dt) {
    const v = mapViewOf(sampleTimeline(timeline, t).camera, o.height);
    const view: View = { lng: v.center[0], lat: v.center[1], zoom: v.zoom, bearing: v.bearing, pitch: v.pitch, width: o.width, height: o.height, centreZ: v.elevation ?? o.groundAt?.(v.center[0], v.center[1]) ?? 0 };
    const want = selectBudgetedTiles(o.candidates, visibleBounds(view), view, { maxBytes: o.maxBytes, maxSplats: o.maxSplats, knownBytes: o.knownBytes, priorBytes: o.priorBytes });
    for (const tile of want) {
      const key = keyOf(tile);
      if (!seen.has(key)) seen.set(key, { tile, key, t, bytes: o.knownBytes(tile) ?? o.priorBytes(tile.z) });
    }
  }
  return [...seen.values()].sort((a, b) => a.t - b.t);
}

/**
 * Whether playing may start: with `rate` bytes per second still to come, every tile not yet in arrives by its deadline, counting the
 * bytes in deadline order (a link that serves the plan in order). `wait` is the seconds of waiting this would still need (0: play now).
 */
export function waitBeforePlaying(needs: readonly TourNeed[], have: (key: string) => boolean, rate: number): number {
  if (!(rate > 0)) return Infinity;
  let bytes = 0, wait = 0;
  for (const n of needs) {
    if (have(n.key)) continue;
    bytes += n.bytes;
    wait = Math.max(wait, bytes / rate - n.t);
  }
  return wait;
}

/**
 * The next tiles to request: in deadline order, skipping those held or in flight, at most `slots`, and not more than `aheadBytes` of
 * tiles fetched but not yet due (so a long tour does not fill memory far ahead of the camera).
 */
export function nextRequests(needs: readonly TourNeed[], tourTime: number, state: (key: string) => "have" | "inflight" | "none", slots: number, aheadBytes: number): TourNeed[] {
  const out: TourNeed[] = [];
  let ahead = 0;
  for (const n of needs) {
    if (out.length >= slots) break;
    const s = state(n.key);
    if (n.t > tourTime) ahead += n.bytes; // fetched or not, it is ahead of the camera
    if (s !== "none") continue;
    if (n.t > tourTime && ahead > aheadBytes) break;
    out.push(n);
  }
  return out;
}
