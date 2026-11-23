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

## Two sheets: one process fails, the tile-aligned build works (measured)

Sheets `01JE3513` and the southern neighbour `01JE3531` (115,026,453 B zip, SHA-256 `5b0898458d2f40a9b5d9bb157ce4d01fd72ec14993e419c6035b3fc52bed30ac`;
6,473,740 points, 8.6 points/m2, all class 1, RGB present; 1.6 million voxels at 1 m and 4.1 million at 0.5 m), together 13.8 million points on 1.5 km2.

- `build:tileset` with both files in one process (plain recipe) **ran out of memory** after 13 minutes (the 8 GB heap; the voxel Gaussians are ordinary JS
  objects, `documents/large-point-clouds.md`). One sheet alone takes 210 s and 0.7 GB, so the cost is not linear: a second sheet is the difference.
- `build:tiled` (E022 step 3) on the same two files with 3 workers, the recipe merging at 3 levels (thickness 0.2, color tolerance 0.2, no sparse rule):
  **47 s wall** (scatter 2 s, tile jobs 32 s, gather 12 s; the tile jobs add up to 92 s, largest 0.84 GB), shards 221 MB (16 bytes per point as
  estimated), 51 tiles, 6.14 million splats (z15 0.93 M, z16 2.18 M, z17 3.03 M), **73.7 MB** (PMTiles 73,667,270 B, 49 B/m2). The z17 count is
  3.0 million against 9 million for the plain recipe of the two sheets. For this extrapolation, about 110 km2 would take about an hour with 3 workers and produce
  about 5 GB.
- Seen in the demo (`?fixture=sasebo-tiled`, a development entry; default look): it renders; I did not see a seam at the sheet edge at zoom 18.2, pitch 50.
  The merging makes large flat discs on parking lots and roofs and visibly coarser areas than the plain z17; whether the recipe (taken from Kawazu) is right
  for this density was not tuned.
- The archive is built in memory (E022 step 4 is not done): at 5 GB it would not fit in 8 GB of RAM.

## Hosted on stars (2026-11-23)

The two-sheet tile-aligned build is on stars as `dorayaki-sasebo.pmtiles` (73,667,266 B, SHA-256 `f49dc400e8f8790c50c526e04c374b19bc2537e0dd93fbda09b3775246047cc7`, raw
tiles because Martin 1.14 cannot read gzip MLT; 51 tiles, 6.14 million splats, z15 to z17, attribution 「点群: 長崎県 オープンナガサキ (CC BY 4.0) を加工して作成」):

- Naming: `dorayaki-<place>` as for Kawazu and Numazu; no mesh codes, dates or `-area` in the name; the version is the `?v=` of the TileJSON URL,
  `https://stars.optgeo.org/dorayaki-sasebo?v=20261123a`. When the area grows the same name is replaced.
- Verified: TileJSON served with the Pages origin; one z17 tile byte-identical to the local file; the site build (`DORAYAKI_SASEBO_TILEJSON`) loads it from stars
  (6 tiles at zoom 18.5, 9 at zoom 16.4) and lists `sasebo` among the fixtures.
- Recipe: `DORAYAKI_ADAPTIVE_LEVELS=3 _THICKNESS=0.2 _COLOR=0.2 _SPARSE=0 DORAYAKI_BLOCK_VERSION=6 DORAYAKI_ATTRIBUTION=... npm run build:tiled -- sasebo 1 "<01JE3513.las>,<01JE3531.las>" --workers 3 --centre 129.7198,33.1790`.
- Demo defaults for `sasebo`: terrain on and splat size 1.3 as for Kawazu; the dark basemap (bvmap-nightsky) like every point-cloud tileset.
- A showing view: `#map=16.4/33.1768/129.7215/-30/62` (the site's own start is zoom 18.5, close on a wooded slope).

## Eight sheets, 6 km2 (measured; hosted 2026-11-23)

The six sheets beside the first two (west, with the harbour, and south), all under `storage/20230712/sasebo-si_saza-chou/` on the Open Nagasaki site:

| sheet | zip bytes | SHA-256 of the zip |
| --- | ---: | --- |
| `01JE3424` | 146,696,906 | `6761d3af9f7a1cd8bf7341dbec4d7261087079bdb3e522208ea3c2216642c8d5` |
| `01JE3442` | 119,937,444 | `f40a1784fc09c5fee25c0f4ce16fc0a0ace1b94894e3c75f061c318a6c76309b` |
| `01JE3444` | 67,739,094 | `a65d42f0b60954fb8f2294eab0f4e6fef7d205b68a2d98eeef3d124a71d1f946` |
| `01JE3533` | 69,996,545 | `86e506c084d32311c4850caff916d3a160b44c907a89faaefcf807b6aa04b87e` |
| `01JE4422` | 16,514,268 | `d14ddaa992fe8d88ef1431043cf1879f216780b0e881d27278e1af1b1adb1c64` |
| `01JE4511` | 6,892,309 | `3c14a9097752a90512095649d37fca5ca56a565dae31cca1380734ca4b4fe525` |

`build:tiled` on the eight sheets (37.85 million points; the same recipe as the two-sheet build; 3 workers): **104 s**, 145 tiles (103 at z17), 17.0 million splats
(z15 2.54 M, z16 6.05 M, z17 8.41 M), **204.0 MB** (PMTiles 203,951,931 B; 34 B/m2 of the 6 km2 including the sea), shards 606 MB, a tile job
at most 1.05 GB, the whole process 1.1 GB. Written with the streaming writer.

What the larger area showed:

- **The demo refused it**: the TileJSON lists every tile of the bounds at every zoom (164 here) and the demo's guard was 64. The guard is now 4,096 and counts before it lists
  (a country-sized bound used to overflow the stack in `tiles.push(...)` before the guard looked).
- **The nine-tile limit** (the streamer holds the nine tiles nearest to the map centre): at zoom 17.2 and pitch 65 the view is 1.1 x 1.6 km and nine z17 tiles
  (0.77 km across, 0.95 million splats, about 11 MB) cover part of it; at 16.6 the nine z16 tiles hold 2.5 million splats, at 15.6 the nine z15 tiles 2.5 million
  (30 MB) for a view of 2.5 x 3.6 km that the data area (11 z15 tiles) exceeds by two. `?mixed=1` (up to 24 tiles of two zooms by distance) at the first view
  loaded 20 tiles (13 z17, 7 z16): 4.3 million splats, 52 MB, delivered in 1.3 s locally, and fills the view. (Decided 2026-11-23: `?mixed=1` is the default for `sasebo`; a first version drew the far tiles empty, fixed, see NOTES.md.) A count of tiles is a poor budget: a z17 tile
  holds 0.1 million splats and a z16 tile 0.3 million; a budget in bytes (or splats) would follow cost. Not decided.
- At zoom 16.2, pitch 60 the harbour, a park, a river and the town read well in the demo (nine z16 tiles, 3.0 million splats, 36 MB).

Hosted: `dorayaki-sasebo.pmtiles` on stars was replaced by this archive (203,951,931 B, SHA-256 `ed7f8d01a03243c62dc9135ddd6e54795d81b751e3f4c2d3c993c6c9220e0375`; the two-sheet one, `f49dc400...`, is kept locally as
`demo/tiles/dorayaki-sasebo-2sheets.pmtiles`). The site's TileJSON pin is `?v=20261123b`. Procedure: scp to `.dorayaki-sasebo.pmtiles.new.<rand>`, sha256 on the host, `rm` of the old file, 8 s, `mv -n`
(the `rm` of a served file was refused by the session's permission classifier until the user allowed it). Checked afterwards: the TileJSON (bounds 129.7018 to 129.7266, 33.1536 to 33.1835) and 10 sampled tiles of z15 to z17, from all three zooms, are identical to the local files.

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
