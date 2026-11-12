/**
 * Demo entry point: wires loading -> decoding -> custom layer.
 */
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";

import { decodeSurfelTile } from "./decode-tile.js";
import { DEMO_TILE, tileUrlPath, type TileAddress } from "./demo-tile.js";
import { fetchTileBytes } from "./load-tile.js";
import { SurfelLayer } from "./surfel-layer.js";

function tileToLngLat(t: TileAddress, x: number, y: number): [number, number] {
  const n = 2 ** t.z;
  const lng = ((t.x + x) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + y)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

const statusEl = document.getElementById("status") as HTMLElement;
const depthEl = document.getElementById("depth") as HTMLInputElement;
const setStatus = (text: string): void => {
  statusEl.textContent = text;
};

const corners = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([x, y]) => tileToLngLat(DEMO_TILE, x as number, y as number));

const map = new MapLibreMap({
  container: "map",
  center: tileToLngLat(DEMO_TILE, 0.5, 0.5),
  zoom: 16.3,
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

const url = tileUrlPath(DEMO_TILE);
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
