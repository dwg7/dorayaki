# Sasebo Bay: areal expansion with the Open Nagasaki point cloud

Status: investigation of one file and a first build of it (2026-11-23), looked at in the local demo. The wide area has not been built.

## Goal

Show the area around Sasebo Bay (about 15 km on a side, roughly half sea) as one seamless Dorayaki tileset. "Rough scale" is the bar: the numbers below are
estimates from one file, said so where they are.

## The data

Open Nagasaki (Nagasaki Prefecture), <https://opennagasaki.nerc.or.jp/terms.html>: airborne laser (LP) points merged into one cloud for the
whole prefecture, **CC BY 4.0**, no registration. One file per 1,000 m (east-west) x 750 m (north-south) sheet, LAS 1.2, uncompressed, JGD2011 plane
rectangular zone I. Mean file about 400 MB, largest 685 MB. The sheet code is the 1:2500 code plus a quarter digit (`01JE3513`); the file is
`https://opennagasaki.nerc.or.jp/storage/<date>/<municipality>/<code>.las.zip` (for this one,
`storage/20230712/sasebo-si_saza-chou/01JE3513.las.zip`; the path differs by area and is not listed anywhere we could read: the site's download button
fetches it, so the pane's own page has to be used to learn it).

### The one file read: `01JE3513` (central Sasebo, around the station)

| | |
| --- | --- |
| zip / LAS | 132,076,428 B (SHA-256 `9c5b8b3a7cf631735099ad1be2b07eed7d93adad512a20d642b03581d7e5c2ea`) / 190,729,129 B |
| format | LAS 1.2, point format 2 (RGB), software TREND-POINT, no VLRs (no CRS in the file) |
| points | 7,335,727 in 750,000 m2: **9.8 points/m2** (the Nagasaki station sheet in a published article has 24) |
| extent | X (east) 20,000 to 21,000, Y (north) 19,500 to 20,250, Z -0.4 to 92.5 m |
| classes | **all points class 1** (unclassified): there is no ground class, so `@c2` (ground only) is not possible |
| color | RGB 16-bit, mean about (26,100, 27,800, 26,700) of 65,535; no point is (0, 0, 0); 63,689 distinct colors in a 1/50 sample: real colors |
| axis order | X is the easting, Y the northing (the sheet contains the station at N 19,573, E 20,768 only in this order), as `measure-stream` and the builders assume |

Streaming voxel counts (`npm run measure:stream -- <las> 1 15 16 17 18`; 4.7 s, 0.85 GB for all four grids):

| zoom | voxel | voxels | points per voxel |
| ---: | ---: | ---: | ---: |
| 15 | 2.0 m | 630,093 | 11.6 |
| 16 | 1.0 m | 2,074,342 | 3.5 |
| 17 | 0.5 m | 4,878,174 | 1.5 |
| 18 | 0.25 m | 6,677,153 | 1.1 |

## First build of the one sheet (measured)

`DORAYAKI_BLOCK_VERSION=6 DORAYAKI_ATTRIBUTION='点群: 長崎県 オープンナガサキ (CC BY 4.0) を加工して作成' npm run build:tileset -- 01JE3513.las 1 sasebo-3513 17 16 15`:
the plain recipe, no adaptive merging and no sparse rule (Kawazu's recipe uses both), 210 s, 0.64 GB resident, 28 tiles.

| zoom | splats | bytes (v6) |
| ---: | ---: | ---: |
| 15 | 630,093 | 7.56 MB |
| 16 | 2,074,342 | 24.89 MB |
| 17 | 4,878,174 | 58.54 MB |
| all | 7,582,609 | 90.99 MB (PMTiles 90,994,864 B) |

That is **121 B/m2** for the three zooms and 43 B/m2 for z15 and z16 alone (the estimate below said 44). One splat per voxel at every zoom, so
the splat counts equal the voxel counts of the table above.

Looked at in the local demo (`?fixture=sasebo-3513`, a development entry, flat look, no terrain; Apple M1, the Browser pane):

- It reads as an aerial photograph made of splats: roofs, roads, a slope covered in trees, in 3D. At z17 with the view tilted 62 degrees (zoom 17.6) and
  at z16 (zoom 16.9) the result is good.
- z17 at zoom 18.6, straight down, with the default splat size shows white gaps between splats (1.5 points per voxel); `?extent=1.8` closes them.
  z17 is therefore usable but thin; z16 (1 m, 3.5 points per voxel) is the better base for this density.
- The sheet's edges are visible (the data ends at the sheet), as expected for one sheet.
- The tileset's attribution was the Shizuoka text, hard-coded in `build-tileset.ts` and `build-tiled.ts`; it is now `DORAYAKI_ATTRIBUTION` when set.
- In the pane the splats appeared only after a `triggerRepaint()` and the status line stayed at "0/6 tiles" although all six had been delivered; not
  investigated (the pane was freshly opened; may be the hidden-pane effect of NOTES.md).

## What follows (estimates, not measured on a build)

- **Resolution**: at 9.8 points/m2 a 0.5 m voxel holds 1.5 points, too few for a well-fitted splat; 1 m voxels hold 3.5. z16 looks good and z17 is usable
  with a larger splat size (see the first build above).
- **Size**: z16 alone is 2.07 million splats per 0.75 km2 (12 B each in Surfel Block v6: 25 MB), about 33 B/m2, 44 B/m2 with z15 and z14 above it. For
  about 110 km2 of land, **roughly 5 GB**; with z17 (78 B/m2, the Kawazu figure) about 9 GB. The sea sheets are small.
- **Input**: about 150 land sheets at 130 to 400 MB: **25 to 60 GB of LAS**.
- **Compute**: about 10 CPU hours at the cost per voxel of the Kawazu builds (the cost follows the voxel count, 5 to 7 times a Kawazu mesh per sheet).
- **Disk**: the tile-aligned build scatters every point to shard files (16 B per point): 9.8 points/m2 x 110 km2 x 16 B is about **17 GB**, with 22 GB free
  on the build machine (95 % full). One sheet at a time with the shards of its tile row, or an external disk, is needed; the first archive would be
  written by `merge:tilesets` sheet by sheet if the shards cannot be kept.
- **Hosting**: stars has held one archive of at most 84 MB; a multi-GB archive needs the stars session's answer first.

## Not checked

- Vertical datum against the DEM the demo uses (E010 style comparison); sea level reads about 0 m in this file.
- Whether the coast and the water edge need special handling (no returns on water; this sheet has no sea).
- Adaptive merging and the sparse rule on this data; terrain in the demo (the Kawazu DEM shift of 2 m is not known to apply).
- The other sheets' point density and classification (the Nagasaki station sheet has 24 points/m2; this one 9.8).
- Whether sheets overlap or leave gaps at their edges.
- The file paths of the other sheets (`<date>/<municipality>` differs by area).

## Proposed next steps

1. **Done** (above). Next: the same with the adaptive recipe, and a second sheet beside it (a coastal one) to see the seam and the water edge.
2. Decide the build route for the whole area against the disk (above); ask the stars session about a multi-GB archive.
3. Learn the paths of the sheets of the target area (the site's page keeps them in a closure; the selection list shows only ids and sizes).
