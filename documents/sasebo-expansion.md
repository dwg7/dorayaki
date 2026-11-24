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

## Merge recipe at about 10 points/m2 (E023, measured on the sheet `01JE3513`, 2026-11-24)

Question: the recipe of the hosted archive (adaptive levels 3, thickness 0.2 m, color 0.2, sparse 0) was tuned on Kawazu (121 to 440 points/m2). Does a
stricter merge pay at 10 points/m2? One sheet (5.4 million points) built with `build:tiled` (24 to 30 s each, 3 workers, block version 6, z15 to z17, same
sheet and same tile grid), compared with the unmerged `sasebo-3513` build (one splat per voxel, 4,878,174 z17 splats, 90,994,864 B).

| recipe (levels, thickness, color) | z17 splats | PMTiles | against unmerged |
| --- | ---: | ---: | ---: |
| unmerged (reference) | 4,878,174 | 90,994,864 B | 100 % |
| 3, 0.2, 0.2 (**hosted**) | 1,754,924 | 43,052,617 B | 47 % |
| 2, 0.2, 0.2 | 1,815,276 | 43,845,694 B | 48 % |
| 1, 0.2, 0.2 | 2,421,279 | 52,079,420 B | 57 % |
| 3, 0.1, 0.1 | 2,533,135 | 56,866,683 B | 62 % |
| 3, 0.05, 0.1 (the script defaults) | 2,882,268 | 62,420,114 B | 69 % |

What the software renderer says (`measure:quality`, z17 against the unmerged build, three cameras): **it does not separate the recipes**. Mean absolute difference at 1-pixel blocks
is 8.0 to 9.4 (view 1), 13.9 to 14.7 (view 2) and 21.1 to 22.6 (view 3) for all five; the order between recipes is inconsistent between views (the strictest has the most holes, the hosted
one the most extra pixels). The reference is a different build with its own noise, and the renderer draws flat discs without the demo's soft look or `extent`, so the measure sees the lattice of
merged discs on bare ground (white gaps between large discs) but not what the demo hides. Do not choose a recipe by these numbers.

What the demo shows (soft look, `extent` 1.3, default jitter; local entries `sr-cur`, `sr-t1c1`, `sr-l2`, `sr-t05c1`, `sr-l1`, `sasebo-3513`; Apple M1, the Browser pane):

- Unmerged is speckled: with 1.5 points per voxel at z17 many splats are poorly fitted and the roofs and walls look grainy.
- The hosted recipe is smooth but flat: roof structure, bare ground and cars melt into large patches of one color ("painted"). At zoom 17, pitch 55 the bare ground at the right
  of the view is washed out.
- Thickness 0.05 / color 0.1 keeps roof edges, texture on bare ground and single cars, at 1.64 times the splats (+45 % bytes: the hosted 204 MB would become about 295 MB). The
  difference is visible at zoom 17 to 18 and small in an overview at zoom 16.

Not done: the recipes on the eight-sheet area, z16 and z15 looked at separately (merging acts on all three zooms), a per-zoom recipe, the sparse rule (`DORAYAKI_ADAPTIVE_SPARSE`) at this density, other sheets (the city sheets have more buildings than this one), a judgment by viewers other than the author.
Not a finding: that the stricter recipe is "right"; it is a larger file with more detail.

### Smaller tiles at z15 and z16 (E023, same sheet, 2026-11-24)

Direction (hfu): a z15 or z16 tile should be about a quarter of today's size (hosted archive: z15 mean 2.77 MB, max 9.27 MB; z16 mean 2.34 MB, max 7.79 MB; z17 mean 0.98 MB),
because a lower zoom covers four times the area with the same 512 x 512 cells. New settings of `build:tiled` (default 1 = as before; `src/pointcloud/tile-build.ts`, 2 tests):
`DORAYAKI_ZOOM_CELL_SCALE` (voxel edge of every zoom below z17: 2 gives 2 m at z16 and 4 m at z15), `DORAYAKI_ZOOM_THICKNESS_SCALE` and `DORAYAKI_ZOOM_COLOR_SCALE` (merge thickness and color
tolerance multiplied per zoom below z17), and the existing `DORAYAKI_ADAPTIVE_SPARSE` with `_SPARSE_SCALE`. Built on `01JE3513` from the hosted recipe (3, 0.2, 0.2); z17 is identical in all (20 tiles, 21.1 MB).

| variant | z15 mean / max | z16 mean / max | PMTiles | z15, z16 against the hosted recipe |
| --- | ---: | ---: | ---: | ---: |
| hosted recipe (`sr-cur`) | 3.22 / 5.94 MB | 2.59 / 4.01 MB | 43.1 MB | 100 %, 100 % |
| cell scale 2 (`lz-cell2`) | 0.84 / 1.52 MB | 1.07 / 1.72 MB | 29.2 MB | 26 %, 41 % |
| thickness x2, color x1.5 per zoom (`lz-thick`) | 1.82 / 3.39 MB | 1.79 / 2.78 MB | 35.4 MB | 57 %, 69 % |
| sparse 1, scale 4 (`lz-sparse`) | 2.36 / 4.35 MB | 2.21 / 3.40 MB | 39.1 MB | 73 %, 85 % |
| all three (`lz-all`) | 0.64 / 1.17 MB | 0.90 / 1.44 MB | 27.7 MB | 20 %, 35 % |

(The sheet holds 2 z15 and 6 z16 tiles, partly at its edge, so the means are of few tiles; compare the rows with each other.) Merging and sparse rules alone do not reach a quarter;
the coarser cell does at z15 and nearly at z16 (41 %), because it removes cells, which the others only join. Looked at in the demo at zoom 16.2, pitch 55 (z16 tiles; the local entries `lz-cell2`
and `lz-all`): the town, the wooded hill and the roads read the same at this scale; `lz-cell2` is only slightly rougher than the hosted recipe on roofs, and `lz-all` blotchier in the dense houses on the left.
Not looked at: z15 itself (zoom 15), the near view (the z17 tiles are unchanged), several sheets, the tile edges between sheets (a coarser cell does not change the guarantee that a merge group stays in its tile).
Not decided: which variant to use; the next step is to build the wider area with the hosted recipe first (hfu), then change the low zooms.

## 23 sheets, about 17 km2, the hosted recipe (measured, 2026-11-25; not hosted yet)

hfu's order: build a wider area with the hosted recipe first and see that nothing breaks, then change the low zooms. Fifteen sheets were added: the whole `01JE45` block
(4 x 4 sheets of 1,000 x 750 m south and east of the harbor; `01JE4511` was already held), 69.9 million points, 1.16 GB of zips
(`data/nagasaki/zips45/SHA256SUMS.txt`, kept locally; all 15 pass `unzip -tq`). All LAS 1.2, point format 2, like the first eight. The site's browser queue stopped at the first error
(`01JE4533`, cause unknown), so the sheets were fetched with `curl` from `https://opennagasaki.nerc.or.jp/storage/20230712/sasebo-si_saza-chou/<code>.las.zip` (the same files the page offers;
checked first against the size of a sheet already saved from the page).

`build:tiled`, 23 sheets (107.8 million points), 3 workers, recipe 3 / 0.2 / 0.2 / sparse 0, block version 6, z15 to z17: **340 s wall**, process 1.18 GB, a tile job at most 1.13 GB,
273 z17 tiles, 81 z16, 26 z15; **PMTiles 619,693,411 B** (SHA-256 `d49a28b59fe062df924565e9c7bffb4ce324d18d51419f4dae13e43e5df38f70`; about 51.6 million splats by the tile bytes).
Tile sizes: z15 mean 3.59 MB (max 9.30), z16 mean 2.75 MB (max 8.49), z17 mean 1.11 MB (max 3.73).
**Disk** (the machine was at 99 %, 7 GB free during the build): the work directory reached **6.4 GB** (shards 1.7 GB, z16 and z15 pieces as JSON **4.7 GB**), so the intermediate pieces,
not the shards, are the cost of a wide build; it is removable after the archive is written.

Looked at in the local demo (`?fixture=sasebo-23`, mixed on): at zoom 16, pitch 55, 18 tiles, 2.8 million splats, 33.7 MB; at zoom 14.7 (z15) the town, hills and the harbor read well and I saw no seam between the
old and the new sheets. The TileJSON lists tiles over the whole bounding box, so the demo asks for tiles that do not exist (a few 404 per view; they come back as empty, as designed).
**Gaps**: the 23 sheets do not form a block. Nine sheets are missing between the two groups, east of the first eight and north of the `01JE45` block (by the sheet grid: `01JE3514`, `3532`, `3534`, `3523`,
`3524`, `3541`, `3542`, `3543`, `3544`, if the code scheme holds there; not confirmed on the site), and one column (E 19000, N 15000 to 17250) west of the new block. In the demo they show as dark holes.
Not done: other browsers, drag behavior, memory in the browser at the widest views, hosting this archive.

### 32 sheets: the nine gap sheets added (measured, 2026-11-25; not hosted yet)

Nine sheets filled the hole between the two groups (`01JE3514`, `3523`, `3524`, `3532`, `3534`, `3541`, `3542`, `3543`, `3544`; 1.68 GB of zips, 93.3 million points; fetched by `curl` from the same folder
after a HEAD request of each; `data/nagasaki/SHA256SUMS-01JE35.txt`). With the 23 before: **32 sheets, 201.1 million points**.

The first 32-sheet build **ran out of disk** (the work directory passed the 14 GB that were free; the machine has no external disk): the z16 and z15 pieces were JSON text, 4.7 GB at 23 sheets and about 9 GB at 32.
`build:tiled` now writes them as gzipped float64 (the same numbers; **the 51 tiles of a two-sheet build are byte-identical** to the JSON version, only the manifest's name differs), about a third of the size:
the work directory of the 32-sheet build peaked at about 6.4 GB. Result, recipe 3 / 0.2 / 0.2 / sparse 0, block version 6, 3 workers: **518 tiles (z15 32, z16 105, z17 381)**, **PMTiles 1,234,118,714 B**
(SHA-256 `961254299d13f9e0872eeb063ec497f0183b5fc4ae10ed9cc576460bf0a43577`). Tile sizes: z15 mean 5.48 MB (max 15.92), z16 mean 4.25 MB (max 15.88), z17 mean 1.61 MB (max 6.68).
In the local demo (`?fixture=sasebo-32`) the area is continuous at zoom 14.6 (no dark hole between the groups); that view loads **12 z15 tiles, 5.45 million splats, 65 MB** (the eight-sheet archive: 30 MB), so the low-zoom
tile size (see above) now matters for a viewer: not changed in this build. Not looked at: the near views of the filled area, other browsers, the hosted archive.

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
