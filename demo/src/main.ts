/**
 * Demo entry point: wires loading -> decoding -> custom layer.
 */
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";

import { decodeSurfelTile } from "./decode-tile.js";
import { tileLatitude, tileLongitude, type TileAddress } from "../../src/tile-geometry.js";
import { DEMO_TILE, DEMO_TILESETS, isDemoTileset, tilesetTiles, tileUrlPath, type DemoTileset } from "./demo-tile.js";
import { fetchTilesBytes } from "./load-tile.js";
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

const tiles = tilesetTiles(tileset);
/** One closed outline per tile of the tileset. */
const outlines = tiles.map((t) => [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([x, y]) => tileToLngLat(t, x as number, y as number)));

/**
 * Basemap: hfu/stars' bvmap-koicha-starlight style (MLT-encoded vector
 * tiles derived from GSI optimized vector tiles), served by stars.optgeo.org.
 */
const BASEMAP_STYLE = "https://stars.optgeo.org/style/bvmap-koicha-starlight";

const map = new MapLibreMap({
  container: "map",
  center: tileToLngLat(DEMO_TILE, 0.5, 0.5),
  zoom: 18.3,
  pitch: 60,
  bearing: -30,
  maxPitch: 85,
  style: BASEMAP_STYLE,
});
map.addControl(new NavigationControl({ visualizePitch: true }));

const urls = tiles.map((t) => tileUrlPath(tileset, t));
const tilesPromise = fetchTilesBytes(urls).then((all) =>
  all.map((bytes, n) => ({ tile: tiles[n] as TileAddress, bytes, surfels: decodeSurfelTile(bytes) })),
);

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
      setStatus(`${loaded.length} tile(s) of ${tileset}: ${bytes} bytes, ${count} surfels`);
      (window as unknown as { dorayaki: unknown }).dorayaki = { map, layer, loaded };
    },
    (err: unknown) => {
      setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(err);
    },
  );
});
