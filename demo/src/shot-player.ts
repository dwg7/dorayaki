/**
 * Shot player, step 1 of documents/demo.md: a hand-written shot script (pure JSON data) played as a camera
 * on the map, interruptible by any manual input. The pure part (reading the script, turning shots into a timeline,
 * easing, sampling) has no DOM or WebGL and is tested in test/shot-player.test.ts; `playShots` at the end drives a map
 * with requestAnimationFrame and `jumpTo` every frame.
 *
 * The camera is the MapLibre approximation, not FreeCameraOptions: the map centre is the look-at point, and the camera
 * stands `distance` metres from it, `pitch` degrees from straight down, on the side opposite `bearing`. The camera
 * path and the look-at path are kept apart: each shot moves the look-at point and the camera's place relative to it
 * separately. Conversions between metres and zoom use camera.ts (`distanceForZoom`, `zoomForDistance`); assumptions:
 *
 * - `alt_m` is the camera's height above the look-at point (distance x cos pitch). With terrain, MapLibre puts the
 *   look-at point on the ground, so this is the height above the ground at the subject, not above the ground under
 *   the camera (camera-clearance.ts watches that one).
 * - `radius_m` is the horizontal stand-off (distance x sin pitch); `range_m` is the straight distance to the look-at point.
 * - With terrain, MapLibre keeps the look-at point on the ground under it every frame (`centerClampedToGround`), so a
 *   look-at point that travels over hills and the harbour lifted and dropped the whole camera with every bump (hfu,
 *   2026-11-26: "it wobbles in height as if it followed the terrain"). While playing, the player sets the look-at
 *   point's height itself: the ground at the start and at the end of each shot, interpolated with the shot's easing
 *   in between, and gives it to `jumpTo` as `elevation`; the map's own clamping is switched off and restored at the end.
 * - A shot that does not give a quantity keeps the one the camera already has (the end of the previous shot, or the
 *   map's view when playing starts). A shot whose look-at point differs from where the camera is pointed starts with a
 *   cut, except `traverse`, which travels.
 */
import { distanceForZoom, zoomForDistance } from "./camera.js";

export interface LngLat { lng: number; lat: number }

/** A camera as the player moves it: the look-at point and the camera's place relative to it. */
export interface CameraState {
  lng: number;
  lat: number;
  /** Metres from the camera to the look-at point. */
  distance: number;
  /** Degrees from straight down. */
  pitch: number;
  /** Degrees clockwise from north. */
  bearing: number;
  /** Height of the look-at point above sea level, metres, when the player sets it (terrain on); absent: the map's own. */
  elevation?: number;
}

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";
const EASINGS: Readonly<Record<Easing, (u: number) => number>> = {
  linear: (u) => u,
  easeIn: (u) => u * u * u,
  easeOut: (u) => 1 - (1 - u) ** 3,
  easeInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};
/** The easing on shot progress u in [0, 1] (clamped). */
export function ease(easing: Easing, u: number): number {
  return EASINGS[easing](Math.min(1, Math.max(0, u)));
}

/** How a shot states where the camera stands; any subset (see the file comment for the meaning of each). */
export interface CameraSpec { zoom?: number; pitch?: number; bearing?: number; alt_m?: number; radius_m?: number; range_m?: number }

interface ShotBase { duration_s: number; easing: Easing }
export interface HoldShot extends ShotBase { type: "hold"; look_at: LngLat; camera: CameraSpec }
export interface CraneShot extends ShotBase { type: "crane"; look_at: LngLat; from: { alt_m?: number }; to: { alt_m: number } }
export interface TraverseShot extends ShotBase { type: "traverse"; from_look_at?: LngLat; to_look_at: LngLat; camera: CameraSpec }
export interface OrbitShot extends ShotBase { type: "orbit"; look_at: LngLat; camera: CameraSpec; sweep_deg: number }
export interface DollyShot extends ShotBase { type: "dolly"; look_at: LngLat; to: { range_m: number } }
export type Shot = HoldShot | CraneShot | TraverseShot | OrbitShot | DollyShot;

export interface ShotScript { shots: Shot[]; warnings: string[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Reads a shot script (parsed JSON). Throws on anything it cannot play (an unknown or unsupported type such as `track`,
 * a missing look-at point, a duration that is not a positive number, a value that is not a number); keys it does not
 * use (`intent`, `subject`, `_note`, ...) are ignored. `warnings` lists what it plays differently from what the script says.
 */
export function parseShotScript(json: unknown): ShotScript {
  if (!isObject(json) || !Array.isArray(json.shots)) throw new Error("a shot script is an object with a `shots` array");
  const warnings: string[] = [];
  const shots = json.shots.map((raw, i): Shot => {
    const where = `shot ${i + 1}`;
    if (!isObject(raw)) throw new Error(`${where}: not an object`);
    const num = (o: Record<string, unknown>, k: string, required = false): number | undefined => {
      const v = o[k];
      if (v === undefined && !required) return undefined;
      if (!finite(v)) throw new Error(`${where}: ${k} must be a number`);
      return v;
    };
    const point = (k: string, required: boolean): LngLat | undefined => {
      const v = raw[k];
      if (v === undefined && !required) return undefined;
      if (!isObject(v) || !finite(v.lng) || !finite(v.lat)) throw new Error(`${where}: ${k} must be { lng, lat }`);
      return { lng: v.lng, lat: v.lat };
    };
    const spec = (k: string): CameraSpec => {
      const v = raw[k] ?? {};
      if (!isObject(v)) throw new Error(`${where}: ${k} must be an object`);
      const out: CameraSpec = {};
      for (const f of ["zoom", "pitch", "bearing", "alt_m", "radius_m", "range_m"] as const) {
        const x = num(v, f);
        if (x !== undefined) out[f] = x;
      }
      return out;
    };
    const duration_s = num(raw, "duration_s", true)!;
    if (!(duration_s > 0)) throw new Error(`${where}: duration_s must be positive`);
    const easing = (raw.easing ?? "easeInOut") as Easing;
    if (!(easing in EASINGS)) throw new Error(`${where}: easing must be one of ${Object.keys(EASINGS).join(", ")}`);
    const base = { duration_s, easing };
    switch (raw.type) {
      case "hold":
        return { ...base, type: "hold", look_at: point("look_at", true)!, camera: spec("camera") };
      case "crane": {
        const from = spec("from"), to = spec("to");
        if (to.alt_m === undefined) throw new Error(`${where}: crane needs to.alt_m`);
        return { ...base, type: "crane", look_at: point("look_at", true)!, from: from.alt_m !== undefined ? { alt_m: from.alt_m } : {}, to: { alt_m: to.alt_m } };
      }
      case "traverse": {
        const from = point("from_look_at", false);
        return { ...base, type: "traverse", ...(from ? { from_look_at: from } : {}), to_look_at: point("to_look_at", true)!, camera: spec("camera") };
      }
      case "orbit": {
        const camera = spec("camera");
        if (camera.alt_m !== undefined && camera.radius_m !== undefined && camera.pitch !== undefined) {
          const implied = (Math.atan2(camera.radius_m, camera.alt_m) * 180) / Math.PI;
          if (Math.abs(implied - camera.pitch) > 0.5) {
            warnings.push(`${where}: orbit gives alt_m ${camera.alt_m}, radius_m ${camera.radius_m} and pitch ${camera.pitch}; the camera stands at that height and radius, which looks down at ${implied.toFixed(1)} degrees, so pitch is not used`);
          }
        }
        return { ...base, type: "orbit", look_at: point("look_at", true)!, camera, sweep_deg: num(raw, "sweep_deg") ?? 360 };
      }
      case "dolly": {
        const to = spec("to");
        if (to.range_m === undefined || !(to.range_m > 0)) throw new Error(`${where}: dolly needs a positive to.range_m`);
        return { ...base, type: "dolly", look_at: point("look_at", true)!, to: { range_m: to.range_m } };
      }
      default:
        throw new Error(`${where}: type ${JSON.stringify(raw.type)} is not played (hold, crane, traverse, orbit and dolly are)`);
    }
  });
  return { shots, warnings };
}

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Distances are interpolated on a log scale, so a move in or out runs at an even zoom rate. */
const lerpLog = (a: number, b: number, t: number): number => a * (b / a) ** t;
/** Bearing from a toward b the short way round. */
const lerpBearing = (a: number, b: number, t: number): number => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const horizontal = (c: CameraState): number => c.distance * Math.sin(c.pitch * DEG);
const altitude = (c: CameraState): number => c.distance * Math.cos(c.pitch * DEG);

/** Where the camera stands for a spec, around `look`, keeping from `base` what the spec does not give. */
export function resolveCamera(spec: CameraSpec, base: CameraState, look: LngLat, heightPx: number): CameraState {
  let pitch = spec.pitch ?? base.pitch;
  let distance = base.distance;
  if (spec.zoom !== undefined) distance = distanceForZoom(spec.zoom, heightPx, look.lat);
  else if (spec.range_m !== undefined) distance = spec.range_m;
  else if (spec.alt_m !== undefined && spec.radius_m !== undefined) {
    distance = Math.hypot(spec.alt_m, spec.radius_m);
    pitch = Math.atan2(spec.radius_m, spec.alt_m) / DEG;
  } else if (spec.alt_m !== undefined) distance = spec.alt_m / Math.max(Math.cos(pitch * DEG), 1e-6);
  else if (spec.radius_m !== undefined) distance = spec.radius_m / Math.max(Math.sin(pitch * DEG), 1e-6);
  return { lng: look.lng, lat: look.lat, distance, pitch, bearing: spec.bearing ?? base.bearing };
}

/** How much farther than the straight interpolation a traverse pulls back at its middle (0.5: half as far again). */
export const TRAVERSE_PULL_BACK = 0.5;

export interface TimelineSegment {
  shot: Shot;
  /** Seconds from the start of the script. */
  start: number;
  duration: number;
  /** The camera at shot progress u in [0, 1], before easing (the segment applies the shot's easing). */
  at: (u: number) => CameraState;
}
export interface Timeline { segments: TimelineSegment[]; duration: number; start: CameraState; end: CameraState }

/** Ground height at a point (metres above sea level), when known. */
export type GroundAt = (lng: number, lat: number) => number | null | undefined;

/**
 * The shots as one timeline, starting from `start` (the map's camera when playing begins), for a canvas `heightPx` tall.
 * With `groundAt`, every frame carries the look-at point's height: the ground at the shot's first and last look-at point,
 * interpolated with the shot's easing (a shot whose look-at point stays has one height), so the camera does not ride the
 * terrain between them. Where the ground is not known, the height carries over from the frame before.
 */
export function buildTimeline(shots: readonly Shot[], start: CameraState, heightPx: number, groundAt?: GroundAt): Timeline {
  const segments: TimelineSegment[] = [];
  let prev = start;
  let t = 0;
  for (const shot of shots) {
    const e = (u: number): number => ease(shot.easing, u);
    let at: (u: number) => CameraState;
    switch (shot.type) {
      case "hold": {
        const c = resolveCamera(shot.camera, prev, shot.look_at, heightPx);
        at = () => c;
        break;
      }
      case "crane": {
        // Rise or descend at the horizontal stand-off and bearing the camera has, holding the subject.
        const h = horizontal(prev), bearing = prev.bearing;
        const a0 = shot.from.alt_m ?? altitude(prev), a1 = shot.to.alt_m;
        at = (u) => {
          const a = lerp(a0, a1, e(u));
          return { ...shot.look_at, distance: Math.hypot(h, a), pitch: Math.atan2(h, a) / DEG, bearing };
        };
        break;
      }
      case "traverse": {
        // The look-at point travels from A to B; the camera eases to its end place and pulls back in the middle.
        const a = shot.from_look_at ?? { lng: prev.lng, lat: prev.lat };
        const from = { ...prev, ...a };
        const to = resolveCamera(shot.camera, prev, shot.to_look_at, heightPx);
        at = (u) => {
          const k = e(u);
          return {
            lng: lerp(from.lng, to.lng, k), lat: lerp(from.lat, to.lat, k),
            distance: lerpLog(from.distance, to.distance, k) * (1 + TRAVERSE_PULL_BACK * Math.sin(Math.PI * k)),
            pitch: lerp(from.pitch, to.pitch, k), bearing: lerpBearing(from.bearing, to.bearing, k),
          };
        };
        break;
      }
      case "orbit": {
        // Circle at a fixed radius and height from the bearing the camera has (a cut into that radius and height).
        const c = resolveCamera(shot.camera, prev, shot.look_at, heightPx);
        const b0 = prev.bearing;
        at = (u) => ({ ...c, bearing: b0 + shot.sweep_deg * e(u) });
        break;
      }
      case "dolly": {
        // Along the view axis: pitch and bearing stay, the distance goes to range_m.
        const { distance: d0, pitch, bearing } = prev; // copied now: `prev` moves on to the next shot
        at = (u) => ({ ...shot.look_at, distance: lerpLog(d0, shot.to.range_m, e(u)), pitch, bearing });
        break;
      }
    }
    if (groundAt) {
      const flat = at;
      const a = flat(0), b = flat(1);
      const sameAsBefore = a.lng === prev.lng && a.lat === prev.lat;
      const e0 = (sameAsBefore ? prev.elevation : undefined) ?? groundAt(a.lng, a.lat) ?? prev.elevation ?? 0;
      const e1 = a.lng === b.lng && a.lat === b.lat ? e0 : groundAt(b.lng, b.lat) ?? e0;
      at = (u) => ({ ...flat(u), elevation: lerp(e0, e1, e(u)) });
    }
    segments.push({ shot, start: t, duration: shot.duration_s, at });
    t += shot.duration_s;
    prev = at(1);
  }
  return { segments, duration: t, start, end: prev };
}

/** The camera at `time` seconds into the timeline (before the start: the first shot's start; after the end: the last frame). */
export function sampleTimeline(timeline: Timeline, time: number): { camera: CameraState; index: number } {
  const { segments } = timeline;
  if (segments.length === 0) return { camera: timeline.start, index: -1 };
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (time < s.start + s.duration || i === segments.length - 1) {
      return { camera: s.at((time - s.start) / s.duration), index: i };
    }
  }
  return { camera: timeline.end, index: segments.length - 1 };
}

/** The MapLibre view for a camera on a canvas `heightPx` tall; pitch is kept within [0, maxPitch]. */
export function mapViewOf(camera: CameraState, heightPx: number, maxPitch = 85): MapView {
  return {
    center: [camera.lng, camera.lat],
    zoom: zoomForDistance(camera.distance, heightPx, camera.lat),
    pitch: Math.min(maxPitch, Math.max(0, camera.pitch)),
    bearing: camera.bearing,
    ...(camera.elevation !== undefined ? { elevation: camera.elevation } : {}),
  };
}
/** The options `jumpTo` gets; `elevation` (the look-at point's height) only when the player sets it. */
export interface MapView { center: [number, number]; zoom: number; pitch: number; bearing: number; elevation?: number }

/** The camera of a MapLibre view (the inverse of `mapViewOf`, for the starting point). */
export function cameraOfMapView(view: { lng: number; lat: number; zoom: number; pitch: number; bearing: number; elevation?: number }, heightPx: number): CameraState {
  return {
    lng: view.lng, lat: view.lat, distance: distanceForZoom(view.zoom, heightPx, view.lat), pitch: view.pitch, bearing: view.bearing,
    ...(view.elevation !== undefined ? { elevation: view.elevation } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------- driver

/** What the driver needs of a MapLibre map. */
export interface PlayerMap {
  jumpTo(options: MapView): unknown;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getPitch(): number;
  getBearing(): number;
  getMaxPitch(): number;
  getCanvas(): { clientHeight: number };
  /** With terrain (MapLibre): the look-at point's height, the ground at a point, and the switch that keeps the look-at point on the ground. */
  getCenterElevation?(): number;
  queryTerrainElevation?(lngLat: { lng: number; lat: number }): number | null | undefined;
  getTerrain?(): unknown;
  getCenterClampedToGround?(): boolean;
  setCenterClampedToGround?(clamped: boolean): void;
  getContainer(): { addEventListener(type: string, listener: (event: { target: unknown }) => void, options?: { capture?: boolean }): void; removeEventListener(type: string, listener: (event: { target: unknown }) => void, options?: { capture?: boolean }): void };
}

export interface PlayOptions {
  /** Called when a shot starts (index into the script's shots). */
  onShot?: (index: number, shot: Shot) => void;
  /** Called once when playing ends: "done", "user" (manual input) or "stopped" (the returned stop()). */
  onEnd?: (reason: "done" | "user" | "stopped") => void;
  /** Called every frame with the seconds played and the script's length. */
  onFrame?: (time: number, duration: number) => void;
  /**
   * Where the camera will be: called about every `aheadEvery` ms (default 500) with the map views `ahead` seconds from now
   * (default 1.5 and 3, within the script), so tiles can be loaded before the camera gets there.
   */
  onAhead?: (views: MapView[]) => void;
  ahead?: readonly number[];
  aheadEvery?: number;
  /** Input that does not take the camera back (the player's own control sits inside the map's container). */
  ignoreInput?: (event: { target: unknown }) => boolean;
  /** The frame clock (default: the browser's requestAnimationFrame); tests pass their own. */
  frames?: FrameClock;
}

export interface FrameClock { request(callback: (now: number) => void): number; cancel(id: number): void }
/** requestAnimationFrame, reached through globalThis so this module also compiles where there is no DOM (the tests). */
const browserFrames: FrameClock = {
  request: (callback) => (globalThis as unknown as { requestAnimationFrame(cb: (now: number) => void): number }).requestAnimationFrame(callback),
  cancel: (id) => (globalThis as unknown as { cancelAnimationFrame(id: number): void }).cancelAnimationFrame(id),
};

/** Manual input that takes the camera back. */
const INTERRUPTS = ["pointerdown", "wheel", "touchstart", "keydown"] as const;

/**
 * Plays the script on the map from the current view, one `jumpTo` per animation frame. Any pointer, wheel, touch or key
 * input on the map stops it at once and leaves the camera where it is. Returns a function that stops it.
 */
export function playShots(map: PlayerMap, script: ShotScript, options: PlayOptions = {}): () => void {
  const c = map.getCenter();
  const heightPx = map.getCanvas().clientHeight;
  // With terrain the player sets the look-at point's height itself (see the file comment) and switches the map's clamping off meanwhile.
  const ownsHeight = !!map.getTerrain?.() && !!map.queryTerrainElevation && !!map.setCenterClampedToGround && !!map.getCenterElevation;
  const wasClamped = map.getCenterClampedToGround?.() ?? true;
  const groundAt: GroundAt | undefined = ownsHeight ? (lng, lat) => map.queryTerrainElevation!({ lng, lat }) : undefined;
  const view = { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), ...(ownsHeight ? { elevation: map.getCenterElevation!() } : {}) };
  const timeline = buildTimeline(script.shots, cameraOfMapView(view, heightPx), heightPx, groundAt);
  if (ownsHeight) map.setCenterClampedToGround!(false);
  const container = map.getContainer();
  const frames = options.frames ?? browserFrames;
  let frame = 0, startedAt: number | undefined, shown = -1, ended = false, lastAhead = -Infinity;
  const end = (reason: "done" | "user" | "stopped"): void => {
    if (ended) return;
    ended = true;
    frames.cancel(frame);
    for (const type of INTERRUPTS) container.removeEventListener(type, onUser, { capture: true });
    if (ownsHeight) map.setCenterClampedToGround!(wasClamped);
    options.onEnd?.(reason);
  };
  const onUser = (event: { target: unknown }): void => { if (!options.ignoreInput?.(event)) end("user"); };
  for (const type of INTERRUPTS) container.addEventListener(type, onUser, { capture: true });
  const tick = (now: number): void => {
    if (ended) return;
    startedAt ??= now;
    const time = (now - startedAt) / 1000;
    const { camera, index } = sampleTimeline(timeline, time);
    if (index !== shown && index >= 0) { shown = index; options.onShot?.(index, script.shots[index]!); }
    options.onFrame?.(Math.min(time, timeline.duration), timeline.duration);
    if (options.onAhead && now - lastAhead >= (options.aheadEvery ?? 500)) {
      lastAhead = now;
      const h = map.getCanvas().clientHeight, maxPitch = map.getMaxPitch();
      const views = (options.ahead ?? [1.5, 3]).filter((dt) => time + dt < timeline.duration).map((dt) => mapViewOf(sampleTimeline(timeline, time + dt).camera, h, maxPitch));
      if (views.length > 0) options.onAhead(views);
    }
    map.jumpTo(mapViewOf(camera, map.getCanvas().clientHeight, map.getMaxPitch()));
    if (time >= timeline.duration) { end("done"); return; }
    frame = frames.request(tick);
  };
  frame = frames.request(tick);
  return () => end("stopped");
}

// ---------------------------------------------------------------------------------------------------------------- status

/** What the playback is doing, for the demo's status control (shot-control.ts). */
export type PlaybackState =
  | { kind: "loading" }
  | { kind: "ready"; count: number; duration: number }
  | { kind: "error"; message: string }
  | { kind: "playing"; index: number; count: number; type: Shot["type"]; time: number; duration: number }
  | { kind: "done"; duration: number }
  | { kind: "user" | "stopped"; time: number; duration: number };

const seconds = (s: number): string => `${Math.floor(s)}`;

/** The length of a script in seconds (the sum of its shots). */
export const scriptDuration = (script: ShotScript): number => script.shots.reduce((n, s) => n + s.duration_s, 0);

/** The status line, the button's label (none while loading or after an error) and the progress in [0, 1]. */
export function describePlayback(state: PlaybackState): { text: string; button?: "Play tour" | "Stop" | "Replay"; progress: number } {
  switch (state.kind) {
    case "loading": return { text: "Shots: loading…", progress: 0 };
    case "ready": return { text: `Camera tour: ${state.count} shots, ${seconds(state.duration)} s`, button: "Play tour", progress: 0 };
    case "error": return { text: `Shots: ${state.message}`, progress: 0 };
    case "playing": return { text: `▶ Playing ${state.index + 1}/${state.count} · ${state.type} · ${seconds(state.time)} / ${seconds(state.duration)} s`, button: "Stop", progress: state.time / state.duration };
    case "done": return { text: `■ Finished (${seconds(state.duration)} s)`, button: "Replay", progress: 1 };
    case "user": return { text: `⏸ Stopped by your input at ${seconds(state.time)} / ${seconds(state.duration)} s`, button: "Replay", progress: state.time / state.duration };
    case "stopped": return { text: `■ Stopped at ${seconds(state.time)} / ${seconds(state.duration)} s`, button: "Replay", progress: state.time / state.duration };
  }
}
