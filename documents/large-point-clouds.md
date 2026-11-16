# Large point clouds: streaming build and Virtual Shizuoka data

Status: implemented and run on one 196.6-million-point mesh (Kawazu). The
numbers below are measurements from `NOTES.md` and `EXPERIMENTS.md`; where a
figure is an extrapolation it says so.

## Why a streaming build

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
[numazu-demo.md](numazu-demo.md)). Adaptive merging is switched on with
environment variables (see [adaptive-merging.md](adaptive-merging.md)).

### How it works

| piece | file | role |
| --- | --- | --- |
| LAS header and chunked records | `src/pointcloud/las.ts` | `parseLasHeader`, `forEachLasRecord`: formats 0-3, no LAZ |
| per-voxel moments | `src/pointcloud/voxel-accumulator.ts` | hash table of count, mean offsets, second moments, colour; chunked storage so growth never copies records |
| Gaussian from moments | `src/pointcloud/voxel-gaussians.ts` | `gaussianFromMoments`, shared with the in-memory fit |
| pyramid from a callback | `src/pointcloud/pyramid.ts` | `buildPyramidFrom(fit, origin, config)`; `buildPyramid` calls it with the in-memory fit |
| the script | `scripts/build-tileset.ts` | reads files in 64 MB chunks into one accumulator per voxel size, builds the pyramid, writes tiles and PMTiles |

One pass over the file feeds every voxel size at once (each aggregated zoom
and the maxzoom have their own grid, because tile widths at different zooms
are not exact powers of two). The in-memory and streaming fits agree: the
voxel counts and positions on Numazu are identical, and about 6 to 12 % of
records differ in the last quantization step of z, a colour level or the
rotation code (a different summation order).

### Measured on the Kawazu MMS mesh

| | |
| --- | --- |
| points | 196,608,664 (LAS 6.68 GB) |
| count pass, two grids (z18, z19) | 22.2 s, 8.84 M points/s, 0.81 GB resident |
| voxels | z18 (24.5 cm) 1,232,293; z19 (12.3 cm) 4,384,382 |
| 50 cm tileset, z16 + z17 | 20 s, 0.68 GB |
| 25 cm tileset, z16 to z18 | 36 s, 1.46 GB |

The per-voxel Gaussians and the placement and tile split still use ordinary
JavaScript objects, so very large voxel counts (tens of millions) would need
a tile-by-tile fit. That is not implemented; it is the next step if a mesh
needs it.

## Virtual Shizuoka data

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

### Kawazu loop bridge: what exists for `08OF4060`

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

### Filters in the tileset builder

`file.las@c2+1@first`: `@c<n>[+<n>...]` keeps those classes, `@first` or
`@last` only first or last returns. The effect of the choices on size is in
[size-and-scale.md](size-and-scale.md) (E007).

Other things checked, not used: `2019/ALB` covers meshes `08NE`, `NF`, `OE`,
`OF`, `PE` (bathymetry). The 2019 MMS ground-and-structures data of zone 08
is 1,795 zips, 1.56 TB in all.

Ground only (E019): `file.las@c2` keeps the ground class. In the Virtual Shizuoka 2019 data class 2 is ground in both the airborne
and the MMS files, so `npm run build:tileset -- "<mms.las>@c2,<lp.las>@c2" 8 kawazu-ground 17 16 15` gives a bare-earth tileset
(mesh 08OF4060: 52,570 z17 splats and 0.81 MB in all, against 702,139 splats and 13.1 MB with everything).

## Merging tilesets built apart

`scripts/merge-tilesets.ts` (`npm run merge:tilesets`) joins tilesets of
`demo/tiles/<dir>/`: tiles with the same address are decoded, concatenated and
re-encoded as one level; the rest are copied; it writes `demo/tiles/<name>/`
and `dorayaki-<name>.pmtiles` (raw tiles unless `DORAYAKI_TILE_COMPRESSION=gzip`).
Seams are not reconciled: a voxel cut by the edge between two meshes is fitted in
each, so splats may overlap there, and a re-encoded tile has been quantized twice
(about 0.5 mm in z, a fraction of a degree in rotation).

## The 3 x 3 block around Kawazu

Meshes `08OF4050` to `08OF4072` (rows 5 to 7, columns 0 to 2): LP "Ground" for all
nine (266 to 361 MB each), MMS for 4050 (860 MB), 4070 (52 MB), 4071 (1,058 MB)
and the 4060 already used. Downloaded on 2026-11-15 (11 files, 4.8 GB, eleven
connections at once; two large zips finished with five range requests each,
since one connection gave only 0.3 to 0.4 MB/s), each zip checked against its
listed size, unzipped and deleted; 13 LAS files, 476,004,940 points. Sizes and
results: E009 in [EXPERIMENTS.md](../EXPERIMENTS.md).

## Not yet done

- A tile-by-tile fit for meshes of tens of millions of voxels.
- Reading LAZ or COPC.
- Several meshes at once (the script takes any number of files, but only the
  meshes of one small area have been run).
- A dam site with laser returns below the water surface was not identified.
