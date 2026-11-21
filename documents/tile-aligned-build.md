# Tile-aligned, parallel build (design study, E022)

Status: a **study**; step 1 of the plan, the `TileFramer` module, is implemented (`src/geodesy/tile-frame.ts`, E022 follow-up). The rest is not. The measurements and the two scripts behind it are in E022 (EXPERIMENTS.md):
`npm run measure:frame` and `npm run prototype:tile-scatter`. Nothing here changes the hosted archive or the tile format.

## Why look at it

The Kawazu archive is built mesh by mesh (one survey mesh of 300 x 400 m per `build:tileset` run) and the tilesets are merged
(`merge:tilesets`). That is parallel in a crude way (the builds are independent), and it is how nine meshes were built in about
6 minutes 40 seconds on one machine. For a region of 1,000 km2 it means about 8,300 meshes, about 100 CPU hours (E022 table), and a
build whose outputs disagree where the meshes meet.

## What is wrong with mesh-by-mesh (measured)

1. **The frame ignores the grid convergence.** Each mesh is placed in a flat east/north frame around its own centre. Grid north of the
   plane rectangular system is 0.2496 degrees from true north at Kawazu, so each mesh is rotated by that angle about its centre, and two
   neighbours disagree about the same ground point: 400 m apart east-west, **1.77 m north** (and 0.41 m east); 300 m apart north-south,
   **1.06 m north and 1.31 m east** (real `placeGaussians`, `npm run measure:frame`). Features that cross a mesh seam jog by that much in the
   archive (a road of 6 m, a stream). Against the exact conversion, one airborne file (08OF4062) is placed with a mean error of 0.63 m and a
   worst of 1.62 m (`prototype:tile-scatter`). The error grows with the distance from the frame's origin: a build of a whole prefecture in one
   frame would be 4.4 m off after a kilometre.
2. **The voxel grids of neighbouring meshes differ.** The voxel size is the tile width at the origin's latitude divided by 512, and the tile row of
   the origin decides the width: 0.490393, 0.490406 and 0.490420 m for the three mesh rows of Kawazu; the sizes of z16 and z15 are not exactly
   twice and four times it. So the grids do not nest, and the voxels along a seam are fitted twice (E009 already noted this).
3. **Merging is serial and re-encodes** the tiles at the seams (two quantizations), and builds the whole PMTiles archive in memory.

Not a data-size problem: the duplicated voxels are a strip of a voxel along each seam (under 1 % of the area at z17, more at z15). The
jog is the visible defect.

## Design

**One principle: voxelize in the frame of the output tile.**

- Every point (plane easting, northing, height) is projected into the frame of the z17 tile it falls in: metres east and south of the
  tile's north-west corner. The projection of a tile is an affine map fitted from three exact conversions near its centre
  (`src/geodesy/jprcs.ts`; there is only the inverse conversion, so the frame is anchored at the plane point that the coarse map puts at the
  tile's centre). Measured on 4,000 points of 18 million: **0.77 mm mean and 2.17 mm worst error** against the exact conversion, against
  0.63 m and 1.62 m for the present frame. The tile of a point is chosen with a coarse frame on a 1 km grid and then confirmed in the tile's
  own frame (a point within millimetres of an edge steps to the neighbour; after three steps it is clamped: 141 of 18.2 million points were
  still outside and need that rule).
- The voxel grid is the tile's: cells of tile width / 512 starting at the tile corner. Cells of z17 line up with the tile edges, and the
  cells of z16 and z15 are exactly 2 and 4 times larger and nest exactly (a z16 cell is 2 x 2 x 2 z17 cells).
- The adaptive merge cuts cells up to 2^3 cells larger, and 512 is divisible by 8: **no merge group crosses a tile edge, at z17, z16 or z15**.
  A tile's z17, z16 and z15 Gaussians can therefore be built from the tile's own points alone: no halo, no overlap, no seam.
- Each z17 tile is an independent job. Its z17 tile is final. Its z16 and z15 Gaussians are pieces of coarser tiles (a z16 tile is four
  jobs' pieces, a z15 tile sixteen): small (about a tenth of the splats), and joined by position in a cheap last step.

**Stages.**

| stage | unit of work | what it does |
| --- | --- | --- |
| plan | all files | read the LAS headers, list the z17 tiles that any file touches |
| scatter | one input file | project each point into its tile's frame, append compact records (tile-local x, y, z as float32, rgb, class and return byte: about 16 bytes) to shard files of that tile |
| tile | one z17 tile | read the tile's shards; accumulate at the tile grid; adaptive merge for z17, z16, z15 (as now, with the same thresholds); write the z17 tile (with its class plane) and the z16 and z15 pieces |
| gather | one z16 or z15 tile | join the pieces by position and write the tile |
| archive | all tiles | write the PMTiles directory (with leaf directories: done) and the tile data without holding the archive in memory (not done) |

Scatter is needed because LAS files are not sorted in space: without it each tile job would read every file that overlaps the tile, three
or four files of 300 to 700 MB, and filter them, more work than the tile itself.

**What stays the same:** the recipe (thresholds, levels, sparse rule scaled by zoom), the Surfel Block, the class plane, the archive.

## Cost (measured and estimated)

Per mesh in the present build (nine meshes, 476 million points, E022 table): accumulating the points is 111 s of 392 s (28 %); the adaptive
merge, placement and encoding are 281 s (72 %) at 25 to 39 s per mesh whatever the number of points; peak memory 0.5 to 1.5 GB (with class
slots). The airborne meshes (14 to 19 million points) cost as much as the 211-million-point MMS mesh.

Prototype on one airborne file (18.2 million points, 6 z17 tiles): scatter 7.3 s (2.5 million points per second, in JavaScript, with the
exact checks and a per-point map lookup), about as long as the present accumulation of that mesh (8.1 s). The densest tile holds 8.1 million
points (45 % of the file; an airborne tile has about 8 million points); the first 3 million of them gave 1.06 million voxels, accumulated in
1.1 s and merged in 3.3 s, 1.07 GB of memory. A whole tile therefore takes about 20 to 25 s and 1 to 1.5 GB: four or five workers on an 8 GB
machine; the total CPU time per square kilometre is about that of the present build (16 tiles, 360 s): **1,000 km2 is about 100 CPU hours either way**; what
changes is that it divides by the number of cores (about 6 hours on 16 cores, 1.5 hours on 64) with no seam work and no merge.

Tile partition against mesh partition with a halo: both need one scatter pass; a mesh partition would still need the 8 m halo of its
neighbours, a per-mesh frame with its convergence error, and a serial merge. The tile partition has none of them.

## TileFramer (step 1)

```ts
const framer = new TileFramer(zone, 17);          // plane rectangular zone 1..19, zoom of the tiles
const loc = framer.locate(easting, northing);     // { x, y, east, south, widthMetres, clamped }
```

- `locate` returns the z17 tile of a plane point and its position in that tile's frame: metres east and south of the north-west corner, in
  [0, widthMetres). `widthMetres` is `tileWidthMetres` of the tile (true metres at its centre latitude).
- The frame of a tile is an affine map from plane coordinates to tile units, fitted from five exact conversions (the anchor and central
  differences 50 m either side) at the plane point that the exact conversion maps to the tile's centre. That point is found by six Newton steps from a
  fixed start, so **the frame depends only on the tile**: processes that see different points first still agree on every frame, bit for bit.
- A coarse frame on a 1 km grid of plane coordinates chooses the tile; the tile's own frame confirms it. A point that falls outside there steps to
  the neighbour it falls in, at most three times, and then is clamped into the last tile (`clamped: true`, under 0.001 % of the points in the airborne and MMS
  files tried): every point goes to exactly one tile.
- Accuracy against the exact conversion (`jprcs.ts`): **z17: 0.61 mm mean and 1.69 mm worst over 4,000 points of 18.2 million (08OF4062); at most 5 mm in
  the tests (3,000 random points around Kawazu)**; the frames of the two tiles on either side of an edge differ by under 5 mm there. A z15 tile (1 km) is
  centimetres off at its corners (under 5 cm in the test): the error grows with the square of the width, so the plan uses z17 frames only and derives
  z16 and z15 from the z17 tile's own build. The flat frame of the present build is over 0.5 m off over one mesh (test).
- Throughput in JavaScript, including 4,000 exact checks and a per-tile map lookup: 2.4 million points per second on airborne points, 3.3 on MMS points.
- The conversion takes the survey convention (x northing, y easting); a LAS file stores the easting in X and the northing in Y.

## Outside observations (UNopenGIS/7#1030, a comment of 2026-11-17)

A reader building a point-cloud viewer for the whole city of Shizuoka (same source data) described a three-stage level of detail: wide area from
a plan view and elevation extracted from the points; middle zooms (z14 to z17) as Gaussian splats in 3D Tiles with SPZ compression; the highest
zooms by a ranged read of COPC with the splats made on the device. Splat conversion runs on a GPU, 8 jobs in parallel, 24 s per cell; a
laptop with an M5 chip is smooth, an M1 Mac mini stutters. These are reported claims, not measured here (cell size, point density and what the
conversion fits are not stated). What they change in this plan:

- **Step 2's function must not depend on Node.** Points of one tile in, splats of that tile out, with `TileFramer` for the frame: no file or stream
  access inside. The same function could then run in a worker for the on-device stage (points of a COPC range -> splats of the tile on screen) without
  a second implementation. This costs nothing now and is not an optimization in advance; running it in the browser is deferred.
- **Hand-off at low zoom** (not built): the buried splats at z12.7 and the terrain lift are the same problem the plan view and elevation stage
  solves. A tile range below some zoom drawn as a raster or terrain layer instead of splats is a candidate; to be judged by the E012 renderer
  against the aggregated zooms we have.
- **Size comparison** (not done): SPZ is a published splat format with its own quantization; a fair comparison with Surfel Block v6 (12 bytes per
  splat before gzip) needs the same splats in both. `measure:encoding` can give our side; the SPZ side is unverified.
- **Frame-rate budget** (not done): a stutter on weaker GPUs says the cost per frame (splat count, the soft look's two passes) should be measured on
  an M1-class machine and tied to the byte-aware cap for `?mixed=1`.
- **Cost reference**: our fit is about 100 CPU-hours per 1,000 km2; a GPU job of 24 s per cell cannot be compared until the cell size and what is fitted
  are known. Questions to ask in the issue: cell size, point count per cell, and whether the conversion is a trained 3DGS or a fit from points.
- **The seam finding may concern them too**: meshes placed up to 1.8 m apart by the meridian convergence matter for any build that works cell by
  cell on mesh-wise files; worth telling them once the tile-local build confirms it.

## Risks and open questions

- **The first archive after the change moves** (by up to a metre inside a mesh, 1.8 m across seams): the DEM shift of 2 m (E010, the DEM against the
  cloud: -0.9 to +0.7 m) was measured on the rotated data and has to be measured again; the terrain lift of the demo as well.
- **Scatter output size**: about 16 bytes per point, 8 to 10 GB for the nine meshes (the LAS files are 15 GB), about 2 TB for 1,000 km2, on a disk
  that has 13 GB free today. Compression or processing file by file against a running set of tile jobs would cut it.
- **Ties at tile edges**: points within a few millimetres of an edge need a deterministic rule (the prototype's step-and-clamp is one).
- **Only z17 is aligned.** A maxzoom of 18 or higher would need the same construction one level down (cells of z18 nest the same way); not tried.
- **Class slots and memory**: 18 doubles per voxel; a tile job's memory is dominated by the canopy voxels. A roll-up of z16 and z15 from the z17
  voxels instead of three accumulators would save the two extra passes over the points (an exact optimisation once the grids nest; not tried).
- **The orchestrator**: a job queue over processes (or machines), restart of a failed tile, a manifest of finished tiles. Not designed here.

## Proposed next steps (each small enough for one change)

1. **Done**: `TileFramer` (`src/geodesy/tile-frame.ts`, `test/tile-frame.test.ts`): the fitted frame per tile, anchored deterministically at the tile's centre, the step-and-clamp rule, tested against the exact conversion. See "TileFramer" below.
2. **Done** (`src/pointcloud/tile-build.ts`, E022 step 2; counts within 0.3 % at z17/z16, 3.4 % at z15 on the densest tile of 08OF4062; seams and on-screen look not yet compared): the tile-local build as a function (`points of one tile -> z17, z16, z15 pieces`), run on the prototype's densest tile and compared with the
   present build of the same area after undoing the rotation: same splat counts within the seam strip, same colors.
3. **Done, with open points** (`scripts/build-tiled.ts`, E022 step 3: archive 83,887,706 B against 84,036,082 B, same tile and splat counts to within 3 % at z15; identical bytes for 1, 2, 4 and 8 workers; speed-up not measured because the 8 GB machine is memory-bound; seam jogs not yet shown gone): scatter to shard files and a tile job runner (processes, a manifest), on the nine Kawazu meshes: compare the archive with the present one
   (size, seam jogs gone) and the time with 1, 4 and 8 workers.
4. The gather step and a streaming PMTiles writer; then the same for a larger area.
