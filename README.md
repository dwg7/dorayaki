# Dorayaki

**Carry 3D Gaussian splats, made from point clouds, in ordinary z/x/y map
tiles — and draw them in MapLibre GL JS.**

An experiment, not a standard. [日本語の要約は下](#日本語)

**[Try it in your browser →](https://dwg7.unopengis.org/dorayaki/)** (needs
WebGL2) · [a real point cloud at Numazu, Japan](https://dwg7.unopengis.org/dorayaki/?fixture=numazu#map=20/35.13419/138.81596/0/60)
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
scales, a rotation and a colour. Here it is quantized into **16 bytes**.

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
- **Ordinary delivery.** The Numazu tiles are served from a normal HTTP tile
  endpoint ([TileJSON](https://stars.optgeo.org/dorayaki-numazu), backed by
  PMTiles) and drawn by a MapLibre GL JS custom layer, with pan, zoom,
  bearing and pitch.

## How it works

1. A point cloud is fitted with one Gaussian per voxel (`src/pointcloud/`).
2. Gaussians are assigned to the one tile containing their centre. Zoom
   levels below the maximum hold coarser aggregates; the level of detail is
   the ordinary tile zoom hierarchy.
3. Each tile's splats are packed into a **Surfel Block** (`DSRF`, version 4)
   and wrapped in an **experimental MapLibre Tile frame**.
4. The browser fetches `z/x/y`, unwraps the frame, decodes the block, and
   draws instanced ellipses (round splats face the camera).

The three concerns are separable: the Surfel Block codec runs and is tested
without MapLibre; the frame wrapper skips unknown frames and rejects
malformed lengths; the renderer only sees decoded splats.

## Status and limits

Please read this before depending on anything here.

- **Not a specification.** The byte layout changes without notice and
  version numbers rise freely (it is at version 4; breaking changes are
  stated in the format document).
- **Not an MLT assignment.** Frame tag `0xD0` is a local, unassigned value
  chosen for the experiment. The upstream MapLibre Tile implementation is
  unmodified.
- **One small real dataset.** Conclusions about size come from a single
  point cloud.
- **Tile selection follows map zoom**, not the camera's distance to the
  data, so tilted views at close range can pick the wrong detail.
- **Frame time is unmeasured**, and browser decoding is slower than in
  Node (about 3 µs per splat vs 0.28 µs).
- **Mercator only**: no globe or terrain. Heights are orthometric
  (標高); the geoid model is not recorded in the block.
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
| [documents/demo-and-site.md](documents/demo-and-site.md) | running the demo locally, demo modules, the Pages site |
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
[ブラウザで試す](https://dwg7.unopengis.org/dorayaki/)。

## License

CC0 1.0 Universal. See `LICENSE`.
