/**
 * Demo entry point: wires loading -> decoding -> custom layer.
 */
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";

import { decodeSurfelTileWithLevels } from "./decode-tile.js";
import { tileLatitude, tileLongitude, type TileAddress } from "../../src/tile-geometry.js";
import { DEMO_TILESETS, isDemoTileset, tilesetTiles, tileUrlPath, type DemoTileset } from "./demo-tile.js";
import { fetchTilesBytes } from "./load-tile.js";
import { loadTileJson, tileUrl, type TileSource } from "./tilejson.js";
import { SurfelLayer } from "./surfel-layer.js";

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
  typeof __DORAYAKI_EXTERNAL_TILESETS__ !== "undefined" ? __DORAYAKI_EXTERNAL_TILESETS__ : { numazu: "tiles/numazu/tilejson.json" };
type ExternalTileset = string;
type Tileset = DemoTileset | ExternalTileset;
const isExternal = (name: string): name is ExternalTileset => Object.hasOwn(EXTERNAL_TILESETS, name);

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

const statusEl = document.getElementById("status") as HTMLElement;
const depthEl = document.getElementById("depth") as HTMLInputElement;
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
const BASEMAP_STYLE = "https://stars.optgeo.org/style/bvmap-starlight";

const map = new MapLibreMap({
  container: "map",
  center: external ? external.center : tileToLngLat(tiles[0] as TileAddress, 0.5, 0.5),
  zoom: external ? 20.5 : 18.3,
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

const urls = tiles.map((t) => (external ? tileUrl(external.template, t) : tileUrlPath(tileset as DemoTileset, t)));
/** Load-time measurements (E001 in EXPERIMENTS.md). */
const timings: { fetchMs?: number; decodeMs?: number } = {};
const tFetch = performance.now();
const tilesPromise = fetchTilesBytes(urls, undefined, { allowMissing: external !== undefined }).then((all) => {
  timings.fetchMs = performance.now() - tFetch;
  const tDecode = performance.now();
  // Tiles listed from TileJSON bounds may not exist (204/404); skip those.
  const decoded = all.flatMap((bytes, n) => (bytes ? [{ tile: tiles[n] as TileAddress, bytes, ...decodeSurfelTileWithLevels(bytes) }] : []));
  timings.decodeMs = performance.now() - tDecode;
  return decoded;
});

map.on("load", () => {
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
  tilesPromise.then(
    (loaded) => {
      const layer = new SurfelLayer("surfels", loaded);
      map.addLayer(layer, "tile-outline"); // keep the 2D tile outlines visible on top
      depthEl.addEventListener("change", () => layer.setDepthTest(depthEl.checked));
      const bytes = loaded.reduce((n, t) => n + t.bytes.byteLength, 0);
      const count = loaded.reduce((n, t) => n + t.surfels.length, 0);
      const loadedSummary = `${loaded.length} tile(s) of ${tileset}: ${bytes} bytes, ${count} surfels`;
      setStatus(loadedSummary);
      // After each frame, show what the zoom-based selection drew.
      map.on("render", () => {
        const d = layer.lastDraw;
        if (!d) return;
        const progressive = d.levelsDrawn > 1 || loaded.some((t) => t.tile.z === d.zoom && t.levels.length > 1);
        setStatus(`${loadedSummary}. Drawing z${d.zoom}: ${d.tiles} tile(s), ${d.surfels} surfels` +
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
      const report = () => ({
        tileset, tiles: loaded.length, surfels: count, encodedBytes: bytes,
        fetchMs: timings.fetchMs, decodeMs: timings.decodeMs, uploadMs: layer.uploadMs, gpu: layer.gpu,
      });
      (window as unknown as { dorayaki: unknown }).dorayaki = { map, layer, loaded, timings, report, measureFrames };
    },
    (err: unknown) => {
      setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(err);
    },
  );
});
