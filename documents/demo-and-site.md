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
testing off. The basemap is the dark `bvmap-nightsky` style from
[hfu/stars](https://github.com/hfu/stars) (`?basemap=starlight` for the light one; documents/dark-basemap.md), so the page needs network access
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
| `?look=soft` | the soft look (E018): every splat is drawn twice, an opaque core of the full extent that carries the depth, then a larger Gaussian-feathered, alpha-blended splat on top; `?softcore=` (default 1; below about 0.75 the cores leave gaps and the feathered splats show as a pattern of dots), `?softscale=` (1.8) and `?softfalloff=` (6.5) tune it |
| `?hideveg=1`, the "hide vegetation" checkbox; `?hide=3,4,...` | hide the splats of the vegetation classes (3, 4, 5 and 64) or of the listed class codes, from the tile's class plane ([class-plane.md](class-plane.md), E021). A tile without a plane gets a weak guess from the splats alone (E019: well above the local ground and round, about 11 % of the Kawazu splats; `?vegh=`, `?vegcell=`, `?vegshape=0` tune it) |
| `?color=class`, the "color" select | draw by class in a vivid palette, with a legend (E021); needs a class plane to be meaningful |
| `?shade=<0..1>` | strength of the shading: 1 (default) is the fixed two-sided Lambert light, 0 draws the colors as stored (no shading, as 3D Gaussian splats do) |
| `?mixed=1` | draw tiles of several zooms at once, chosen by distance from the camera (`mixed-selection.ts`; E015). `1`: under a budget that always covers the view with the coarsest tiles, then refines the nearest first (E024; `?budget=` megabytes, default 40, `?splats=` default 4000000; sizes of loaded tiles, else a guess by zoom); `2`: the older cap of the 24 nearest tiles, instead of the nearest nine tiles of one zoom (the default for `sasebo`; `?mixed=0` switches it off) |
| `?shots=<name or path>` | play a shot script once the first tiles are drawn (`shot-player.ts`; a bare name is `shots/<name>.json` next to the page, e.g. `?shots=sasebo`; the site build copies `demo/shots/` to `docs/shots/`). Without it, a tileset with a tour (`TOURS` in main.ts: `sasebo`) shows the control with a Play tour button and does not start by itself. The control (`shot-control.ts`, top right) shows playing / finished / stopped, the time and a progress bar, with Stop or Replay; any other pointer, wheel, touch or key input on the map stops the tour |
| `?staged=0` | switch off the staged first display: the next coarser zoom is shown while the first set of tiles loads (E014) |
| `?gpu=legacy` | draw from float instance data (56 bytes per splat) instead of the packed 16-byte records, to compare the two (E013) |
| `?dz=<metres>` | raise every tile, to test high-elevation behaviour |
| `?keepzoom=0` | with terrain on, leave the zoom as MapLibre sets it when a pan drag ends. By default the demo puts the zoom back to what it was when the drag started (`pan-zoom-keeper.ts`; with an ease of `?zoomease=` ms, default 1500, 0 jumps): MapLibre GL JS 6.16.0 keeps the camera's height above sea level across a pan drag, so panning toward higher ground brought the camera down onto the slope and the zoom up to 22 (NOTES.md, 2026-11-17) |
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
| `camera.ts` | the map view's camera (as MapLibre's), effective zoom of a point, visible ground |
| `pan-zoom-keeper.ts` | keep the zoom across a pan drag over terrain (workaround; `?keepzoom=0` switches it off) |
| `mixed-selection.ts` | tiles of several zooms by distance (`?mixed=1`) |
| `shot-player.ts` | shot scripts played as a camera (`?shots=`), step 1 of documents/camera-direction.md |
| `shot-control.ts` | the tour's status control: playing / finished / stopped, progress, Play tour / Stop / Replay |
| `splat-instances.ts` | per-splat instance data (float attributes; `?gpu=legacy`, and the reference for the packed shader) |
| `gpu-surfels.ts` | shaders (float attributes and packed 16-byte records), buffer upload, instanced draw |
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
line shows "Loading z17: 6/12 tile(s)"). A tile's 16-byte records are taken from the block as they are (no Splat objects) and uploaded to the GPU, where the vertex shader decodes them (E013; `?gpu=legacy` builds 56-byte float instance data instead); the layer drops its copy after the upload, so the JS heap stays near 230 to 420 MB at the Kawazu views (E011). If the WebGL context is lost and restored, MapLibre does not bring the custom layer back: the demo adds a new layer and loads the tiles again. A tile already in flight or held is reused;
tiles outside the new set are freed (a tile seen again is fetched again, usually
from the browser's HTTP cache). Kawazu's nine-mesh set (46 tiles, 83 MB) has 12 tiles at z17; before the cap of nine,
zoom 17.6 requested 12 (59 MB). At the showcase view (zoom 16.6) the page fetches 10.8 MB (E011).

## Terrain at low zoom

With terrain on (Kawazu's default) MapLibre's terrain follows the DEM tile of about the map's zoom, so at low
zoom it is a smoothed ground that lies above the splats in places and hides them. The demo raises the layer by
`terrainLift(zoom)` (`demo/src/terrain-lift.ts`): 0 at zoom 15 and above, 9 m per zoom level below, at most
40 m. Measurements and what was tried: NOTES.md (2026-11-16, white holes at zoom 12.7).

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
