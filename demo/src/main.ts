/**
 * Demo entry point: wires loading -> decoding -> custom layer.
 */
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";

import { decodeSurfelTile } from "./decode-tile.js";
import { tileLatitude, tileLongitude, type TileAddress } from "../../src/tile-geometry.js";
import { DEMO_TILE, DEMO_TILESETS, isDemoTileset, tileUrlPath, type DemoTileset } from "./demo-tile.js";
import { fetchTileBytes } from "./load-tile.js";
import { SurfelLayer } from "./surfel-layer.js";

function tileToLngLat(t: TileAddress, x: number, y: number): [number, number] {
  return [tileLongitude(t, x), tileLatitude(t, y)];
}

/** Tileset from `?fixture=`, defaulting to the bridge. */
const requested = new URLSearchParams(location.search).get("fixture") ?? "bridge";
const tileset: DemoTileset = isDemoTileset(requested) ? requested : "bridge";

const fixtureEl = document.getElementById("fixture") as HTMLElement;
fixtureEl.replaceChildren(
  ...DEMO_TILESETS.flatMap((name, i) => {
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

const corners = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([x, y]) => tileToLngLat(DEMO_TILE, x as number, y as number));

const map = new MapLibreMap({
  container: "map",
  center: tileToLngLat(DEMO_TILE, 0.5, 0.5),
  zoom: 18.3,
  pitch: 60,
  bearing: -30,
  maxPitch: 85,
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
      "tile-outline": {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: corners } },
      },
    },
    layers: [
      { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.6 } },
      {
        id: "tile-outline",
        type: "line",
        source: "tile-outline",
        paint: { "line-color": "#d03030", "line-width": 2, "line-dasharray": [2, 2] },
      },
    ],
  },
});
map.addControl(new NavigationControl({ visualizePitch: true }));

const url = tileUrlPath(tileset, DEMO_TILE);
const tilePromise = fetchTileBytes(url).then((bytes) => ({ bytes, surfels: decodeSurfelTile(bytes) }));

map.on("load", () => {
  tilePromise.then(
    ({ bytes, surfels }) => {
      const layer = new SurfelLayer("surfels", DEMO_TILE, surfels);
      map.addLayer(layer, "tile-outline"); // keep the 2D tile outline visible on top
      depthEl.addEventListener("change", () => layer.setDepthTest(depthEl.checked));
      setStatus(`${url}: ${bytes.byteLength} bytes, ${surfels.length} surfels`);
      (window as unknown as { dorayaki: unknown }).dorayaki = { map, layer, surfels };
    },
    (err: unknown) => {
      setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(err);
    },
  );
});
