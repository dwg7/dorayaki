# Browser demo and GitHub Pages site

Status: implemented. This page holds the developer details of the demo that
the README only summarises.

## Run locally

```sh
npm install
npm run demo
```

Open <http://127.0.0.1:8000/demo/> in a browser with WebGL2. The server is
esbuild's dev server with the repository root as document root, so the page
can load MapLibre GL JS from `node_modules/` through an import map. It
listens on 127.0.0.1 only. Stop it with Ctrl-C.

The camera is kept in the URL fragment (`#map=zoom/lat/lng/bearing/pitch`).
Other fixtures: append `?fixture=overhang`, `?fixture=boundary` or
`?fixture=toy-gs`.

The page loads the fixture's tiles over plain HTTP:
`demo/tiles/{fixture}/18/234000/96256.mlt` (at Sapporo Station, 111.7 m
wide) for `bridge` and `overhang`, and that tile plus its east, south and
south-east neighbours for `boundary`. Each tile holds a synthetic unknown
frame followed by the fixture as an experimental surfel frame. The red
dashed lines are tile boundaries. The "depth test" checkbox turns depth
testing off. The basemap is the `bvmap-starlight` style from
[hfu/stars](https://github.com/hfu/stars), so the page needs network access
for the background map (not for the surfels).

Each splat is drawn as its 2-sigma ellipse in the plane of its two longer
axes; splats with no preferred orientation are drawn as camera-facing
discs. Mercator projection only.

## URL flags

All optional; the camera is in the fragment, the rest in the query.

| flag | effect |
| --- | --- |
| `?fixture=<name>` | tileset: `bridge`, `overhang`, `boundary`, `toy-gs`, or a real-data set listed in `EXTERNAL_TILESETS` of `demo/src/main.ts` (`numazu*`, `kawazu-*`; those under `demo/tiles/` exist only after building them) |
| `?lod=<zoom>` | choose tiles and levels as if the map were at this zoom |
| `?terrainshift=<metres>` | lower the terrain by this much (default 2): the DEM lies up to 2.4 m above the point cloud's ground and would hide splats there (E010) |
| `?terrain=<exaggeration>` | add MapLibre terrain from stars' `mapterhorn-japan-bridge` Terrarium DEM. Needed for data far above sea level: without terrain the camera is relative to 0 m and high data vanishes or is magnified (NOTES.md) |
| `?dz=<metres>` | raise every tile, to test high-elevation behaviour |
| `?fade=0` | keep the basemap at full opacity. By default its layers fade from zoom 15.5 to 20 % at zoom 19, so the splats stand out. Only layers whose opacity is a plain number are changed (92 of 135 opacity properties of the bvmap-starlight style, including 59 of 99 line properties); layers with their own zoom expressions are not |
| `?extent=<factor>` | scale every splat's semi-axes (default 1); about 1.3 closes the gaps between neighbours ([adaptive-merging.md](adaptive-merging.md)) |

The panel at the top left has a minimize button (the title stays).

In the page, `window.dorayaki` exposes `map`, `layer`, `loaded`, `timings`,
`report()`, `measureFrames()` and `holeFraction(rect)` for measurements.

**Measuring in a hidden pane is misleading.** A page in a hidden browser pane
runs as a background page; MapLibre's `load` waits for a rendered frame and was
delayed by about 60 s (NOTES.md, 2026-11-15). Show the pane before timing
anything.

## Demo modules (`demo/src/`)

Kept separate as AGENTS.md requires.

| module | responsibility |
| --- | --- |
| `load-tile.ts` | fetch tile bytes over HTTP |
| `tilejson.ts` | read TileJSON of external tilesets |
| `decode-tile.ts` | MLT frame extraction + Surfel Block decoding |
| `tile-selection.ts` | choose zoom and level prefix |
| `tile-matrix.ts` | tile-local to Web Mercator placement (float64) |
| `splat-instances.ts` | per-splat instance data |
| `gpu-surfels.ts` | shaders, buffer upload, instanced draw |
| `surfel-layer.ts` | MapLibre `CustomLayerInterface` lifecycle; `setTiles` swaps the tile set |
| `tile-view.ts` | which tiles of a zoom intersect the view (nearest first, at most 9) |
| `tile-streamer.ts` | loads the in-view tiles of the selected zoom and hands the whole set over when complete |
| `main.ts` | map setup and wiring |
| `demo-tile.ts` | demo tile address and deterministic tile bytes |

## Tile streaming

The demo does not fetch every tile of a tileset. On load and after every map move
(`moveend`) it picks the zoom (`selectZoom`), takes the tiles of that zoom that
intersect the view, nearest to the centre first and at most nine, and fetches,
decodes and uploads only those. The previous set keeps being drawn until every
tile of the new set has arrived, then the whole set is swapped (no holes; the status
line shows "Loading z17: 6/12 tile(s)"). A tile is turned into instance data (56 bytes per splat) as soon as it is decoded; the decoded Splat objects are not kept, and the layer drops its copy after the GPU upload, so the JS heap stays near 230 to 420 MB at the Kawazu views (E011). If the WebGL context is lost and restored, MapLibre does not bring the custom layer back: the demo adds a new layer and loads the tiles again. A tile already in flight or held is reused;
tiles outside the new set are freed (a tile seen again is fetched again, usually
from the browser's HTTP cache). Kawazu's nine-mesh set (46 tiles, 111 MB) has 12 tiles at z17; before the cap of nine,
zoom 17.6 requested 12 (59 MB). At the showcase view (zoom 16.6) the page fetches 10.8 MB (E011).

## GitHub Pages site

Published from `main:docs/` at <https://dwg7.unopengis.org/dorayaki/>.
`docs/` holds only the built site; design documents live in `documents/`.

```sh
npm run site    # rebuild docs/ (wiped and rewritten); commit the result
```

GitHub Pages does not build anything. The page is a single file:
`docs/index.html` carries all JavaScript (the demo and MapLibre GL JS,
bundled by esbuild) and all CSS inline, with no content hashes in file
names. Besides the page, only MapLibre's Web Worker
(`docs/maplibre-gl-worker.mjs`, which cannot be inlined), the synthetic
tiles and `.nojekyll` are separate files. MapLibre derives its worker URL
from its own `import.meta.url`, which bundling turns into the page URL, so
the build defines the worker's page-relative path and the demo passes it to
`setWorkerUrl`. The build fails if the worker is not self-contained.

The Numazu tileset is not copied into `docs/`; it is listed only when the
build is given its TileJSON:

```sh
DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu npm run site
```

In the page's console, `dorayaki.report()` and `await
dorayaki.measureFrames()` give load, upload and frame timings.
