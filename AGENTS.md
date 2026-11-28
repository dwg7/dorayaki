# AGENTS.md

## Project

Dorayaki is an experimental implementation for carrying and rendering
fully three-dimensional surfels in conventional two-dimensional map tiles.

Repository:

- https://github.com/dwg7/dorayaki

Dorayaki is an implementation experiment, not yet a specification.

## Core idea

Use conventional two-dimensional tile addressing while preserving a fully
three-dimensional surfel distribution inside each tile.

In short:

> Horizontal addressing uses tiles. Tile contents use surfels.

The tile contents must not be constrained to a single-valued height field.
Multiple surfels may occupy the same horizontal position at different
heights and orientations.

The representation must be able to preserve:

- vertical surfaces;
- overhangs;
- downward-facing surfaces;
- bridges and their undersides;
- floating objects; and
- multiple vertical layers at the same horizontal position.

## Current objective

Build the smallest complete proof of concept:

1. define a naive Surfel Block encoding;
2. encode and decode synthetic sample data;
3. embed the Surfel Block in an experimental MapLibre Tile frame;
4. decode it in a browser; and
5. render it in MapLibre GL JS.

The initial implementation should optimize for clarity, inspectability,
and end-to-end operation rather than compression or rendering performance.

## Working method

This project follows an experimental loop:

1. implement the simplest complete path;
2. run it on explicit fixtures;
3. observe a concrete limitation;
4. change one major design choice at a time;
5. compare with the previous implementation; and
6. retain or revert the change based on evidence.

Do not design the final wire specification in advance.

Do not introduce an optimization solely because it is likely to be useful.
Introduce it only after the naive implementation exposes the relevant
problem, except where the optimization is essentially free and does not
complicate the data model.

## Initial representation

Begin with a circular surfel containing:

- position: x, y, z as float32;
- normal: nx, ny, nz as float32;
- radius as float32; and
- color: r, g, b, a as uint8.

A straightforward 32-byte record is acceptable.

Begin with an Array of Structures layout unless a simpler implementation
requires otherwise.

The initial implementation does not require:

- elliptical surfels;
- full covariance matrices;
- Gaussian spherical harmonics;
- source point storage;
- progressive decoding;
- compression;
- quantized coordinates;
- dynamic spatial trees; or
- server-side tile generation.

These features may be investigated in later loops when a demonstrated
problem justifies them.

## Level of detail

For the initial proof of concept, level of detail is represented by the
normal tile zoom hierarchy.

Intra-tile progressive refinement is optional and must not be required by
the initial format or decoder.

Do not create competing mandatory LOD mechanisms at both the tile hierarchy
and intra-tile levels.

## MapLibre Tile integration

MapLibre Tile is the intended frame envelope for the Surfel Block.

Treat the initial frame tag and byte layout as experimental. Do not claim
that they are assigned or standardized MLT values.

Keep these concerns separable:

- Surfel Block encoding and decoding;
- wrapping and extracting the block as an MLT frame; and
- rendering decoded surfels.

A Surfel Block encoder and decoder must be testable without MapLibre GL JS.

An MLT embedding test must verify that:

- the frame can be found and decoded;
- it can coexist with other frames;
- an unknown frame can be skipped by its declared length; and
- malformed lengths are rejected safely.

Do not modify the upstream MapLibre Tile implementation during the first
proof of concept.

## PMTiles

PMTiles is a likely archive envelope, but it is not part of the first
vertical slice.

First load individual z/x/y tile files over ordinary HTTP.

Add PMTiles only after the standalone tile path works. The standalone and
PMTiles paths should use the same Surfel Block decoder.

## Browser implementation

Use TypeScript.

Begin with a MapLibre GL JS CustomLayerInterface implementation using
`renderingMode: "3d"`.

Do not modify MapLibre GL JS internals for the first proof of concept.

The first renderer should use WebGL2 and a deliberately simple rendering
method. Instanced circular discs are preferred if they remain simple.
A point-based debug renderer may be implemented first if useful.

Preserve the separation between:

- tile selection and loading;
- Surfel Block decoding;
- GPU resource creation; and
- MapLibre custom-layer lifecycle.

## Synthetic fixtures

Create deterministic synthetic fixtures rather than depending initially on
large external point-cloud datasets.

At minimum, provide:

- `plane`: a horizontal plane;
- `fold`: a horizontal plane meeting a vertical plane;
- `bridge`: ground, bridge deck, underside, and supports;
- `overhang`: an upper surface, vertical face, and downward-facing underside;
- `floating`: objects disconnected from the ground; and
- `boundary`: geometry crossing one or more tile boundaries.

The `bridge` and `overhang` fixtures are architectural tests. If they cannot
be represented and viewed correctly, the implementation has accidentally
degenerated into a height field.

Fixtures must be deterministic and reproducible from source code.

Do not commit large opaque binary fixtures without also retaining the code
that generates them.

## Validation

Every change should keep the shortest relevant validation path working.

At minimum, maintain automated tests for:

- encode/decode round-trip;
- zero-surfel blocks;
- one-surfel blocks;
- malformed or truncated input;
- invalid record count or byte length;
- MLT frame wrapping and extraction; and
- preservation of multiple z values at the same x/y position.

Once package scripts exist, keep the exact working commands in this file.

Current working commands (Node.js 22 or later):

```sh
npm install
npm run typecheck   # tsc --noEmit over src/, test/, scripts/, demo/src/
npm test            # tsc into build-test/, then node --test
npm run build       # tsc src/ into dist/
npm run demo:tile   # write demo tiles (demo/tiles/{bridge,overhang,boundary,toy-gs}/18/x/y.mlt)
npm run demo:build  # demo:tile + esbuild bundle of demo/src/main.ts
npm run demo        # demo:tile + bundle + serve http://127.0.0.1:8000/demo/
npm run site        # rebuild the GitHub Pages site in docs/ (commit the output)
npm run measure:codec     # encode/decode timing in Node (bridge, Numazu tiles)
npm run measure:quality -- <tileset dir> <ref zoom> <cand zoom|mixed> [<cand dir>] [--views lng,lat,zoom,bearing,pitch;...] [--out dir]  # E012: software-render both from fixed cameras, print holes/color/depth differences, optional PNGs
npm run build:tiled -- <name> <zone> <file.las[@filters][,file2.las ...]> [--workers N] [--centre lng,lat] [--keep]   # the builder (E022): scatter to shards, one job per z17 tile, gather, PMTiles; DORAYAKI_ADAPTIVE_LEVELS (required), _REFINE, _THICKNESS, _COLOR, _SPARSE; DORAYAKI_ZOOM_CELL_SCALE/_THICKNESS_SCALE/_COLOR_SCALE coarsen the lower zooms (E023); DORAYAKI_Z17_CELL_SCALE=2 coarsens z17 itself and a 17: entry caps a z17 tile (E025); DORAYAKI_LOWER_ZOOMS=16,15,14,13 and DORAYAKI_ZOOM_TARGET_SPLATS=16:100000,15:160000 (E024); DORAYAKI_CLASS_PLANE=1 writes a class plane (E021); DORAYAKI_TILE_COMPRESSION=gzip (default raw; Martin 1.14 cannot read gzip MLT tiles); DORAYAKI_ATTRIBUTION; work in data/tiled-work/<name>
npm run produce:opennagasaki -- <name> <count | codes file>   # unzip Open Nagasaki sheets and run build:tiled with the E024 and E025 recipe (documents/datasets.md); ON_DIR, LAS_DIR, WORKERS, CENTRE, REMOVE_LAS
DORAYAKI_NUMAZU_TILEJSON=... DORAYAKI_KAWAZU_TILEJSON=... DORAYAKI_SASEBO_TILEJSON=... npm run site  # list the hosted tilesets on the site (URLs with ?v=: documents/datasets.md)
```

Removed on 2026-11-27 (compaction; in Git at the tag `pre-compaction-2026-11-27`): `build:tileset`, `merge:tilesets`,
`demo:numazu`, the finished `measure:*` and prototype scripts, `DORAYAKI_BLOCK_VERSION`, Surfel Block versions 4 and 5.

Current repository structure:

```text
src/surfel-block.ts          Surfel Block encoder/decoder, version 6 only (12-byte bit-packed records; documents/format.md)
src/splat.ts                 splat geometry: rotations, disc <-> splat conversions
src/mlt-frame.ts             experimental MLT frame wrapper (tags 0xD0 surfel block, 0xD1 class plane)
src/class-plane.ts           class plane: one class code per splat beside the block
src/tile-geometry.ts         tile address -> lng/lat and tile width in metres
src/tiling.ts                centre-ownership split of a tile block into tiles (fixtures)
src/pmtiles.ts               minimal PMTiles v3 writer in memory (leaf directories when the root exceeds 16 KiB); pmtilesHead
src/pmtiles-file.ts          streaming PMTiles writer (Node): the archive written from tile files one at a time (used by build:tiled)
src/fixtures/                deterministic fixtures: plane, bridge, overhang, boundary (2 x 2 tiles), toy-gaussians (toy 3DGS PLY); sampling.ts shared
src/gaussian/ply.ts          minimal binary little-endian PLY reader/writer
src/gaussian/to-surfels.ts   3DGS Gaussian -> splat mapping and tile placement
src/pointcloud/las.ts        minimal LAS reader (formats 0-3, no LAZ); las-spec.ts: `file.las@c2@first` input specs
src/pointcloud/voxel-gaussians.ts  one Gaussian per voxel: moments, eigen decomposition; the in-memory fit is the tests' reference
src/pointcloud/voxel-accumulator.ts  the same fit, streaming: memory grows with voxels, not points
src/pointcloud/adaptive.ts   E005: merge coplanar, same-color voxel Gaussians into larger splats
src/pointcloud/tile-build.ts buildTilePieces: points of one z17 tile -> z17 splats and pieces of the lower zooms (to z13; E022 to E024)
src/pointcloud/tile-shard.ts shard records (16 bytes) of the tiled build
src/pointcloud/class-slots.ts class slots of the builder for the class plane (E021)
src/geodesy/jprcs.ts         JGD2011 plane rectangular -> latitude/longitude
src/geodesy/tile-frame.ts    TileFramer: plane point -> z17 tile and tile-local metres (E022)
src/index.ts                 package entry point
test/*.test.ts               node:test test suites
scripts/generate-demo-tile.ts  writes one demo tile per synthetic tileset
scripts/build-tiled.ts       the builder: scatter, tile jobs, gather, archive
scripts/produce-opennagasaki.sh  Open Nagasaki sheets -> build:tiled, with a run report
scripts/build-site.ts        builds docs/: single-file index.html (JS+CSS inline), worker, synthetic tiles, shots
scripts/measure-codec.ts     codec timing in Node
scripts/measure-quality.ts   E012/E015 quality comparison between tile zooms, tilesets, or the mixed-zoom choice
demo/index.html              demo page (MapLibre GL JS via import map)
demo/src/                    demo modules: load, TileJSON, decode, tile streaming and selection (mixed-selection.ts: E024 budget), placement, GPU (gpu-surfels.ts decodes v6 records in the vertex shader), layer, camera helpers, look controls, shot player and tour control; cpu-render.ts and image-metrics.ts serve measure:quality (documents/demo.md lists them)
demo/shots/                  shot scripts (pure JSON data; copied to docs/shots/ by npm run site); sasebo.json is the worked example
docs/                        built GitHub Pages site only (npm run site; do not edit by hand)
documents/format.md          Surfel Block version 6, the MLT frame and the class plane
documents/build.md           how tilesets are built (build:tiled, streaming fit, adaptive merging)
documents/demo.md            the demo, URL flags, modules, the Pages site, dark basemap, camera direction
documents/datasets.md        Numazu, Kawazu, Sasebo, Open Nagasaki: recipes, hosting, size and scale, size against 3D Tiles
documents/decisions.md       decisions with reasons, open items (2026-11-21 onward, the compaction)
documents/lineage.md         where surfels and splats come from (1985 to 2024) and what Dorayaki can take from it
EXPERIMENTS.md               experiments E001, E002, ...: question, measurements, decision
NOTES.md                     observed experimental findings (chronological)
```

Do not invent commands that are not present in package.json.

Completion criteria for the first vertical slice

The first vertical slice is complete when:

one deterministic synthetic fixture is generated;
the fixture is encoded into the naive Surfel Block;
the block survives an encode/decode round trip;
the block is wrapped in and extracted from an experimental MLT frame;
a browser demo loads the tile;
MapLibre GL JS renders the decoded surfels in geographic position; and
pan, zoom, bearing, and pitch continue to work.

Only after this slice works should additional fixtures and optimizations be added.

Change discipline

Prefer small, reviewable commits.

Do not combine a wire-format change, renderer rewrite, build-system change, and optimization in one step.

When changing the binary layout:

update the format description;
update the encoder and decoder together;
update or regenerate fixtures;
add or update tests; and
state whether backward compatibility is intentionally broken.

Breaking changes are acceptable during the experimental phase, but they must be explicit.

Documentation

Keep documentation factual.

Distinguish clearly between:

what is currently implemented;
what has been demonstrated;
what is only proposed; and
what has been deliberately deferred.

Do not describe Dorayaki as a standard.

Do not describe experimental frame tags as official MLT assignments.

Record important experimental findings in a short NOTES.md or equivalent log after they have been observed. Do not fill it with anticipated findings.

Security and repository hygiene

Do not add credentials, tokens, private URLs, or personal data.

Do not add generated dependency directories such as node_modules.

Do not add large binaries unless they are necessary to reproduce a specific experiment.

Use a permissive open-source license unless the repository owner directs otherwise.

Spelling: American English (`color`, not `colour`) in code, flags, environment variables and documents (unified 2026-11-17).
