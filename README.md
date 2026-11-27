# Dorayaki

**Carry 3D Gaussian splats, made from point clouds, in ordinary z/x/y map
tiles — and draw them in MapLibre GL JS.**

An experiment, not a standard. [日本語の要約は下](#日本語)

**[Try it in your browser →](https://dwg7.unopengis.org/dorayaki/)** (needs
WebGL2) · [Sasebo, 17 km2 of airborne laser points, with a camera tour](https://dwg7.unopengis.org/dorayaki/?fixture=sasebo)
· [the Kawazu loop bridge](https://dwg7.unopengis.org/dorayaki/?fixture=kawazu)
· [a real point cloud at Numazu, Japan](https://dwg7.unopengis.org/dorayaki/?fixture=numazu#map=20/35.13419/138.81596/0/60)
· [a bridge with its underside](https://dwg7.unopengis.org/dorayaki/?fixture=bridge)
· [an overhang](https://dwg7.unopengis.org/dorayaki/?fixture=overhang)

Drag to pan, right-drag or Ctrl-drag to rotate and tilt. The camera is in
the URL, so you can share a view.

## The idea

> Horizontal addressing uses tiles. Tile contents use surfels.

Map tiles address the world in two dimensions. Terrain in a tile is usually
a height field: one height per horizontal position. That cannot hold a
bridge and the road under it, a vertical wall, an overhang, or a tree
crown. Dorayaki keeps the familiar `z/x/y` addressing and puts a
three-dimensional distribution of splats inside each tile. Several splats
may share the same horizontal position at different heights and
orientations.

A splat is the primitive of 3D Gaussian Splatting: a position, three
scales, a rotation and a color. Here it is quantized into **16 bytes**
(Surfel Block version 5) or **12 bytes** (version 6, used by the hosted
Kawazu and Sasebo archives).

## What has been demonstrated

- **Round trip.** A Surfel Block (the tile's contents) encodes and decodes
  within stated quantization tolerances (`npm test`).
- **Not a height field.** The `bridge` and `overhang` fixtures hold
  multiple heights at the same x/y and render correctly from above and
  below.
- **Real data, small.** One mobile-mapping point cloud mesh
  (976,195 points, VIRTUAL SHIZUOKA, Numazu) becomes a 603 KB PMTiles
  archive in its default `coarse` form: **0.12×** the size of the same
  points as COPC. That is a coarse picture (one splat per 12 cm cell), not
  a lossless copy; finer profiles are 0.43× and 0.50× COPC. See
  [documents/numazu-demo.md](documents/numazu-demo.md) and
  [EXPERIMENTS.md](EXPERIMENTS.md).
- **Real data, large.** The Kawazu loop bridge and the valley below it: 476
  million points (mobile mapping and airborne laser, 1.08 km2, nine survey
  meshes) become an 83 MB PMTiles archive of 6.94 million splats (about 77 bytes
  per square metre), served from stars. The demo loads only the tiles in view.
  Vegetation is kept as coarse blobs; flat, evenly colored ground as large
  splats. See [documents/kawazu-demo.md](documents/kawazu-demo.md),
  [documents/large-point-clouds.md](documents/large-point-clouds.md) and
  [documents/size-and-scale.md](documents/size-and-scale.md).
- **A wider area.** Around Sasebo Bay, 32 Open Nagasaki sheets of airborne
  laser points (CC BY 4.0; about 17 km2, 201 million points, about 10 points
  per square metre) become a 714 MB PMTiles archive with zooms 13 to 17,
  built tile by tile in about ten minutes on an 8 GB laptop. Below z17 a tile
  is capped in size (merged harder where the points are dense), so a view of
  the whole area loads 6 MB. See
  [documents/sasebo-expansion.md](documents/sasebo-expansion.md) and
  [documents/tile-aligned-build.md](documents/tile-aligned-build.md).
- **Smaller than point tiles.** For the same points, the archives are 1.5 to
  3 times smaller than 3D Tiles point tiles at Sasebo's density and 45 to 85
  times at Kawazu's, because they keep splats (occupied cells), not points;
  the individual points are given up. See
  [documents/size-vs-3d-tiles.md](documents/size-vs-3d-tiles.md).
- **Ordinary delivery.** The Numazu tiles are served from a normal HTTP tile
  endpoint ([TileJSON](https://stars.optgeo.org/dorayaki-numazu), backed by
  PMTiles) and drawn by a MapLibre GL JS custom layer, with pan, zoom,
  bearing and pitch.

## How it works

1. A point cloud is fitted with one Gaussian per voxel (`src/pointcloud/`);
   neighbouring voxels that are coplanar and alike in color are merged into
   larger splats.
2. Gaussians are assigned to the one tile containing their centre. Zoom
   levels below the maximum hold coarser aggregates; the level of detail is
   the ordinary tile zoom hierarchy. Large areas are built tile by tile
   (`build:tiled`): the points are scattered to their z17 tiles, each tile is
   built on its own grid, and the lower zooms are gathered from the pieces.
3. Each tile's splats are packed into a **Surfel Block** (`DSRF`, version 5 or 6; the hosted Kawazu archive is version 6, 12 bytes per splat)
   and wrapped in an **experimental MapLibre Tile frame**.
4. The browser fetches `z/x/y`, unwraps the frame, decodes the block, and
   draws instanced ellipses (round splats face the camera). On the larger
   tilesets it chooses tiles of several zooms by distance, covering the whole
   view within a byte and splat budget (40 MB, 4 million splats by default).

The three concerns are separable: the Surfel Block codec runs and is tested
without MapLibre; the frame wrapper skips unknown frames and rejects
malformed lengths; the renderer only sees decoded splats.

## Status and limits

Please read this before depending on anything here.

- **Not a specification.** The byte layout changes without notice and
  version numbers rise freely (it is at version 6, opt-in, and 5; breaking changes are
  stated in the format document).
- **Not an MLT assignment.** Frame tag `0xD0` is a local, unassigned value
  chosen for the experiment. The upstream MapLibre Tile implementation is
  unmodified.
- **Three real datasets.** Numazu (one mesh), Kawazu (nine meshes, 1.08
  km2) and Sasebo (32 sheets, about 17 km2). Size figures for a whole
  prefecture are extrapolations from these.
- **Tile selection** follows the camera's distance under a budget on Sasebo
  (`?mixed=1`, its default); elsewhere it follows the map zoom, so tilted views
  at close range there can pick the wrong detail.
- **A rendering form, not a survey product.** Positions are quantized (about
  1.6 cm at z17 in version 6) and merged further on flat ground; accuracy
  against ground truth has not been evaluated.
- **Frame time** was 16 to 17 ms (the display rate) at the Kawazu views
  tried on one Apple M1, which says little about weaker GPUs. Browser
  decoding measured about 0.23 µs per splat on a warm 389,000-splat tile
  (E011, [size-and-scale.md](documents/size-and-scale.md)); a first,
  cold call on a small tile was about 3 µs (NOTES.md).
- **Mercator only**: no globe. Terrain is needed for data far above sea
  level (the camera is otherwise relative to 0 m): the Kawazu demo turns it
  on by default (lowered by 2 m); elsewhere it is the `?terrain=1` flag. Heights are orthometric (標高); the geoid
  model is not recorded in the block.
- No compression beyond quantization, no spherical harmonics, no
  source-point storage.

Observed findings are logged in [NOTES.md](NOTES.md); measured experiments
in [EXPERIMENTS.md](EXPERIMENTS.md).

## Read more

| document | contents |
| --- | --- |
| [documents/surfel-block-format.md](documents/surfel-block-format.md) | byte layout, quantization, coordinate frame |
| [documents/mlt-frame.md](documents/mlt-frame.md) | the experimental MLT frame envelope |
| [documents/progressive-maxzoom.md](documents/progressive-maxzoom.md) | maxzoom and nested refinement order |
| [documents/numazu-demo.md](documents/numazu-demo.md) | rebuilding and hosting the Numazu tiles; profiles |
| [documents/demo-and-site.md](documents/demo-and-site.md) | running the demo locally, URL flags, demo modules, the Pages site |
| [documents/large-point-clouds.md](documents/large-point-clouds.md) | streaming build of big LAS files; Virtual Shizuoka data and Kawazu |
| [documents/adaptive-merging.md](documents/adaptive-merging.md) | merging coplanar splats; covering gaps (`?extent=`) |
| [documents/size-and-scale.md](documents/size-and-scale.md) | what a tile and a prefecture cost; browser memory |
| [documents/kawazu-demo.md](documents/kawazu-demo.md) | the Kawazu tileset: recipe, size, hosting |
| [documents/sasebo-expansion.md](documents/sasebo-expansion.md) | the Sasebo tileset (Open Nagasaki): data, builds, recipes, hosting |
| [documents/tile-aligned-build.md](documents/tile-aligned-build.md) | building large areas tile by tile, in parallel |
| [documents/size-vs-3d-tiles.md](documents/size-vs-3d-tiles.md) | data size against 3D Tiles point tiles |
| [documents/class-plane.md](documents/class-plane.md) | carrying a class code per splat beside the block |
| [documents/dark-basemap.md](documents/dark-basemap.md) | the dark basemap under the point clouds |
| [documents/camera-direction.md](documents/camera-direction.md) | idea note on directed camerawork; the shot player (`?shots=`) |
| [documents/decisions-2026-11.md](documents/decisions-2026-11.md) | decisions of the Sasebo expansion, with reasons |
| [AGENTS.md](AGENTS.md) | project goals and working method |

## Development

Node.js 22 or later.

```sh
npm install
npm run typecheck   # type-check src/, test/, scripts/ and demo/src/
npm test            # compile and run node --test
npm run build       # compile src/ into dist/
npm run demo        # generate tiles, bundle, serve the demo locally
```

`npm run demo` serves on 127.0.0.1:8000; details and the other scripts
(`demo:numazu`, `site`, `measure:*`) are in
[documents/demo-and-site.md](documents/demo-and-site.md) and `AGENTS.md`.

Source layout: `src/surfel-block.ts` (codec), `src/mlt-frame.ts` (frame),
`src/pointcloud/` (point cloud → Gaussians → tile pyramid),
`src/fixtures/` (deterministic synthetic data), `demo/` (browser demo),
`test/`.

## 日本語

点群から作った 3D Gaussian Splatting のスプラットを、通常の z/x/y 地図タイルに
載せて MapLibre GL JS で描画する実験です。標準仕様ではありません。タイルの
住所は従来どおり2次元、中身は3次元のスプラットなので、橋とその下の道路、垂直面、
オーバーハング、樹冠のように、同じ水平位置に複数の高さがあるものも保持できます。
沼津の MMS 点群(976,195点)は、既定の `coarse` で 603 KB の PMTiles
(同じ点の COPC の 0.12 倍。粗い表現であり可逆ではありません)になります。
河津ループ橋と谷(1.08 km²、4.76 億点、航空レーザーと MMS)は、83 MB の PMTiles
(約 77 B/m²)で、stars から配信しています。佐世保湾周辺(オープンナガサキの航空レーザー
点群 32 図郭、約 17 km²、2.01 億点)は、ズーム 13〜17 の 714 MB の PMTiles で、
全域を見渡す表示でも 6 MB の読み込みで済みます。カメラツアーも再生できます。
同じ点を 3D Tiles の点タイルで持つより、佐世保の密度で 1.5〜3 倍、河津で 45〜85 倍
小さくなります(点そのものは保持しません)。表示範囲のタイルだけを読み込みます。
サイズの県全体への換算は、これらからの外挿です。
[ブラウザで試す](https://dwg7.unopengis.org/dorayaki/)。

## License

CC0 1.0 Universal. See `LICENSE`.
