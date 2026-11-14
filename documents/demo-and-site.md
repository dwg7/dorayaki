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
| `surfel-layer.ts` | MapLibre `CustomLayerInterface` lifecycle |
| `main.ts` | map setup and wiring |
| `demo-tile.ts` | demo tile address and deterministic tile bytes |

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
