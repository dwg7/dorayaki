# Dorayaki

Dorayaki is an experiment in carrying fully three-dimensional surfels in
conventional two-dimensional map tiles. It is an implementation
experiment, not a specification or standard. See `AGENTS.md` for the
project's goals and working method.

## Current state

Implemented:

- a naive Surfel Block codec (`src/surfel-block.ts`, version 3): a 16-byte
  header and a level table, followed by 32-byte little-endian surfel
  records, with x, y tile-local, z as orthometric height and radius in
  metres. The byte layout and coordinate frame
  are in [`documents/surfel-block-format.md`](documents/surfel-block-format.md);
- an experimental MLT frame wrapper (`src/mlt-frame.ts`): a Surfel Block
  as the body of an MLT frame with the local, unassigned tag `0xD0`; see
  [`documents/mlt-frame.md`](documents/mlt-frame.md). It skips unknown frames by
  their declared size and rejects malformed sizes;
- deterministic fixture generators: `plane` (`src/fixtures/plane.ts`),
  `bridge` (`src/fixtures/bridge.ts`: ground, deck, underside, and vertical
  piers) and `overhang` (`src/fixtures/overhang.ts`: top, vertical lip,
  downward-facing underside, recessed back wall, and ground). Both
  `bridge` and `overhang` hold several surfels at the same x/y with
  different z;
- a `boundary` fixture (`src/fixtures/boundary.ts`): a building centred on
  the corner where four tiles meet, split into a 2 × 2 tile block by the
  centre-ownership rule in `src/tiling.ts`;
- a toy 3DGS path (`src/gaussian/`): a minimal PLY reader and a deliberately
  lossy mapping from 3D Gaussians to v2 surfels, exercised on a
  deterministic toy PLY (`src/fixtures/toy-gaussians.ts`);
- a real-data path for point clouds (`src/pointcloud/`, `src/geodesy/`):
  a minimal LAS reader, the JGD2011 plane rectangular inverse, and one
  Gaussian per voxel. It is shown in the demo with a VIRTUAL SHIZUOKA MMS
  point cloud at Numazu (see [Numazu point cloud](#numazu-point-cloud));
- automated tests for round trips and malformed input (`test/`);
- a browser demo (`demo/`) that loads one pre-generated bridge tile over
  HTTP, decodes it, and draws the surfels as instanced discs in a MapLibre
  GL JS custom layer (`renderingMode: "3d"`). See [Demo](#demo).

Not yet implemented: PMTiles, tile selection by viewport, tile lifecycle
integration with MapLibre sources, globe or terrain support, the remaining
fixtures listed in `AGENTS.md` (`fold`, `floating`), and any compression or quantization.

## Requirements

Node.js 22 or later.

## Commands

```sh
npm install         # install dev dependencies (TypeScript, esbuild, MapLibre GL JS)
npm run typecheck   # type-check src/, test/, scripts/ and demo/src/ without emitting
npm test            # compile src/ and test/ into build-test/, run node --test
npm run build       # compile src/ into dist/ (JS, .d.ts, source maps)
npm run demo:tile   # write demo/tiles/{bridge,overhang,boundary,toy-gs}/18/…/….mlt
npm run demo:build  # demo:tile, then bundle demo/src/main.ts into demo/build/
npm run demo        # demo:tile, then bundle and serve on http://127.0.0.1:8000
```

`dist/`, `build-test/`, `demo/build/` and `demo/tiles/` are generated and
ignored by git.

## Demo

```sh
npm install
npm run demo
```

Then open <http://127.0.0.1:8000/demo/> in a browser with WebGL2. The
camera is kept in the URL fragment (`#map=zoom/lat/lng/bearing/pitch`), so
a view can be shared or reloaded. Other fixtures: the same URL with
`?fixture=overhang`, `?fixture=boundary` or `?fixture=toy-gs` appended. Stop the server with
Ctrl-C.

The page loads the fixture's tiles over plain HTTP:
`demo/tiles/{fixture}/18/234000/96256.mlt` (at Sapporo Station, 111.7 m
wide) for `bridge` and `overhang`, and that tile plus its east, south and
south-east neighbours for `boundary`. Each fixture is its own
tileset directory, so different fixtures can share a tile address. The tile
holds a synthetic unknown frame followed by the fixture as an experimental
surfel frame. The red dashed lines are the tile boundaries. The "depth test"
checkbox turns depth testing off to show its effect. The basemap is the
`bvmap-starlight` style from [hfu/stars](https://github.com/hfu/stars),
loaded from `https://stars.optgeo.org/style/bvmap-starlight`. It draws
GSI optimized vector tiles nationwide.
The page therefore needs network access for the background map (not for
the surfels). The surfels are drawn over the vector basemap; the tile
outline is a GeoJSON line layer added on top.

The server is esbuild's dev server with the repository root as its
document root, so the page can load MapLibre GL JS from `node_modules/`
through an import map. It listens on 127.0.0.1 only.

Demo modules (`demo/src/`), kept separate as AGENTS.md requires:

| module | responsibility |
| --- | --- |
| `load-tile.ts` | fetch tile bytes over HTTP |
| `decode-tile.ts` | MLT frame extraction + Surfel Block decoding |
| `tile-matrix.ts` | tile-local to Web Mercator placement (float64) |
| `gpu-surfels.ts` | shaders, buffer upload, instanced draw |
| `surfel-layer.ts` | MapLibre `CustomLayerInterface` lifecycle |
| `main.ts` | map setup and wiring |
| `demo-tile.ts` | demo tile address and deterministic tile bytes |

Placement follows the Surfel Block v2 coordinate frame
(`documents/surfel-block-format.md`): x and y in [0, 1] span the tile with y
pointing south, z and radius are metres. The demo converts x, y to metres
with `tileWidthMetres` (`src/tile-geometry.ts`), about 111.7 m for this
tile. Mercator projection only.

## Demo site (GitHub Pages)

The demo with the synthetic fixtures is published from `main:docs/` (dwg7
convention) at <https://dwg7.unopengis.org/dorayaki/>. `docs/` holds only
the built site; the design documents live in `documents/`.

```sh
npm run site    # rebuild docs/ (wiped and rewritten)
```

Commit the result. GitHub Pages does not build anything. The page is a
single file: `docs/index.html` carries all JavaScript (the demo and MapLibre
GL JS, bundled by esbuild) and all CSS inline. File names carry no
content hashes. Besides the page, only MapLibre's Web Worker
(`docs/maplibre-gl-worker.mjs`, which cannot be inlined), the tiles and
`.nojekyll` are separate files. MapLibre derives its worker URL from its own
`import.meta.url`, which bundling turns into the page URL. The build
therefore defines the worker's page-relative path and the demo passes it
to `setWorkerUrl`, so it resolves under `/dorayaki/`. The build fails if the
worker is not self-contained. The Numazu point-cloud tileset is not
copied into `docs/`. It is hosted as a PMTiles archive on stars (see
below) and listed on the site only when the build is given its TileJSON:
`DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu npm run site`.
In the page's console, `dorayaki.report()` and `await
dorayaki.measureFrames()` give load, upload and frame timings.

## Numazu point cloud

A real-data demo tileset built from Shizuoka Prefecture's VIRTUAL SHIZUOKA
MMS point cloud (2019, mesh `08NE2701`, CC BY). The data is not in this
repository. To rebuild it:

```sh
mkdir -p data/virtual-shizuoka/2019-mms-08NE2701
curl -o data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.zip https://virtual-shizuoka.s3.ap-northeast-1.amazonaws.com/2019/MMS/Ground/08/NE/27/08NE2701.zip
unzip data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.zip -d data/virtual-shizuoka/2019-mms-08NE2701
npm run demo:numazu
```

The zip is 14,113,240 bytes (SHA-256 `0af0a8ac…e1ca126d`). `npm run
demo:numazu` writes the finest Gaussians as a reference-3DGS PLY next to
the LAS, a tile pyramid with a `tilejson.json` to `demo/tiles/numazu/`, and
the same tiles as one PMTiles archive, `demo/tiles/dorayaki-numazu.pmtiles`
(tile type MLT, gzip directories). That archive is what goes to stars, where
Martin serves it as `https://stars.optgeo.org/dorayaki-numazu/{z}/{x}/{y}`.
Placement on stars follows the stars project's procedure and needs hfu's
instruction to the stars session. The pyramid holds
aggregated z18 and z19 tiles and z20 maxzoom tiles in a 3-level
progressive order (`documents/progressive-maxzoom.md`). The demo draws the
tiles and levels that match the map zoom. Open <http://127.0.0.1:8000/demo/?fixture=numazu>
while `npm run demo` is running. Heights are the source's elevations
(標高), so on the flat basemap the data floats at its real elevation,
about 7.5 m above the map plane.

## License

CC0 1.0 Universal. See `LICENSE`.
