/**
 * Demo entry point: wires loading -> decoding -> custom layer.
 */
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type ExpressionSpecification } from "maplibre-gl";

import { decodeSurfelTileWithLevels, packSurfelTile } from "./decode-tile.js";
import type { PackedBlock } from "../../src/surfel-block.js";
import { tileLatitude, tileLongitude, tileWidthMetres, type TileAddress } from "../../src/tile-geometry.js";
import { DEMO_TILESETS, isDemoTileset, tilesetTiles, tileUrlPath, type DemoTileset } from "./demo-tile.js";
import { fetchTilesBytes } from "./load-tile.js";
import { loadTileJson, tileUrl, type TileSource } from "./tilejson.js";
import { SurfelLayer } from "./surfel-layer.js";
import { splatInstances, type SplatInstances } from "./splat-instances.js";
import { TileStreamer } from "./tile-streamer.js";
import { keepZoomAcrossPans } from "./pan-zoom-keeper.js";
import { terrainLift } from "./terrain-lift.js";
import { keepCameraClearance } from "./camera-clearance.js";
import { vegetationFlags } from "./vegetation.js";
import { classStyle } from "./class-palette.js";
import { decodeClassPlane, readClassPlane, VEGETATION_CLASSES, CLASS_DERIVED_CANOPY, CLASS_UNCLASSIFIED, type ClassPlane } from "../../src/class-plane.js";
import { extractClassPlanes } from "../../src/mlt-frame.js";
import { selectMixedTiles } from "./mixed-selection.js";
import type { View } from "./camera.js";
import type { LngLatBoundsArray } from "./tile-view.js";

function tileToLngLat(t: TileAddress, x: number, y: number): [number, number] {
  return [tileLongitude(t, x), tileLatitude(t, y)];
}

/**
 * Real-data tilesets, each named by a TileJSON URL: the local tilejson.json
 * written by `npm run demo:numazu`, or a server such as Martin on stars that
 * serves the PMTiles archive as z/x/y. The site build sets this list.
 */
declare const __DORAYAKI_EXTERNAL_TILESETS__: Readonly<Record<string, string>> | undefined;
declare const __DORAYAKI_WORKER_URL__: string | undefined;

/**
 * The single-file site build bundles MapLibre into index.html, so
 * MapLibre's own import.meta.url no longer points next to its worker. That
 * build defines the worker's path relative to the page; the dev page
 * (unbundled MapLibre via an import map) leaves it undefined.
 */
if (typeof __DORAYAKI_WORKER_URL__ !== "undefined") {
  setWorkerUrl(new URL(__DORAYAKI_WORKER_URL__, document.baseURI).href);
}

const EXTERNAL_TILESETS: Readonly<Record<string, string>> =
  typeof __DORAYAKI_EXTERNAL_TILESETS__ !== "undefined" ? __DORAYAKI_EXTERNAL_TILESETS__ : {
        numazu: "tiles/numazu/tilejson.json",
        "numazu-medium": "tiles/numazu-medium/tilejson.json",
        "numazu-fine": "tiles/numazu-fine/tilejson.json",
        kawazu: "tiles/kawazu/tilejson.json",
        "kawazu-single": "tiles/kawazu-single/tilejson.json",
        "kawazu-sc4": "tiles/kawazu-sc4/tilejson.json",
        "kawazu-v2": "tiles/kawazu-v2/tilejson.json",
        "kawazu-v6": "tiles/kawazu-v6/tilejson.json",
        "kawazu-ground": "tiles/kawazu-ground/tilejson.json",
        "kawazu-plane": "tiles/kawazu-plane/tilejson.json",
        "kawazu-s4": "tiles/kawazu-s4/tilejson.json",
        "kawazu-s10": "tiles/kawazu-s10/tilejson.json",
        "kawazu-s16": "tiles/kawazu-s16/tilejson.json",
        "kawazu-stars": "https://stars.optgeo.org/dorayaki-kawazu?v=20261122a",
        "kawazu-50cm": "tiles/kawazu-50cm/tilejson.json",
        "kawazu-25cm": "tiles/kawazu-25cm/tilejson.json",
        "kawazu-ad-t20-c20": "tiles/kawazu-ad-t20-c20/tilejson.json",
        "kawazu-ad-t10-c20": "tiles/kawazu-ad-t10-c20/tilejson.json",
        "kawazu-lp-c2-50cm": "tiles/kawazu-lp-c2-50cm/tilejson.json",
        "kawazu-mix-c2-50cm": "tiles/kawazu-mix-c2-50cm/tilejson.json",
        "kawazu-mix-c2-ad-t20": "tiles/kawazu-mix-c2-ad-t20/tilejson.json",
        "kawazu-mix-first-50cm": "tiles/kawazu-mix-first-50cm/tilejson.json",
        "kawazu-lp-sp24": "tiles/kawazu-lp-sp24/tilejson.json",
        "kawazu-mix-sp12": "tiles/kawazu-mix-sp12/tilejson.json",
        "kawazu-mix-sp24": "tiles/kawazu-mix-sp24/tilejson.json",
      };
type ExternalTileset = string;
type Tileset = DemoTileset | ExternalTileset;
const isExternal = (name: string): name is ExternalTileset => Object.hasOwn(EXTERNAL_TILESETS, name);

/**
 * Per-tileset defaults for the query flags below, overridden by the URL.
 * Kawazu lies 130 to 360 m above sea level, where the camera of a map without
 * terrain is far above the data (NOTES.md), so terrain is on by default; the
 * splat scale 1.3 closes the gaps between neighbours (documents/adaptive-merging.md).
 */
const TILESET_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  kawazu: { terrain: "1", extent: "1.3" },
  "kawazu-single": { terrain: "1", extent: "1.3" },
  "kawazu-stars": { terrain: "1", extent: "1.3" },
  "kawazu-sc4": { terrain: "1", extent: "1.3" },
  "kawazu-v2": { terrain: "1", extent: "1.3" },
  "kawazu-v6": { terrain: "1", extent: "1.3" },
  "kawazu-ground": { terrain: "1", extent: "1.3" },
  "kawazu-plane": { terrain: "1", extent: "1.3" },
  "kawazu-s4": { terrain: "1", extent: "1.3" },
  "kawazu-s10": { terrain: "1", extent: "1.3" },
  "kawazu-s16": { terrain: "1", extent: "1.3" },
};
/** A query flag: the URL's value, else the tileset's default. */
const flag = (name: string, tileset: string): string | null =>
  new URLSearchParams(location.search).get(name) ?? TILESET_DEFAULTS[tileset]?.[name] ?? null;

/** Tileset from `?fixture=`, defaulting to the bridge. */
const requested = new URLSearchParams(location.search).get("fixture") ?? "bridge";
const tileset: Tileset = isDemoTileset(requested) || isExternal(requested) ? requested : "bridge";

const fixtureEl = document.getElementById("fixture") as HTMLElement;
fixtureEl.replaceChildren(
  ...[...DEMO_TILESETS, ...Object.keys(EXTERNAL_TILESETS)].flatMap((name, i) => {
    const node = name === tileset ? Object.assign(document.createElement("strong"), { textContent: name })
      : Object.assign(document.createElement("a"), { textContent: name, href: `?fixture=${name}` });
    return i === 0 ? [node] : [document.createTextNode(" | "), node];
  }),
);

// Minimize / restore the info panel (the title stays).
const panelEl = document.getElementById("panel") as HTMLElement;
const toggleEl = document.getElementById("panel-toggle") as HTMLButtonElement;
toggleEl.addEventListener("click", () => {
  const min = panelEl.classList.toggle("min");
  toggleEl.textContent = min ? "+" : "\u2212";
  toggleEl.setAttribute("aria-expanded", String(!min));
  toggleEl.setAttribute("aria-label", min ? "Restore the panel" : "Minimize the panel");
  toggleEl.title = min ? "Restore" : "Minimize";
});

const statusEl = document.getElementById("status") as HTMLElement;
const depthEl = document.getElementById("depth") as HTMLInputElement;
const hideVegEl = document.getElementById("hideveg") as HTMLInputElement;
hideVegEl.checked = new URLSearchParams(location.search).get("hideveg") === "1";
const colorEl = document.getElementById("colormode") as HTMLSelectElement;
colorEl.value = new URLSearchParams(location.search).get("color") === "class" ? "class" : "stored";
const legendEl = document.getElementById("legend") as HTMLDivElement;
const setStatus = (text: string): void => {
  statusEl.textContent = text;
};

const external: TileSource | undefined = isExternal(tileset) ? await loadTileJson(EXTERNAL_TILESETS[tileset]!, document.baseURI) : undefined;

const tiles = external ? external.tiles : tilesetTiles(tileset as DemoTileset);
/** Outlines of the deepest zoom's tiles only, to keep the overlay readable. */
const deepest = Math.max(...tiles.map((t) => t.z));
const outlines = tiles.filter((t) => t.z === deepest).map((t) => [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([x, y]) => tileToLngLat(t, x as number, y as number)));

/**
 * Basemap: hfu/stars' bvmap-starlight style (GSI optimized vector tiles,
 * nationwide), served by stars.optgeo.org. Used for every tileset.
 */
const BASEMAP_STYLE = new URLSearchParams(location.search).get("basemap") ?? "https://stars.optgeo.org/style/bvmap-starlight"; // `?basemap=<style URL>`: preview another style

const map = new MapLibreMap({
  container: "map",
  center: external ? external.center : tileToLngLat(tiles[0] as TileAddress, 0.5, 0.5),
  zoom: external ? Math.max(...tiles.map((t) => t.z)) + 1.5 : 18.3, // numazu: 19 + 1.5 = 20.5
  pitch: 60,
  bearing: -30,
  maxPitch: 85,
  // Camera in the URL fragment as #map=zoom/lat/lng/bearing/pitch; it
  // overrides the initial view above and survives reloads.
  hash: "map",
  style: BASEMAP_STYLE,
  // Real-data tilesets name their source next to the basemap's attribution.
  attributionControl: external?.attribution ? { customAttribution: external.attribution } : {},
});
map.addControl(new NavigationControl({ visualizePitch: true }));

const urlOf = (t: TileAddress): string => (external ? tileUrl(external.template, t) : tileUrlPath(tileset as DemoTileset, t));

/**
 * One loaded tile. The decoded Splat objects (about 280 bytes each in the JS heap) are not kept: they are turned into
 * instance data (56 bytes per splat) at once, and that is handed to the layer and dropped (E011).
 */
interface LoadedTile {
  tile: TileAddress;
  byteLength: number;
  count: number;
  levels: number[];
  /** Until the layer has taken it: the block's 16-byte records (default), or float instance data (`?gpu=legacy`). */
  packed: PackedBlock | undefined;
  /** Class codes handed over with the records: the guess of vegetation.ts (64 vegetation, 1 other) for a tile without a class plane. */
  classes: Uint8Array | undefined;
  /** The tile's class plane (src/class-plane.ts), still compressed; kept for later decoding. */
  classPlane: ClassPlane | undefined;
  /** Its decoded class codes, once decoded. */
  classCodes?: Uint8Array;
  classesRequested?: boolean;
  /** The tile got the guess of vegetation.ts instead of a class plane (made only while a class feature was on). */
  guessed?: boolean;
  instances: SplatInstances | undefined;
}

/** Load-time measurements, summed over every tile loaded (E001 in EXPERIMENTS.md). */
const timings = { fetchMs: 0, decodeMs: 0, classMs: 0, classSplats: 0 };
/** Each set handed to the layer: when (ms since the page started), zoom, tiles, bytes (`dorayaki.deliveries`). */
const deliveries: Array<{ ms: number; zoom: number; tiles: number; bytes: number }> = [];
/** Class codes to hide: vegetation when the checkbox is on, plus `?hide=3,4,...` (codes 0 to 127). */
const extraHide = (flag("hide", tileset) ?? "").split(",").filter((c) => c.trim() !== "").map(Number).filter((c) => Number.isInteger(c) && c >= 0 && c < 128);
const hideCodes = (): number[] => [...(hideVegEl.checked ? VEGETATION_CLASSES : []), ...extraHide];
/** Whether a class feature (hide, color by class) is on. */
const classesNeeded = (): boolean => hideCodes().length > 0 || colorEl.value === "class";
/** The vegetation guess (vegetation.ts): `?vegh=` metres above the local ground, `?vegcell=` cell metres, `?vegshape=0` ignores the shape. */
const vegNumber = (name: string, fallback: number): number => { const v = Number(flag(name, tileset)); return v > 0 ? v : fallback; };
const vegOptions = { minHeight: vegNumber("vegh", 2), cellMetres: vegNumber("vegcell", 4), roundOnly: flag("vegshape", tileset) !== "0" };
async function loadTile(tile: TileAddress): Promise<LoadedTile | null> {
  const t0 = performance.now();
  // Tiles listed from TileJSON bounds may not exist (204/404); those come back as null.
  const [bytes] = await fetchTilesBytes([urlOf(tile)], undefined, { allowMissing: external !== undefined });
  timings.fetchMs += performance.now() - t0;
  if (!bytes) return null;
  const t1 = performance.now();
  if (flag("gpu", tileset) !== "legacy") {
    const packed = packSurfelTile(bytes); // no Splat objects: the records go to the GPU as they are
    timings.decodeMs += performance.now() - t1;
    const [planeBody] = extractClassPlanes(bytes);
    let classPlane: ClassPlane | undefined;
    if (planeBody) {
      const p = readClassPlane(planeBody);
      if (p.count === packed.count) classPlane = { ...p, payload: p.payload.slice() }; // a copy: do not keep the whole tile alive
    }
    // Without a class plane, a guess from the splats stands in for the classes.
    // Without a class plane the guess stands in for the classes, but only when a class feature is on (it costs a pass over the splats);
    // switching one on later reloads the tiles.
    const guessed = !classPlane && classesNeeded();
    const classes = guessed ? Uint8Array.from(vegetationFlags(packed, tileWidthMetres(tile), vegOptions), (f) => (f ? CLASS_DERIVED_CANOPY : CLASS_UNCLASSIFIED)) : undefined;
    return { tile, byteLength: bytes.byteLength, count: packed.count, levels: packed.levels, packed, classes, classPlane, guessed, instances: undefined };
  }
  const decoded = decodeSurfelTileWithLevels(bytes);
  const instances = splatInstances(decoded.splats); // the Splat objects become garbage here
  timings.decodeMs += performance.now() - t1;
  return { tile, byteLength: bytes.byteLength, count: decoded.splats.length, levels: decoded.levels, packed: undefined, classes: undefined, classPlane: undefined, instances };
}

map.on("load", () => {
  // Fade the basemap from zoom 15.5 (to 20 % at zoom 19) so the splats stand out; `?fade=0` keeps it as is.
  // Only layers whose opacity is a plain number are changed.
  const fade = (v: number): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 15.5, v, 19, v * 0.2];
  if (flag("fade", tileset) !== "0") for (const l of map.getStyle().layers) for (const p of (l.type === "symbol" ? ["text-opacity", "icon-opacity"] : [`${l.type}-opacity`]) as "fill-opacity"[]) {
    const v = map.getPaintProperty(l.id, p) ?? 1;
    if (typeof v === "number") map.setPaintProperty(l.id, p, fade(v));
  }
  // Debug (`?terrain=1`): MapLibre terrain from stars' Terrarium DEM, to see how the custom layer behaves with it.
  const terrain = Number(flag("terrain", tileset));
  if (terrain > 0) {
    // The DEM is lowered by `?terrainshift=` metres (default 2): it differs from the point cloud's ground by
    // -0.9 to +0.7 m (5 to 95 %, up to +2.4 m) in the Kawazu area (E010), and where it lies above the ground it
    // hides the splats. The Terrarium decode is spelled out so that `baseShift` can carry the shift
    // (MapLibre computes red*redFactor + green*greenFactor + blue*blueFactor - baseShift).
    const shift = Number(flag("terrainshift", tileset) ?? 2);
    map.addSource("dem", {
      type: "raster-dem", url: "https://stars.optgeo.org/mapterhorn-japan-bridge", tileSize: 512,
      encoding: "custom", redFactor: 256, greenFactor: 1, blueFactor: 1 / 256, baseShift: 32768 + shift,
    });
    map.setTerrain({ source: "dem", exaggeration: terrain });
    // A pan drag over terrain ends at another zoom, and panning toward higher ground brings the camera down onto the
    // slope (pan-zoom-keeper.ts); keep the zoom instead. `?keepzoom=0` leaves the map as MapLibre moves it.
    if (flag("keepzoom", tileset) !== "0") keepZoomAcrossPans(map);
    // `?clearance=<metres>`: lower the pitch just enough to keep the camera that high above the ground under it
    // (camera-clearance.ts); 15 m by default with terrain on, `?clearance=0` leaves the map as MapLibre moves it.
    const clearance = Number(flag("clearance", tileset) ?? 15);
    if (clearance > 0) keepCameraClearance(map, clearance);
  }
  // Debug overlay on top of the basemap: the demo tile's boundary.
  map.addSource("tile-outline", {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: outlines } },
  });
  map.addLayer({
    id: "tile-outline",
    type: "line",
    source: "tile-outline",
    paint: { "line-color": "#d03030", "line-width": 2, "line-dasharray": [2, 2] },
  });
  const lod = Number(flag("lod", tileset));
  const extent = Number(flag("extent", tileset));
  const dz = Number(flag("dz", tileset));
  // `?mixed=1`: tiles of several zooms at once, by distance from the camera (documents/demo-and-site.md, E015).
  const mixed = flag("mixed", tileset) === "1";
  // With terrain on, MapLibre's terrain at low zoom is coarser than the ground and lies above it in places, covering
  // the splats; raise them by a zoom-dependent amount (terrain-lift.ts). `?dz=` raises everything by dz metres (debug).
  const zoomLift = (): number => (terrain > 0 ? terrainLift(map.getZoom()) : 0);
  const makeLayer = (): SurfelLayer => {
    const l = new SurfelLayer("surfels");
    if (lod > 0) l.zoomOverride = lod; // debug: pick tiles and levels as if the map were at this zoom
    if (flag("look", tileset) === "soft") {
      l.look = "soft"; // Gaussian-feathered splats (E018); `?softcore=`, `?softscale=`, `?softfalloff=` tune it
      const num = (name: string, fallback: number): number => { const v = Number(flag(name, tileset)); return v > 0 ? v : fallback; };
      l.coreScale = num("softcore", l.coreScale);
      l.softScale = num("softscale", l.softScale);
      l.softFalloff = num("softfalloff", l.softFalloff);
    }
    const shade = flag("shade", tileset);
    if (shade !== undefined && shade !== null && shade !== "" && Number.isFinite(Number(shade))) l.shade = Math.min(1, Math.max(0, Number(shade))); // 0: no shading
    if (mixed) l.drawAllTiles = true; // the streamer chose tiles of several zooms by distance
    if (extent > 0) l.extent = extent; // debug: scale every splat's semi-axes, to cover gaps between neighbours
    l.setZOffset(dz + zoomLift());
    l.setDepthTest(depthEl.checked);
    l.setHideClasses(hideCodes());
    l.classColor = colorEl.value === "class";
    map.addLayer(l, "tile-outline"); // keep the 2D tile outlines visible on top
    return l;
  };
  let layer = makeLayer();
  depthEl.addEventListener("change", () => layer.setDepthTest(depthEl.checked));
  // A class feature was switched: tiles loaded without classes (no plane, and the guess not made because no feature was on) are loaded again.
  const onClassFeature = (): void => {
    layer.setHideClasses(hideCodes());
    layer.setClassColor(colorEl.value === "class");
    if (classesNeeded() && loaded.some((t) => !t.classPlane && !t.guessed && t.count > 0)) { streamer.reset(); refresh(); } else void ensureClasses();
  };
  hideVegEl.addEventListener("change", onClassFeature);
  colorEl.addEventListener("change", onClassFeature);

  // Only the tiles of the selected zoom that are in view are fetched, decoded and uploaded; the set is swapped
  // as a whole when it is complete (documents/demo-and-site.md).
  // The view as the camera model of camera.ts takes it (for `?mixed=1`); the ground height under the view centre comes from the terrain.
  const currentView = (): View => {
    const c = map.getCenter();
    const canvas = map.getCanvas();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), width: canvas.clientWidth, height: canvas.clientHeight, centreZ: map.queryTerrainElevation(c) ?? 0 };
  };
  let loaded: LoadedTile[] = [];
  // Class codes: the hide checkbox hides vegetation (plus `?hide=3,4,...` codes), the select colors by class. The class planes of the
  // tiles are inflated only when one of them is used (a tile without a plane has the guess of vegetation.ts instead).
  // Inflate a gzip payload but never produce more than `max` bytes (the plane's count): a hostile payload cannot expand without bound.
  const gunzip = async (bytes: Uint8Array, max: number): Promise<Uint8Array> => {
    const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const out = new Uint8Array(max);
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.byteLength > max) { await reader.cancel(); throw new Error(`class plane inflates to more than its ${max} bytes`); }
      out.set(value, n);
      n += value.byteLength;
    }
    return out.subarray(0, n);
  };
  const updateLegend = (): void => {
    if (colorEl.value !== "class" && !hideVegEl.checked) { legendEl.textContent = ""; return; }
    const counts = new Map<number, number>();
    let total = 0;
    for (const t of loaded) for (const c of t.classCodes ?? []) { counts.set(c, (counts.get(c) ?? 0) + 1); total++; }
    if (total === 0) { legendEl.textContent = loaded.some((t) => t.classPlane) ? "classes loading…" : "no class plane in these tiles (a guess is used)"; return; }
    legendEl.innerHTML = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => {
      const st = classStyle(code);
      return `<span style="display:inline-block;width:10px;height:10px;background:rgb(${st.rgb.join(",")});border:1px solid #888"></span> ${st.name} ${(100 * n / total).toFixed(1)} %`;
    }).join("<br />");
  };
  async function ensureClasses(): Promise<void> {
    if (!classesNeeded()) { updateLegend(); return; }
    const t0 = performance.now();
    for (const t of loaded) {
      if (!t.classPlane || t.classesRequested) continue;
      t.classesRequested = true;
      try {
        t.classCodes = await decodeClassPlane(t.classPlane, gunzip);
        timings.classSplats += t.classCodes.byteLength;
        layer.setTileClasses(t.tile, t.classCodes);
      } catch (e) { console.warn(`class plane of ${t.tile.z}/${t.tile.x}/${t.tile.y}:`, e); }
    }
    timings.classMs += performance.now() - t0;
    updateLegend();
  }
  let summary = "loading…";
  const streamer = new TileStreamer<LoadedTile>({
    candidates: tiles,
    ...(mixed ? { select: (_z: number, b: LngLatBoundsArray, maxZoom?: number) => selectMixedTiles(tiles, b, currentView(), { limit: 24, ...(maxZoom !== undefined ? { maxZoom } : {}) }) } : {}),
    staged: flag("staged", tileset) !== "0", // show the next coarser zoom while the first set loads (`?staged=0` switches it off)
    load: loadTile,
    onProgress: ({ zoom, wanted, done }) => {
      if (done < wanted) setStatus(`${summary} Loading z${zoom}: ${done}/${wanted} tile(s)…`);
    },
    onReady: (set, zoom) => {
      deliveries.push({ ms: Math.round(performance.now()), zoom, tiles: set.length, bytes: set.reduce((n, x) => n + x.data.byteLength, 0) });
      loaded = set.map((x) => x.data);
      layer.setTiles(loaded.map((t) => ({ tile: t.tile, ...(t.packed ? { packed: t.packed } : {}), ...(t.classes ? { classes: t.classes } : {}), ...(t.instances ? { instances: t.instances } : {}), levels: t.levels })));
      for (const t of loaded) { t.instances = undefined; t.packed = undefined; t.classes = undefined; } // the layer owns the data now; do not keep a second copy
      const bytes = loaded.reduce((n, t) => n + t.byteLength, 0);
      const count = loaded.reduce((n, t) => n + t.count, 0);
      void ensureClasses();
      summary = `${loaded.length} tile(s) of ${tileset} at z${zoom}: ${bytes} bytes, ${count} surfels.`;
      setStatus(summary);
    },
  });
  const refresh = (): void => {
    const b = map.getBounds();
    streamer.update(lod > 0 ? lod : map.getZoom(), [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  };
  map.on("moveend", refresh);
  if (terrain > 0) map.on("zoom", () => layer.setZOffset(dz + zoomLift()));
  refresh();
  // A lost WebGL context (the browser reclaims the GPU's memory) is restored by MapLibre for its own layers but not for
  // this custom layer, and the tiles' GPU buffers are gone with the context: add a new layer and fetch the tiles again.
  map.on("webglcontextrestored", () => {
    const rebuild = (tries: number): void => {
      if (!map.isStyleLoaded() && tries > 0) { setTimeout(() => rebuild(tries - 1), 250); return; }
      if (map.getLayer("surfels")) map.removeLayer("surfels");
      layer = makeLayer();
      streamer.reset();
      refresh();
    };
    rebuild(40);
  });
  // After each frame, show what the zoom-based selection drew.
  map.on("render", () => {
    const d = layer.lastDraw;
    if (!d) return;
    const progressive = d.levelsDrawn > 1 || loaded.some((t) => t.tile.z === d.zoom && t.levels.length > 1);
    setStatus(`${summary} Drawing z${d.zoom}: ${d.tiles} tile(s), ${d.surfels} surfels` +
      (progressive ? `, levels ${d.levelsDrawn}, min radius ${(d.minRadius * 100).toFixed(1)} cm` : ""));
  });
  /**
   * Frame timing: force `frames` repaints in a row and report the median
   * interval between rendered frames and the median CPU time of the
   * surfel layer's render(). GPU time is not measured.
   */
  const measureFrames = (frames = 120): Promise<Record<string, number | string | undefined>> =>
    new Promise((resolve) => {
      const stamps: number[] = [];
      const cpu: number[] = [];
      const onRender = () => {
        stamps.push(performance.now());
        if (layer.lastRenderMs !== undefined) cpu.push(layer.lastRenderMs);
        if (stamps.length > frames) {
          map.off("render", onRender);
          const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? NaN;
          const intervals = stamps.slice(1).map((t, i) => t - stamps[i]!);
          resolve({
            frames, medianFrameMs: median(intervals), medianLayerCpuMs: median(cpu),
            drawnSurfels: layer.lastDraw?.surfels, gpu: layer.gpu, userAgent: navigator.userAgent,
          });
        } else map.triggerRepaint();
      };
      map.on("render", onRender);
      map.triggerRepaint();
    });
  /**
   * Share of near-white (background) pixels in a screen rectangle given as
   * fractions of the canvas, read back inside a render event. Used by E006
   * to compare how many gaps different `?extent=` values leave on a road.
   */
  const holeFraction = (rect: [number, number, number, number] = [0.35, 0.55, 0.65, 0.9]): Promise<number> =>
    new Promise((resolve) => {
      const onRender = () => {
        map.off("render", onRender);
        const gl = map.getCanvas().getContext("webgl2") as WebGL2RenderingContext;
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const x0 = Math.floor(rect[0] * w), x1 = Math.floor(rect[2] * w);
        const y0 = Math.floor((1 - rect[3]) * h), y1 = Math.floor((1 - rect[1]) * h);
        const px = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
        gl.readPixels(x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let white = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i]! > 235 && px[i + 1]! > 235 && px[i + 2]! > 235) white++;
        resolve(white / (px.length / 4));
      };
      map.on("render", onRender);
      map.triggerRepaint();
    });
  const report = () => ({
    tileset, tiles: loaded.length, surfels: loaded.reduce((n, t) => n + t.count, 0),
    encodedBytes: loaded.reduce((n, t) => n + t.byteLength, 0),
    fetchMs: timings.fetchMs, decodeMs: timings.decodeMs, uploadMs: layer.uploadMs, gpu: layer.gpu,
  });
  (window as unknown as { dorayaki: unknown }).dorayaki = {
    deliveries,
    map, get layer() { return layer; }, get loaded() { return loaded; }, timings, report, measureFrames, holeFraction, refresh,
  };
});
