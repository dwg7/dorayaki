# Build: from point clouds to a PMTiles archive

How tilesets are built. `npm run build:tiled` (scripts/build-tiled.ts) is the one builder; `npm run produce:opennagasaki` wraps it for Open Nagasaki sheets. The sections below were separate documents until 2026-11-27 and keep their dates.

Commands named in the older sections below that are no longer in package.json (`build:tileset`, `merge:tilesets`, `demo:numazu`, `measure:*` other than `measure:codec` and `measure:quality`, `prototype:tile-scatter`, `compare:tile-build`) and `DORAYAKI_BLOCK_VERSION` were removed on 2026-11-27 (compaction, [decisions.md](decisions.md)); they are in Git at the tag `pre-compaction-2026-11-27`. Their results are in EXPERIMENTS.md.

Contents: tile aligned build, large point clouds, adaptive merging.

## Tile-aligned, parallel build (design study, E022)

Status: **implemented and in use** (2026-11-27). The study below (2026-11-17) led to steps 1 to 4: the `TileFramer` module (`src/geodesy/tile-frame.ts`), the tile-local
build (`src/pointcloud/tile-build.ts`), the orchestrator (`npm run build:tiled`, `scripts/build-tiled.ts`) and the streaming archive writer (`src/pmtiles-file.ts`). It built the Kawazu grid
without the mesh seam and the hosted Sasebo archive (32 sheets; lower zooms to z13 with a size cap per tile, E024). Since then the pieces of the lower zooms are gzipped float64, not JSON (a third of the disk).
The rest of this page is the study as written, with each step's result added where it was done. The measurements and the two scripts behind it are in E022 (EXPERIMENTS.md):
`npm run measure:frame` and `npm run prototype:tile-scatter`. Nothing here changes the hosted archive or the tile format.

### Why look at it

The Kawazu archive is built mesh by mesh (one survey mesh of 300 x 400 m per `build:tileset` run) and the tilesets are merged
(`merge:tilesets`). That is parallel in a crude way (the builds are independent), and it is how nine meshes were built in about
6 minutes 40 seconds on one machine. For a region of 1,000 km2 it means about 8,300 meshes, about 100 CPU hours (E022 table), and a
build whose outputs disagree where the meshes meet.

### What is wrong with mesh-by-mesh (measured)

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

### Design

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
| archive | all tiles | write the PMTiles directory (with leaf directories) and the tile data without holding the archive in memory (done: `src/pmtiles-file.ts`) |

Scatter is needed because LAS files are not sorted in space: without it each tile job would read every file that overlaps the tile, three
or four files of 300 to 700 MB, and filter them, more work than the tile itself.

**What stays the same:** the recipe (thresholds, levels, sparse rule scaled by zoom), the Surfel Block, the class plane, the archive.

### Cost (measured and estimated)

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

### TileFramer (step 1)

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

### Outside observations (UNopenGIS/7#1030, a comment of 2026-11-17)

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

### Risks and open questions

- **The first archive after the change moves** (by up to a metre inside a mesh, 1.8 m across seams): the DEM shift of 2 m (E010, the DEM against the
  cloud: -0.9 to +0.7 m) was measured on the rotated data and has to be measured again; the terrain lift of the demo as well.
- **Scatter output size**: about 16 bytes per point, 8 to 10 GB for the nine meshes (the LAS files are 15 GB), about 2 TB for 1,000 km2, on a disk
  that has 13 GB free today. Compression or processing file by file against a running set of tile jobs would cut it.
- **Ties at tile edges**: points within a few millimetres of an edge need a deterministic rule (the prototype's step-and-clamp is one).
- **Only z17 is aligned.** A maxzoom of 18 or higher would need the same construction one level down (cells of z18 nest the same way); not tried.
- **Class slots and memory**: 18 doubles per voxel; a tile job's memory is dominated by the canopy voxels. A roll-up of z16 and z15 from the z17
  voxels instead of three accumulators would save the two extra passes over the points (an exact optimisation once the grids nest; not tried).
- **The orchestrator**: a job queue over processes (or machines), restart of a failed tile, a manifest of finished tiles. Not designed here.

### Proposed next steps (each small enough for one change)

1. **Done**: `TileFramer` (`src/geodesy/tile-frame.ts`, `test/tile-frame.test.ts`): the fitted frame per tile, anchored deterministically at the tile's centre, the step-and-clamp rule, tested against the exact conversion. See "TileFramer" below.
2. **Done** (`src/pointcloud/tile-build.ts`, E022 step 2; counts within 0.3 % at z17/z16, 3.4 % at z15 on the densest tile of 08OF4062; seams and on-screen look not yet compared): the tile-local build as a function (`points of one tile -> z17, z16, z15 pieces`), run on the prototype's densest tile and compared with the
   present build of the same area after undoing the rotation: same splat counts within the seam strip, same colors.
3. **Done, with open points** (`scripts/build-tiled.ts`, E022 step 3: archive 83,887,706 B against 84,036,082 B, same tile and splat counts to within 3 % at z15; identical bytes for 1, 2, 4 and 8 workers; speed-up not measured because the 8 GB machine is memory-bound; the density dip of about 12 % that the mesh seams leave is gone; the lateral jog itself not measured directly): scatter to shard files and a tile job runner (processes, a manifest), on the nine Kawazu meshes: compare the archive with the present one
   (size, seam jogs gone) and the time with 1, 4 and 8 workers.
4. **Done (writer)**: `src/pmtiles-file.ts` `writePmtilesFile` writes the archive from the tile files one at a time (the same bytes as `writePmtiles`: the two-sheet Sasebo archive has the same SHA-256 as before; tests in `test/pmtiles-file.test.ts`), and `build-tiled.ts` uses it, so the archive stage no longer holds the tiles. Measured on 600 synthetic tiles of 2 MB (1.26 GB): peak 85 MB against 827 MB for the in-memory writer (that figure understates it: the synthetic tiles are mostly zero pages). Not done: the gather of the z16 and z15 pieces still reads their JSON pieces per tile (small), and the whole set of tile files stays on disk; a larger area (Sasebo, about 6 km2) is the next run.

## Large point clouds: streaming build and Virtual Shizuoka data

Status: implemented and run on one 196.6-million-point mesh (Kawazu). The
numbers below are measurements from `NOTES.md` and `EXPERIMENTS.md`; where a
figure is an extrapolation it says so.

### Why a streaming build

`npm run demo:numazu` reads a whole LAS file into memory (`readLas`). That
works for Numazu (976,195 points, 34 B each) and not for a 6.7 GB file. The
streaming path keeps memory proportional to the number of **occupied voxels**,
not to the number of points.

```sh
# one or more LAS files (comma-separated) -> demo/tiles/<name>/ and
# demo/tiles/dorayaki-<name>.pmtiles
npm run build:tileset -- <file.las[,file2.las]> <zone> <name> <maxzoom> [aggregated zoom ...]

# an area too large for one process (the voxel accumulators need about 100 bytes per
# voxel; this machine has 8 GB): build each mesh alone, then merge the tilesets
npm run merge:tilesets -- <name> <dir name> [<dir name> ...]

# counts only (no tiles): voxel counts, time, memory per zoom
npm run measure:stream -- <file.las> <zone> [zoom ...]
```

For example, the 50 cm Kawazu set is
`npm run build:tileset -- data/virtual-shizuoka/2019-mms-08OF4060/08OF4060.las 8 kawazu-50cm 17 16`.
`<zone>` is the JGD2011 plane rectangular zone (VIII for Shizuoka). One level
per tile, cells = tile width / 512 at each zoom (the `coarse` rule of
[datasets.md](datasets.md)). Adaptive merging is switched on with
environment variables (see [build.md](build.md)).

#### How it works

| piece | file | role |
| --- | --- | --- |
| LAS header and chunked records | `src/pointcloud/las.ts` | `parseLasHeader`, `forEachLasRecord`: formats 0-3, no LAZ |
| per-voxel moments | `src/pointcloud/voxel-accumulator.ts` | hash table of count, mean offsets, second moments, color; chunked storage so growth never copies records |
| Gaussian from moments | `src/pointcloud/voxel-gaussians.ts` | `gaussianFromMoments`, shared with the in-memory fit |
| pyramid from a callback | `src/pointcloud/pyramid.ts` | `buildPyramidFrom(fit, origin, config)`; `buildPyramid` calls it with the in-memory fit |
| the script | `scripts/build-tileset.ts` | reads files in 64 MB chunks into one accumulator per voxel size, builds the pyramid, writes tiles and PMTiles |

One pass over the file feeds every voxel size at once (each aggregated zoom
and the maxzoom have their own grid, because tile widths at different zooms
are not exact powers of two). The in-memory and streaming fits agree: the
voxel counts and positions on Numazu are identical, and about 6 to 12 % of
records differ in the last quantization step of z, a color level or the
rotation code (a different summation order).

#### Measured on the Kawazu MMS mesh

| | |
| --- | --- |
| points | 196,608,664 (LAS 6.68 GB) |
| count pass, two grids (z18, z19) | 22.2 s, 8.84 M points/s, 0.81 GB resident |
| voxels | z18 (24.5 cm) 1,232,293; z19 (12.3 cm) 4,384,382 |
| 50 cm tileset, z16 + z17 | 20 s, 0.68 GB |
| 25 cm tileset, z16 to z18 | 36 s, 1.46 GB |

The per-voxel Gaussians and the placement and tile split still use ordinary
JavaScript objects, so very large voxel counts (tens of millions) would need
a tile-by-tile fit. That is now the tile-aligned build (`build:tiled`, E022,
documents/build.md): it builds one z17 tile at a time from its own points, in parallel, and was used for the
Kawazu grid and for Sasebo (32 sheets, 201 million points). `build:tileset` remains for one mesh or a few.

### Virtual Shizuoka data

Source: Shizuoka Prefecture, VIRTUAL SHIZUOKA, CC BY. The bucket
`virtual-shizuoka.s3.ap-northeast-1.amazonaws.com` has a public listing.
Nothing under `data/` is committed.

```
<year>/<kind>/<product>/<zone>/<50 km cell>/<5000-scale cell>/<mesh>.zip
e.g. 2019/MMS/Ground/08/OF/40/08OF4060.zip
     2019/LP/Ground/08/OF/40/08OF4060.zip
```

- Years: 2019 to 2022 and 2025. Kinds: `ALB` (airborne laser bathymetry),
  `LP` (airborne laser), `MMS` (vehicle mobile mapping), `Backpack`, `UAV`,
  `MISC`.
- A mesh code such as `08OF4060` is zone 08, 50 km-class cell `OF`
  (30 km north-south, 40 km east-west), 5000-scale cell `40` (3 km x 4 km),
  sub-cell `60` (300 m x 400 m). Zone VIII plane coordinates: row `A` starts at
  X = +300 km, column `A` at Y = -160 km.
- The listing is cheap; a zip's contents can be inspected without downloading
  it by reading its central directory and the first bytes of the LAS with HTTP
  range requests.

#### Kawazu loop bridge: what exists for `08OF4060`

| product | file | size | notes |
| --- | --- | --- | --- |
| 2019 MMS ground-and-structures point cloud | `2019/MMS/Ground/08/OF/40/08OF4060.zip` | 2,940 MB (LAS 6.68 GB) | LAS 1.2 format 3, 196,608,664 points, about 1,730 points/m², E 40,001.8 to 40,380.4, N -134,100.0 to -133,800.0, Z 177.1 to 245.2 m; Aero Asahi Corp. |
| 2019 LP "Ground" | `2019/LP/Ground/08/OF/40/08OF4060.zip` | 275 MB (LAS 495 MB), SHA-256 `48c2a817...ca1274` | LAS 1.2 format 3, 14,551,545 points, about 121 points/m² over the mesh, Z 125.5 to 364.1 m. Despite the folder name it holds **all returns**: 2,492,669 points of class 2 (ground) and 12,058,876 of class 1 (unclassified: canopy, structures). Per 1 m x 1 m cell the median z spread is 16 m (forested slope) |

`2020/LP/Ground` repeats the 2019 files (same sizes). `2021` and later `LP`
products (`Original`) do not cover this mesh. The MMS classes are 2 (26.7 M
points), 3 (43.5 M), 4 (24.8 M) and 5 (101.6 M), mostly vegetation along the
road.

Agreement of heights (both orthometric): on the 1,119 1 m cells where the LP
surface is locally flat (z range under 0.5 m) and the MMS has class-2 points,
LP minus MMS has median -0.175 m (quartiles -0.19 and -0.14). No gross datum
offset; the airborne ground sits about 17 cm below the MMS road surface.

#### Filters in the tileset builder

`file.las@c2+1@first`: `@c<n>[+<n>...]` keeps those classes, `@first` or
`@last` only first or last returns. The effect of the choices on size is in
[datasets.md](datasets.md) (E007).

Other things checked, not used: `2019/ALB` covers meshes `08NE`, `NF`, `OE`,
`OF`, `PE` (bathymetry). The 2019 MMS ground-and-structures data of zone 08
is 1,795 zips, 1.56 TB in all.

Ground only (E019): `file.las@c2` keeps the ground class. In the Virtual Shizuoka 2019 data class 2 is ground in both the airborne
and the MMS files, so `npm run build:tileset -- "<mms.las>@c2,<lp.las>@c2" 8 kawazu-ground 17 16 15` gives a bare-earth tileset
(mesh 08OF4060: 52,570 z17 splats and 0.81 MB in all, against 702,139 splats and 13.1 MB with everything).

### Merging tilesets built apart

`scripts/merge-tilesets.ts` (`npm run merge:tilesets`) joins tilesets of
`demo/tiles/<dir>/`: tiles with the same address are decoded, concatenated and
re-encoded as one level; the rest are copied; it writes `demo/tiles/<name>/`
and `dorayaki-<name>.pmtiles` (raw tiles unless `DORAYAKI_TILE_COMPRESSION=gzip`).
Seams are not reconciled: a voxel cut by the edge between two meshes is fitted in
each, so splats may overlap there, and a re-encoded tile has been quantized twice
(about 0.5 mm in z, a fraction of a degree in rotation).

### The 3 x 3 block around Kawazu

Meshes `08OF4050` to `08OF4072` (rows 5 to 7, columns 0 to 2): LP "Ground" for all
nine (266 to 361 MB each), MMS for 4050 (860 MB), 4070 (52 MB), 4071 (1,058 MB)
and the 4060 already used. Downloaded on 2026-11-15 (11 files, 4.8 GB, eleven
connections at once; two large zips finished with five range requests each,
since one connection gave only 0.3 to 0.4 MB/s), each zip checked against its
listed size, unzipped and deleted; 13 LAS files, 476,004,940 points. Sizes and
results: E009 in [EXPERIMENTS.md](../EXPERIMENTS.md).

### Not yet done

- A tile-by-tile fit for meshes of tens of millions of voxels.
- Reading LAZ or COPC.
- Several meshes at once (the script takes any number of files, but only the
  meshes of one small area have been run).
- A dam site with laser returns below the water surface was not identified.

## Adaptive merging and gap coverage

Status: implemented (`src/pointcloud/adaptive.ts`, demo `?extent=`), measured
on one 196.6-million-point mesh (Kawazu MMS). Experiments E005 and E006 in
[EXPERIMENTS.md](../EXPERIMENTS.md) hold the measurements; this page is the
design in one place. Nothing here is part of the wire format: the result is an
ordinary list of splats of different sizes in one level.

### The problem

A uniform grid spends the same number of splats on a flat road as on a tree
crown. At 49 cm cells (z17) Kawazu is 318,817 splats, 6.33 MB with z16. At
24.5 cm (z18) it is 1,232,293 splats, 26.0 MB.

### Adaptive merging

Starting from the occupied voxels of a streaming accumulator, each merge
level doubles the cell size. The occupied children of a parent cell are
combined exactly (parallel-axis moments, so the merged Gaussian is the fit of
all its points) and replaced by one Gaussian when

1. the smallest standard deviation of the merged points is at most
   `thickness` (the patch is still flat, or a line), and
2. every child's mean color is within `color` of the merged mean, per channel.

A parent that fails keeps its children and blocks every larger ancestor, so
splats of different sizes never overlap. A parent with one child passes
upwards unchanged so that it can still merge with neighbours later.

A third rule, the **sparse rule** (E008): a parent is also merged when every
child is supported by fewer than `sparseSupport` points, whatever the
thickness and color. A voxel supported by a handful of points carries little
more than the points; this is how vegetation volume is kept small (at 24
points, MMS + all airborne returns of Kawazu fall from 73.4 MB uniform to
20.0 MB). Merging applies to every zoom of the pyramid. A coarser zoom has cells of 4 times
the area, which hold about 4 times the points, so the threshold is multiplied by
`DORAYAKI_ADAPTIVE_SPARSE_SCALE` (4 in the recipe) for each zoom below the
maxzoom: without it, the zooms below z17 held nearly as many splats as z17 (E009);
with it, the whole pyramid is 0.34 times the z17 size instead of 1.2 times.

Environment variables of `npm run build:tileset`: `DORAYAKI_ADAPTIVE_LEVELS`
(merge levels; enables the feature), `DORAYAKI_ADAPTIVE_REFINE` (start from
cells 2^refine times finer than the maxzoom's), `DORAYAKI_ADAPTIVE_THICKNESS`
(metres, default 0.05), `DORAYAKI_ADAPTIVE_COLOR` (default 0.1), `DORAYAKI_ADAPTIVE_SPARSE` (default 0 = off).
`npm run measure:adaptive -- <file.las> <zone> <base cell metres> <levels>`
prints splat counts for a grid of limits without writing tiles.

#### What was measured

- With a strict limit (5 cm) merging removes only 11 % (49 cm base) to 20 %
  (24.5 cm base) of the splats: most voxels here (trees, railings, walls,
  scanner noise) are not flat to 5 cm.
- A uniform 49 cm cell is itself up to 14 cm thick (cell / sqrt(12)), so a
  20 cm limit is not looser than the uniform grid. Starting from 24.5 cm cells
  with thickness 20 cm and color 0.2 gives 311,871 splats (6.22 MB), the same
  as the uniform 49 cm set (318,817; 6.33 MB), with the lane markings of the
  loop road visible in the adaptive one and blurred in the uniform one.
- In four oblique views no failure that the uniform 49 cm set does not already
  have was found. Not examined: railing close-ups, roof edges, airborne data.

### Gaps between splats

A splat is the 2-sigma ellipse. A square cell of side `s` filled evenly has a
standard deviation of `s / sqrt(12)` = 0.29 `s`, so the ellipse's semi-axis
(2 sigma) is 0.58 `s`, but the cell's corner is 0.71 `s` from its centre.
Neighbouring splats on a square lattice therefore leave a hole at every
corner, which shows as a regular pattern of white gaps on a road seen
obliquely. Covering the corners needs a factor of 0.71 / 0.58 = 1.22.

The demo has a debug flag `?extent=<factor>` that scales every splat's
semi-axes (`u_extent` in the shader). It is a drawing choice, not stored in
the data. The share of near-white (background) pixels in a screen rectangle
over the road (`dorayaki.holeFraction(rect)` in the page), at the close-up
view zoom 20.5, bearing -30, pitch 60:

| extent | uniform 49 cm | adaptive (20 cm, 0.2) |
| ---: | ---: | ---: |
| 1.0 | 5.05 % | 5.42 % |
| 1.2 | 1.24 % | 1.67 % |
| 1.3 | 0.97 % | 1.37 % |
| 1.5 | 0.62 % | 0.88 % |

Two other views (zoom 20.3 and 20.0) fall in the same direction but less: the
share has a floor from real gaps (foliage, sky) in the rectangle. The factor
also thickens thin structures and widens the overlap at edges; that cost was
not measured. A value near 1.3 is the working candidate; it is not the
default yet.
