# Datasets: Numazu, Kawazu, Sasebo and Open Nagasaki, with size and scale

The tilesets built from real data, where they are hosted, and what they cost. Hosted on stars (Martin): `dorayaki-numazu` (version 6, `?v=20261127a`), `dorayaki-kawazu` (`?v=20261122a`), `dorayaki-sasebo` (32 sheets, `?v=20261125b`). The sections below were separate documents until 2026-11-27 and keep their dates.

Commands named in the older sections below that are no longer in package.json (`build:tileset`, `merge:tilesets`, `demo:numazu`, `measure:*` other than `measure:codec` and `measure:quality`, `prototype:tile-scatter`, `compare:tile-build`) and `DORAYAKI_BLOCK_VERSION` were removed on 2026-11-27 (compaction, [decisions.md](decisions.md)); they are in Git at the tag `pre-compaction-2026-11-27`. Their results are in EXPERIMENTS.md.

Contents: numazu demo, kawazu demo, sasebo expansion, size and scale, size vs 3d tiles.

## Numazu point cloud demo

Status: implemented and demonstrated. This page holds what the README
leaves out about the real-data tileset.

A real-data tileset built from Shizuoka Prefecture's VIRTUAL SHIZUOKA MMS
point cloud (2019, mesh `08NE2701`, CC BY; 976,195 points). The data is not
in this repository.

### Rebuild

```sh
mkdir -p data/virtual-shizuoka/2019-mms-08NE2701
curl -o data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.zip https://virtual-shizuoka.s3.ap-northeast-1.amazonaws.com/2019/MMS/Ground/08/NE/27/08NE2701.zip
unzip data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.zip -d data/virtual-shizuoka/2019-mms-08NE2701
npm run demo:numazu
```

The zip is 14,113,240 bytes (SHA-256 `0af0a8ac…e1ca126d`). `npm run
demo:numazu` writes a tile pyramid with a `tilejson.json` to
`demo/tiles/numazu/`, the finest Gaussians as a reference-3DGS PLY next to
the LAS, and the same tiles as one PMTiles archive,
`demo/tiles/dorayaki-numazu.pmtiles` (tile type MLT, gzip directories).

### Hosting

The published archive is served by stars as
`https://stars.optgeo.org/dorayaki-numazu/{z}/{x}/{y}` (TileJSON at
`https://stars.optgeo.org/dorayaki-numazu`). It is not committed here.
Placing a new archive on stars follows the stars project's procedure and
needs the repository owner's instruction to the stars session.

### Profiles

| profile | tiles | PMTiles size | × COPC |
| --- | --- | --- | --- |
| `coarse` (default, hosted) | aggregated z18; z19 maxzoom, one 12 cm level | 603,132 B | 0.12 |
| `medium` (`DORAYAKI_NUMAZU_PROFILE=medium`) | z18, z19; z20 one 6 cm level | 2,204,268 B | 0.43 |
| `fine` (`DORAYAKI_NUMAZU_PROFILE=fine`) | z20, three nested thinned levels | 2,571,701 B | 0.50 |

The COPC reference is 5,183,226 B (xyz + rgb of the same points, PDAL
`writers.copc`). The comparison is size at a given level of detail, not
fidelity: `coarse` keeps one Gaussian per 12 cm cell and discards finer
structure. `EXPERIMENTS.md` (E002–E004) has the measurements and the
reasoning for making `coarse` the standard.

To view a locally built tileset, run `npm run demo` and open
`http://127.0.0.1:8000/demo/?fixture=numazu` (`numazu-medium`,
`numazu-fine` if built). `&lod=22` chooses tiles and levels as if the map
were at that zoom. Heights are the source's elevations (標高), so on the
flat basemap the data floats at its real elevation, about 7.5 m above the
map plane.

## Kawazu tileset: recipe, size, hosting

Status: built, verified and hosted on stars as one archive, `dorayaki-kawazu`
(raw-tile PMTiles, the factor-10 build of 2026-11-16). The Pages site lists it as
`?fixture=kawazu`.
Facts about the data are in [build.md](build.md); the
experiments behind the choices are E005 to E011 in
[EXPERIMENTS.md](../EXPERIMENTS.md).

### What it is

The Kawazu loop bridge and the valley below it: nine meshes of 300 m x 400 m
(`08OF4050` to `08OF4072`, rows 5 to 7, columns 0 to 2 of the 5000-scale cell
`08OF40`; 900 m x 1,200 m = 1.08 km2; JGD2011 zone VIII). Airborne laser (LP, all
returns) for all nine meshes and mobile mapping (MMS) for four of them, merged.
Elevations are orthometric (130 to 360 m), so the demo turns MapLibre terrain on,
lowered by 2 m ([build.md](build.md), E010).

| | |
| --- | --- |
| input | 476,004,940 points: LP 148.2 million in 9 files, MMS 327.8 million in 4 files (LAS 1.2 format 3) |
| zooms | z15 (4 tiles), z16 (12), z17 (30): 46 tiles |
| splats | z15 84,477; z16 678,826; z17 6,172,195; total 6,935,498 |
| archive | **84,036,082 bytes** (Surfel Block version 6 with class planes), raw tiles, gzip directories; SHA-256 `bc5193b0d34c11b43c02e46b479dd4904e57b88e1ed0597a8d359b796b4376c1` |
| per area | 78 B/m2 with the class planes (77 without; z17 alone 69) |
| tiles | z15 1,014,034 B, z16 8,146,845, z17 74,068,696; largest tile 5.4 MB (z17) |
| bounds | 138.93585, 34.78674, 138.95233, 34.79802 (west, south, east, north); centre 138.93930, 34.79176 |
| served | `https://stars.optgeo.org/dorayaki-kawazu` (TileJSON, zoom 15 to 17), `.../{z}/{x}/{y}` |

The archive's own metadata still names it `kawazu-v2: merged kawazu-m08OF4060, ...`
(the name it was built under); the name stars serves is the file name.

### Per-zoom threshold factor 10 (hosted 2026-11-16)

E011 raised the per-zoom threshold factor from 4 to 10
(`DORAYAKI_ADAPTIVE_SPARSE_SCALE=10`): nine meshes give 111.0 MB (z15 1.4, z16 10.9,
z17 98.8 MB) instead of 132.0 MB (the earlier factor-4 archive, SHA-256 `5ff8eafc...`),
and the showcase view fetches 10.8 MB instead of 26.9 MB. It replaced the factor-4
file on stars on 2026-11-16, with the TileJSON URL moved to `?v=20261117`.

### Version 6 (hosted 2026-11-17)

The hosted archive is the same content as the factor-10 build written as Surfel Block version 6 (12-byte records,
[format.md](format.md), E016): 83,230,962 bytes against 110,972,600, exactly 0.750 (z15
1,014,034, z16 8,146,845, z17 74,068,696; 46 tiles, 6,935,498 splats). It was built with
`DORAYAKI_BLOCK_VERSION=6` on every `build:tileset` and on `merge:tilesets`, and checked tile by tile against the files
(46 of 46 byte-identical, read with the reference `pmtiles` reader) before and after the upload. The TileJSON URL is now
`?v=20261117c`. Version 5 data (the earlier archive, SHA-256 `90afb84f...`, 110,972,600 bytes) is kept only locally
as `demo/tiles/dorayaki-kawazu-v2.pmtiles`; the live site reads both versions. A browser that still has the older page
bundle cached cannot read version 6 tiles (it reports an unsupported version) until it reloads.

The archive's centre (the demo's default view) comes from the first tileset given to `merge:tilesets`: put
`kawazu-m08OF4060` (the loop bridge) first, or the view opens about 300 m north. The first upload of this archive had the
mesh `08OF4050` first and was replaced the same day by a rewrite with the centre set back (the tile files are unchanged).

### Version 6 with class planes (hosted 2026-11-17)

The same content with a class plane in every tile ([format.md](format.md), E021): `demo/tiles/dorayaki-kawazu-cls6.pmtiles`,
84,036,082 bytes (SHA-256 `bc5193b0...`), 0.97 % more than the hosted 83,230,961 bytes. 46 of 46 tiles carry a plane whose count equals the block's
(6,935,498 splats; the planes are 804,972 bytes, 0.93 bits per splat: z15 12,507, z16 79,520, z17 712,945), and the archive's 46 tiles are
byte-identical to the files (reference `pmtiles` reader). The centre is the loop bridge (08OF4060 listed first in the merge). Classes of the splats of the
area: canopy rule (code 64) 78.6 %, ground 8.4 %, unclassified 6.0 %, high vegetation 3.7 %, medium 2.9 %, low 0.5 %. Built with
`DORAYAKI_CLASS_PLANE=1 DORAYAKI_BLOCK_VERSION=6` and the recipe below (nine builds 6 min 40 s, merge a few seconds). It is the hosted archive since the evening of 2026-11-17 (SHA-256 equal on the host, served tiles byte-identical to the local files, TileJSON `?v=20261117c`); the
version 6 archive without planes (83,230,962 bytes, SHA-256 `9f416dcb...`) is kept only locally as `demo/tiles/dorayaki-kawazu-v6b.pmtiles`.

### Recipe

Each mesh is built alone, because the voxel accumulators need about 100 bytes per
voxel and this machine has 8 GB of RAM; the tilesets are then merged
(`npm run merge:tilesets`, [build.md](build.md)).
Cells are tile width / 512 at each zoom (z17: 49 cm). Merging
([build.md](build.md)) at every zoom: thickness 20 cm, color
tolerance 0.2, three merge levels, the sparse rule at 24 points at z17 multiplied
by 10 for each zoom below (z16: 240, z15: 2,400).

```sh
export DORAYAKI_ADAPTIVE_REFINE=0 DORAYAKI_ADAPTIVE_LEVELS=3 \
  DORAYAKI_ADAPTIVE_THICKNESS=0.2 DORAYAKI_ADAPTIVE_COLOR=0.2 \
  DORAYAKI_ADAPTIVE_SPARSE=24 DORAYAKI_ADAPTIVE_SPARSE_SCALE=10 \
  DORAYAKI_BLOCK_VERSION=6   # the hosted archive; leave it out for version 5
R=data/virtual-shizuoka
for m in 08OF4050 08OF4051 08OF4052 08OF4060 08OF4061 08OF4062 08OF4070 08OF4071 08OF4072; do
  files=$R/2019-lp-ground-$m/$m.las
  [ -f $R/2019-mms-$m/$m.las ] && files=$R/2019-mms-$m/$m.las,$files   # MMS exists for 4050, 4060, 4070, 4071
  npm run build:tileset -- $files 8 kawazu-m$m 17 16 15
done
# 08OF4060 first: the first tileset sets the archive's centre (the demo's default view)
npm run merge:tilesets -- kawazu kawazu-m08OF4060 kawazu-m08OF4050 kawazu-m08OF4051 kawazu-m08OF4052 \
  kawazu-m08OF4061 kawazu-m08OF4062 kawazu-m08OF4070 kawazu-m08OF4071 kawazu-m08OF4072
```

This writes `demo/tiles/kawazu/` (raw tiles and TileJSON, for the local demo) and
`demo/tiles/dorayaki-kawazu.pmtiles`. The nine builds took 20 to 50 s each (peak
1.23 GB) and 269 s in all. Tiles in the archive are raw because stars' Martin 1.14
cannot read gzip MLT tiles; `DORAYAKI_TILE_COMPRESSION=gzip` would make them about
30 % smaller (see below). Mesh seams are not reconciled (a voxel cut by the edge
between two meshes is fitted in each), and neighbouring meshes place the same ground point up to 1.8 m apart (the local frame ignores grid
convergence; E022, [build.md](build.md)).

Verified: the archive's 46 directory entries each equal the file on disk and decode
to 6,935,498 splats.

### Hosting on stars

Procedure as for Numazu ([datasets.md](datasets.md); NOTES.md): the owner
authenticates (Cloudflare Access opens a browser window; use a long
`ConnectTimeout`, the first attempt on 2026-11-16 timed out at 180 s), read-only
check, `scp` to a hidden name in `/home/stars/data/`, size and SHA-256 compared on
the host, `mv -n` into place; Martin registers a new file within seconds.

History (stars holds only one Kawazu archive):

- 2026-11-15: the single mesh `08OF4060` (1,459,754 splats, 23,357,992 B) was
  uploaded as `dorayaki-kawazu`. A first, gzip-tile build (15,952,873 B) failed:
  Martin 1.14.0 logged `Format Mlt and compression Gzip are not yet supported` and
  kept the source out of its catalog, so the raw-tile build replaced it.
- 2026-11-16: the nine-mesh archive was uploaded as `dorayaki-kawazu-area`, checked
  (five tiles byte-identical, content type `application/vnd.maplibre-tile`, no
  `Content-Encoding`), then, at the owner's request, the single-mesh file was
  removed and the area file renamed over it (`rm`, a pause so that Martin dropped
  the source, then `mv -n`; replacing a served file in place was not tried).
  `dorayaki-kawazu-area` is gone (404), and the catalog lists `dorayaki-numazu` and
  `dorayaki-kawazu`. The five tiles served under the new name are byte-identical to
  the local files. The single-mesh archive survives locally as
  `demo/tiles/dorayaki-kawazu-single.pmtiles` (SHA-256 `042e4dce409b5d03...`) and as the
  dev tileset `kawazu-single`.
- 2026-11-17: the version 6 archive (83,230,961 B, SHA-256 `3395c2c3...`) replaced the factor-10 version 5 archive
  (`rm`, 8 s pause, `mv -n`); its centre was wrong (see above), so a rewrite with the right centre (83,230,962 B,
  `9f416dcb...`) replaced it minutes later, and the TileJSON URL moved to `?v=20261117c`. Both uploads: SHA-256 equal on
  the host, tiles served with the Pages origin byte-identical to the local files.
- 2026-11-16 (later): the factor-10 area archive (110,972,600 B, SHA-256 matched on
  the host) replaced the factor-4 file the same way (`rm`, 8 s pause, `mv -n`); the
  TileJSON URL became `?v=20261117` because of the stale edge cache below.

**Not compressed in transit.** With `Accept-Encoding: gzip, br`, the 6.33 MB tile
of the single mesh still crossed the wire as 6,333,031 bytes (Cloudflare does not
compress this content type), so the saving of gzip tiles is not realised until
Martin supports gzip MLT tiles or the type is added to the CDN's compression
list: a question for the stars project.

The page loads only the tiles in view ([demo.md](demo.md)): at
`?fixture=kawazu#map=16.63/34.790766/138.939214/128.7/67` it fetched 8 tiles,
10.8 MB and drew 676,201 splats (E011; the factor-4 archive gave 26.9 MB and
1,680,486 splats, with the slowest tile 3.1 s and decoding 2.1 s in all on an Apple M1;
the timings were not repeated).

**The edge caches stale tiles: version the TileJSON URL.** stars answers with
`cache-control: max-age=14400` and `vary: Origin`, and Cloudflare keeps the
answers per origin, including 404s. After the single-mesh archive was replaced under
the same name, the live site (origin `dwg7.unopengis.org`) was still served old tiles
for up to four hours: 20 of the 46 tiles had the old single-mesh content or a
cached 404 (checked with `curl -sI -H 'Origin: ...'`; a different origin or a
`?cb=` query saw the new files). Martin copies a query of the TileJSON request into
its tile template, so requesting `https://stars.optgeo.org/dorayaki-kawazu?v=20261117c`
gives tile URLs ending in `?v=20261117c`, which miss the stale entries (the four tiles
and the formerly cached 404 tested were served with the new sizes). The site is built
with a versioned URL; bump `v` whenever the archive behind a name is replaced.

### Tile-aligned build hosted (2026-11-22)

The hosted archive is now the tile-aligned build of E022 step 3 (`npm run build:tiled`, same recipe and nine meshes):
83,887,706 bytes (0.18 % smaller than the previous 84,036,082), SHA-256 `6da2b76e...`, equal on the host; a served z17
tile was byte-identical to the local file. The mesh seam's density dip (about 12 %) measured in the previous archive
is gone (`measure:seam`). The TileJSON URL is now `?v=20261122a`. The previous archive is kept only locally as
`demo/tiles/dorayaki-kawazu-cls6.pmtiles`.

The site is rebuilt with:

```sh
DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu \
DORAYAKI_KAWAZU_TILEJSON='https://stars.optgeo.org/dorayaki-kawazu?v=20261122a' npm run site
```

The demo opens Kawazu with terrain on (lowered by 2 m) and splat scale 1.3 by
default (`?terrain=0`, `?extent=1` switch them off).

### Data licence

The source point clouds are Shizuoka Prefecture's VIRTUAL SHIZUOKA (CC BY); the
archive's attribution says so.

## Sasebo Bay: areal expansion with the Open Nagasaki point cloud

Status (2026-11-27): **built and hosted.** stars serves `dorayaki-sasebo.pmtiles`, 32 sheets (about 17 km2, 201 million points), zooms 13 to 17, 713,970,031 B
(SHA-256 `472c72129209...`), with the size-capped lower zooms of E024; the site pins `?v=20261125b`, and `?mixed=1` (a view budget that covers the screen) is Sasebo's default.
The download of the whole of Open Nagasaki has started (see the last section). The page is a chronological record: the sections below were written as each step was done, and
"not hosted yet" in a heading means not at the time of that step.

### Goal

Show the area around Sasebo Bay (about 15 km on a side, roughly half sea) as one seamless Dorayaki tileset. "Rough scale" is the bar: the numbers below are
estimates from one file, said so where they are.

### The data

Open Nagasaki (Nagasaki Prefecture), <https://opennagasaki.nerc.or.jp/terms.html>: airborne laser (LP) points merged into one cloud for the
whole prefecture, **CC BY 4.0**, no registration. One file per 1,000 m (east-west) x 750 m (north-south) sheet, LAS 1.2, uncompressed, JGD2011 plane
rectangular zone I. Mean file about 400 MB, largest 685 MB. The sheet code is the 1:2500 code plus a quarter digit (`01JE3513`); the file is
`https://opennagasaki.nerc.or.jp/storage/<date>/<municipality>/<code>.las.zip` (for this one,
`storage/20230712/sasebo-si_saza-chou/01JE3513.las.zip`; the path differs by area and is not listed anywhere we could read: the site's download button
fetches it, so the pane's own page has to be used to learn it).

#### The one file read: `01JE3513` (central Sasebo, around the station)

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

### First build of the one sheet (measured)

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

### Two sheets: one process fails, the tile-aligned build works (measured)

Sheets `01JE3513` and the southern neighbour `01JE3531` (115,026,453 B zip, SHA-256 `5b0898458d2f40a9b5d9bb157ce4d01fd72ec14993e419c6035b3fc52bed30ac`;
6,473,740 points, 8.6 points/m2, all class 1, RGB present; 1.6 million voxels at 1 m and 4.1 million at 0.5 m), together 13.8 million points on 1.5 km2.

- `build:tileset` with both files in one process (plain recipe) **ran out of memory** after 13 minutes (the 8 GB heap; the voxel Gaussians are ordinary JS
  objects, `documents/build.md`). One sheet alone takes 210 s and 0.7 GB, so the cost is not linear: a second sheet is the difference.
- `build:tiled` (E022 step 3) on the same two files with 3 workers, the recipe merging at 3 levels (thickness 0.2, color tolerance 0.2, no sparse rule):
  **47 s wall** (scatter 2 s, tile jobs 32 s, gather 12 s; the tile jobs add up to 92 s, largest 0.84 GB), shards 221 MB (16 bytes per point as
  estimated), 51 tiles, 6.14 million splats (z15 0.93 M, z16 2.18 M, z17 3.03 M), **73.7 MB** (PMTiles 73,667,270 B, 49 B/m2). The z17 count is
  3.0 million against 9 million for the plain recipe of the two sheets. For this extrapolation, about 110 km2 would take about an hour with 3 workers and produce
  about 5 GB.
- Seen in the demo (`?fixture=sasebo-tiled`, a development entry; default look): it renders; I did not see a seam at the sheet edge at zoom 18.2, pitch 50.
  The merging makes large flat discs on parking lots and roofs and visibly coarser areas than the plain z17; whether the recipe (taken from Kawazu) is right
  for this density was not tuned.
- The archive is built in memory (E022 step 4 is not done): at 5 GB it would not fit in 8 GB of RAM.

### Hosted on stars (2026-11-23)

The two-sheet tile-aligned build is on stars as `dorayaki-sasebo.pmtiles` (73,667,266 B, SHA-256 `f49dc400e8f8790c50c526e04c374b19bc2537e0dd93fbda09b3775246047cc7`, raw
tiles because Martin 1.14 cannot read gzip MLT; 51 tiles, 6.14 million splats, z15 to z17, attribution 「点群: 長崎県 オープンナガサキ (CC BY 4.0) を加工して作成」):

- Naming: `dorayaki-<place>` as for Kawazu and Numazu; no mesh codes, dates or `-area` in the name; the version is the `?v=` of the TileJSON URL,
  `https://stars.optgeo.org/dorayaki-sasebo?v=20261123a`. When the area grows the same name is replaced.
- Verified: TileJSON served with the Pages origin; one z17 tile byte-identical to the local file; the site build (`DORAYAKI_SASEBO_TILEJSON`) loads it from stars
  (6 tiles at zoom 18.5, 9 at zoom 16.4) and lists `sasebo` among the fixtures.
- Recipe: `DORAYAKI_ADAPTIVE_LEVELS=3 _THICKNESS=0.2 _COLOR=0.2 _SPARSE=0 DORAYAKI_BLOCK_VERSION=6 DORAYAKI_ATTRIBUTION=... npm run build:tiled -- sasebo 1 "<01JE3513.las>,<01JE3531.las>" --workers 3 --centre 129.7198,33.1790`.
- Demo defaults for `sasebo`: terrain on and splat size 1.3 as for Kawazu; the dark basemap (bvmap-nightsky) like every point-cloud tileset.
- A showing view: `#map=16.4/33.1768/129.7215/-30/62` (the site's own start is zoom 18.5, close on a wooded slope).

### Eight sheets, 6 km2 (measured; hosted 2026-11-23)

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

### Merge recipe at about 10 points/m2 (E023, measured on the sheet `01JE3513`, 2026-11-24)

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

#### Smaller tiles at z15 and z16 (E023, same sheet, 2026-11-24)

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

### 23 sheets, about 17 km2, the hosted recipe (measured, 2026-11-25; not hosted yet)

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

#### 32 sheets: the nine gap sheets added (measured, 2026-11-25; not hosted yet)

Nine sheets filled the hole between the two groups (`01JE3514`, `3523`, `3524`, `3532`, `3534`, `3541`, `3542`, `3543`, `3544`; 1.68 GB of zips, 93.3 million points; fetched by `curl` from the same folder
after a HEAD request of each; `data/nagasaki/SHA256SUMS-01JE35.txt`). With the 23 before: **32 sheets, 201.1 million points**.

The first 32-sheet build **ran out of disk** (the work directory passed the 14 GB that were free; the machine has no external disk): the z16 and z15 pieces were JSON text, 4.7 GB at 23 sheets and about 9 GB at 32.
`build:tiled` now writes them as gzipped float64 (the same numbers; **the 51 tiles of a two-sheet build are byte-identical** to the JSON version, only the manifest's name differs), about a third of the size:
the work directory of the 32-sheet build peaked at about 6.4 GB. Result, recipe 3 / 0.2 / 0.2 / sparse 0, block version 6, 3 workers: **518 tiles (z15 32, z16 105, z17 381)**, **PMTiles 1,234,118,714 B**
(SHA-256 `961254299d13f9e0872eeb063ec497f0183b5fc4ae10ed9cc576460bf0a43577`). Tile sizes: z15 mean 5.48 MB (max 15.92), z16 mean 4.25 MB (max 15.88), z17 mean 1.61 MB (max 6.68).
In the local demo (`?fixture=sasebo-32`) the area is continuous at zoom 14.6 (no dark hole between the groups); that view loads **12 z15 tiles, 5.45 million splats, 65 MB** (the eight-sheet archive: 30 MB), so the low-zoom
tile size (see above) now matters for a viewer: not changed in this build. Not looked at: the near views of the filled area, other browsers, the hosted archive.

**Hosted 2026-11-25**: `dorayaki-sasebo.pmtiles` on stars was replaced by the 32-sheet archive (1,234,118,714 B, SHA-256 `961254299d13f9e0872eeb063ec497f0183b5fc4ae10ed9cc576460bf0a43577`; the eight-sheet one,
`ed7f8d01...`, is kept locally as `demo/tiles/dorayaki-sasebo.pmtiles`). Procedure as before: state of the target and of the temporary name checked first, scp to `.dorayaki-sasebo.pmtiles.new.1034` (5 min 53 s), size and SHA-256 on the host,
`rm`, 8 s, `mv -n` (the user said in chat to replace it). Checked afterwards: the TileJSON (bounds 129.7018 to 129.7595, 33.1330 to 33.1835, zoom 15 to 17, with `?v=20261125a`) and four tiles of z15 to z17, all identical to the local
files. The site's pin is now `?v=20261125a`. The stars host: 1.3 TB free, 7.6 GB of RAM; no memory or time-to-first-picture measurement of Martin with a 1.2 GB archive was made.

### Smaller low zooms, z14 and z13, and a view budget (E024, measured 2026-11-25; not hosted yet)

hfu's direction: a z15 or z16 tile about a quarter of its size; add z14 and z13 (the area will grow); a view budget of 40 MB and 4 million splats; loss of detail at the low zooms is accepted;
"size is the criterion, not the look", and the merge may adapt by zoom (the fractal dimension of the cloud changes with scale).

What changed:

- `build:tiled` builds any lower zooms (`DORAYAKI_LOWER_ZOOMS=16,15,14,13`; default 16,15).
- **Size target** (`DORAYAKI_ZOOM_TARGET_SPLATS=16:100000,15:160000,14:160000,13:160000`, `src/pointcloud/tile-build.ts`): each z17 tile job may give a lower-zoom tile its area's share of the target;
  a piece over its share is merged harder in steps (thickness x s, color tolerance x sqrt(s), s = 1, 2, 4, ... 64; the first that fits). Dense places are merged more than sparse ones, and a tile never exceeds the target.
  The fixed scales `DORAYAKI_ZOOM_THICKNESS_SCALE` / `_COLOR_SCALE` now act once below z17 instead of compounding per zoom (x4 per zoom had left z15 with 2 % of its bytes).
- **Viewer** (`?mixed=1`, `selectBudgetedTiles` in `demo/src/mixed-selection.ts`, 6 tests): the coarsest tiles that touch the view first (the whole view is covered), then the most deserving tile
  (nearest, by the effective-zoom rule of E015) is replaced by its children while the bytes stay within `?budget=` MB (default 40) and the splats within `?splats=` (default 4,000,000). Sizes of tiles loaded before are used,
  else the mean of the loaded tiles of that zoom, else 1.5 MB at z17 and 0.8 MB below. The older cap of 24 tiles is `?mixed=2`.

Eight sheets (cell scale 2 below z17), against the hosted eight-sheet archive: z16 mean 0.55 MB, max 1.06 MB (24 % and 14 %); z15 mean 0.62, max 1.45 (22 %, 16 %); z14 mean 0.29, z13 0.20.
Other variants on the same eight sheets (fixed scales): cell 2 only z15 28 %, z16 42 %; cell 2 + thickness x4 + color x2 (flat) 21 %, 23 % (`f4`); a target of 50,000 splats per tile held the cap but left the means at 6 % and 11 %.

**32 sheets** (`sasebo-32q`, 452 s, the same recipe as the hosted one at z17): **PMTiles 713,970,031 B** (SHA-256 `472c72129209c3f9ceee960cb008b5fe46ae76148ebfb78794d7305fb90933b8`; the hosted 32-sheet one is 1,234,118,714 B).

| zoom | tiles | mean | max | hosted 32 sheets (mean / max) |
| ---: | ---: | ---: | ---: | ---: |
| 13 | 6 | 0.30 MB | 0.98 MB | - |
| 14 | 14 | 0.54 MB | 1.62 MB | - |
| 15 | 32 | 0.90 MB | 1.73 MB | 5.48 / 15.92 MB |
| 16 | 105 | 0.61 MB | 1.06 MB | 4.25 / 15.88 MB |
| 17 | 381 | 1.61 MB | 6.68 MB | the same |

In the local demo: at zoom 16.3, pitch 62 the screen is filled to the far edge of the data with 30 tiles (z17 14, z16 18, z15 3 loaded), 29 MB, 2.4 million splats; at zoom 13.8, pitch 50 the whole 32-sheet area
is drawn from 10 tiles, 6.0 MB (the hosted archive at zoom 15.2: 12 tiles, 63 MB). The near views (z17) are unchanged. Not done: hosting this archive, a drag over the area, other browsers, the z17 tile size (now the largest part of the archive and of a near view).

**Hosted 2026-11-25 (second replacement of the day)**: `dorayaki-sasebo.pmtiles` on stars is now this E024 archive (713,970,031 B, SHA-256 `472c72129209c3f9ceee960cb008b5fe46ae76148ebfb78794d7305fb90933b8`, zoom 13 to 17;
the previous 32-sheet one, `961254299d13...`, is kept locally as `demo/tiles/dorayaki-sasebo-32.pmtiles`). Same procedure (state checked, scp to `.dorayaki-sasebo.pmtiles.new.15653`, size and SHA-256 on the host, rm, 8 s, `mv -n`; the user said to replace it).
Checked afterwards: the TileJSON with `?v=20261125b` (minzoom 13) and one tile of each zoom 13 to 17, identical to the local files. The site pins `?v=20261125b` and carries the covering budget of `?mixed=1`.

### What the early estimates said, and what was measured

Written on 2026-11-23 from one sheet; kept with what the builds then showed.

- **Resolution**: at 9.8 points/m2 a 0.5 m voxel holds 1.5 points, too few for a well-fitted splat; 1 m voxels hold 3.5. Seen in the builds: z17 is usable with the merge recipe,
  smooth but flat on roofs and bare ground (E023).
- **Size**: estimated about 44 B/m2 for z16 and below and about 78 B/m2 with z17. Measured on 32 sheets (about 17 km2, about half sea): 73 MB/km2 before the size caps, 42 MB/km2 after (E024).
- **Input**: estimated 25 to 60 GB of LAS for about 110 km2 of land. The download page's sheet list (saved 2026-11-27) says: the whole of Open Nagasaki is 7,824 sheets,
  about 1.6 TB of zips (the list's size is the zip's; the LAS is about 1.45 times larger, so about 2.3 TB); the sheet block `01JE` around Sasebo is 994 sheets, about 215 GB of zips.
- **Compute**: estimated about 10 CPU hours for 110 km2. Measured: 32 sheets in about 8 to 10 minutes of wall time with 3 workers on an 8 GB laptop.
- **Disk**: the build's work directory reached 6.4 GB for 32 sheets (after the pieces became gzipped float64; JSON had filled the disk). Large inputs and work now go to an external disk.
- **Hosting**: stars serves the 714 MB archive; the host has 1.3 TB free and 7.6 GB of RAM (checked 2026-11-25). A multi-GB archive has not been tried.

### Not checked

- Vertical datum against the DEM the demo uses (E010 style comparison); sea level reads about 0 m in these files.
- Whether the coast and the water edge need special handling (no returns on water).
- The sparse rule on this data; terrain in the demo (the Kawazu DEM shift of 2 m is not known to apply).
- The point density and classification of sheets outside the 32 (the Nagasaki station sheet has 24 points/m2 by a published article; `01JE3513` has 9.8).
- Seams between sheets were looked at in a few views only (none seen).
- The 339 sheets of Iki (`iki-si`) whose path in the sheet list has no `.las`: their file names on the server are not known.

### Production recipe for z17 (E025, decided 2026-11-28)

`npm run produce:opennagasaki` builds z17 with cells of about 1 m (`DORAYAKI_Z17_CELL_SCALE=2`) and at most 100,000 splats per z17 tile (`17:100000` in
`DORAYAKI_ZOOM_TARGET_SPLATS`), besides the E024 lower zooms. On four sheets: a third of the z17 bytes of the hosted recipe (35.7 MB against 107.0 MB; max tile 1.19 MB
against 6.49 MB), 51 s against 68 s. The hosted 32-sheet archive was built before this and is unchanged. Measurements: E025 in EXPERIMENTS.md.

### The whole of Open Nagasaki: sheet list and download (started 2026-11-27)

- **Sheet list**: the download page's own list (the `data_info.php` response that the page loads), saved by hand from the browser by hfu (an automated way to read it was
  refused by the session's permission classifier, and probing paths had been refused before). Each sheet gives `path` (`data/<date>/<municipality>/<file>.las`) and the LAS size;
  the zip is `https://opennagasaki.nerc.or.jp/storage/<date>/<municipality>/<file>.las.zip`.
- **Download**: a small script outside the repository fetches one zip at a time with 60 s between files, waits 5 to 60 minutes after a failure, resumes partial files, checks every zip
  with `unzip -tq`, and stops below 30 GB free. The `01JE` sheets come first, ordered by distance from central Sasebo (E 21,000 m, N 18,000 m in JGD2011 zone I); the
  position of a sheet from its code (block AB 4,000 x 3,000 m, then quadrants C and D: 1 NW, 2 NE, 3 SW, 4 SE) agreed with the LAS extent of all 32 sheets held.
  The site's terms state no rate limit; the pacing is a courtesy.
- **Disk**: the whole prefecture is about 1.6 TB of zips (about 2.3 TB unzipped); the external disk holds 447 GB. The `01JE` block (215 GB of zips) fits; the rest needs converted
  zips removed as they are built, or more disk (not decided).

## Size and scale: what a tile and a prefecture cost

Status: arithmetic from measurements. The Kawazu and Sasebo figures are measured; the
prefecture figures are extrapolations and say so. The first sections (2026-11-14 to 17) extrapolate from Kawazu,
a mountain road with mobile mapping; the section "Measured at Sasebo" (2026-11-27) adds an airborne-only area and
the size of the Open Nagasaki data itself.

### What bounds a tile

The cell size of a zoom is its tile width / 512 (`BASE_CELLS`), at every zoom.
A tile therefore has at most 512 x 512 = 262,144 cell columns, and one full
layer is 262,144 x 16 B = 4.19 MB. A second surface above the same column
(a bridge deck, a tree canopy over the ground) adds roughly another layer.

Measured on the Kawazu MMS mesh:

| set | zoom | largest tile | splats in it | share of 262,144 columns |
| --- | ---: | ---: | ---: | ---: |
| 49 cm | z17 | 3.51 MB | 219,224 | 0.84 |
| 24.5 cm | z18 | 11.24 MB | 702,633 | 2.68 |

So tiles of 10 MB occur at 25 cm where there is vertical structure, and at
49 cm wherever the airborne data holds forest volume (up to 26 MB for all returns). Moving the constant 512 up or down moves the
resolution at a given zoom and the tile size together.

### Bytes per square metre, and a prefecture

Kawazu 08OF4060. Denominator: the 120,526 one-metre cells that hold airborne
points (about 120,500 m2; the MMS header box is 113,572 m2). Uniform 49 cm
cells, z16 + z17 (E007 in EXPERIMENTS.md). The mesh is a steep forested
slope with a road, a loop bridge and a viaduct.

| content | all tiles | bytes per m2 | largest z17 tile |
| --- | ---: | ---: | ---: |
| MMS only (road corridor, 196.6 M points) | 6.33 MB | 55.7 (box) | 3.51 MB |
| airborne, ground class only | 11.56 MB | 96 | 4.31 MB |
| airborne, first returns | 35.03 MB | 291 | 12.44 MB |
| airborne, all returns | 70.10 MB | 582 | 25.92 MB |
| MMS + airborne ground | 17.46 MB | 145 | 7.57 MB |
| MMS + airborne first returns | 39.08 MB | 324 | 14.87 MB |
| MMS + airborne all returns | 73.42 MB | 609 | 27.94 MB |
| MMS + airborne ground, adaptive merge (24.5 cm base, 20 cm, 0.2) | 14.14 MB | 117 | 6.66 MB |
| MMS + airborne ground, adaptive merge (10 cm limit) | 22.03 MB | 183 | 12.25 MB |

The earlier Kawazu figures (MMS alone, 55.7 bytes per m2 of its box) were
too low a guide, because the MMS only scans the road corridor. The airborne
data covers the whole mesh, and with every return it fills the volume of
the forest: the median 1 m column holds 12 occupied 49 cm cells in z, so a
tile reaches 1.6 million splats, 6.2 times the 262,144 columns.

Shizuoka Prefecture is about 7,800 km2 (7.8e9 m2). Multiplying a row by that
assumes the whole prefecture looks like this mesh, which it does not (plains,
towns and the sea are different, steep slopes inflate the count); it is
only a scale:

| content | per m2 | prefecture |
| --- | ---: | ---: |
| airborne ground class | 96 | about 0.75 TB |
| MMS + airborne ground | 145 | about 1.1 TB |
| MMS + airborne ground, adaptive | 117 | about 0.9 TB |
| airborne first returns | 291 | about 2.3 TB |
| airborne all returns | 582 | about 4.5 TB |

A bound that needs no scene: a fully occupied single layer at 49 cm is
4.16 cells/m2 x 16 B = 66.5 B/m2, 88.7 B/m2 with the pyramid (z16 and above add
1/4 + 1/16 + ... = 1/3), about 0.69 TB for the prefecture. At 24.5 cm it is four
times that, about 2.8 TB.

Reading, not a decision:

- A budget of 1 TB for the prefecture is about the cost of one surface
  (ground) at 49 cm. It does not hold the forest canopy volume from every
  return, even at 49 cm. Which returns are kept matters more than the
  difference between 49 cm and 24.5 cm cells.
- At 24.5 cm the single-surface bound alone is 2.8 TB.
- Adaptive merging at the same base saves about a fifth on this mixed
  ground-and-road set at a loose limit, less than on the road alone.

Added since (E008): the sparse merge rule keeps vegetation as coarse blobs: MMS +
all airborne returns is 20.0 MB (z16 + z17) instead of 73.4 MB, about 165 B/m2,
an order of 1.3 TB for the prefecture if it looked like this slope. Byte planes
and gzip (Surfel Block v5) take the stored 23.4 MB of the z15 to z17 tiles to
16.0 MB (as a file; stars' Martin cannot serve gzip MLT tiles yet, so the hosted
archive is 23.4 MB). Neither is measured outside this mesh.

Not measured: first-return plus ground (a canopy-top shell with the ground
below), adaptive merging of the canopy sets (that build, MMS + all returns from
a 24.5 cm base, was stopped after 13 minutes without finishing; the merge holds
every base voxel as an object, and the voxel count was not measured), tile compression, and any
area other than this mesh.

### Widened to nine meshes (E009)

On 3 x 3 meshes (1.08 km2, 476 million points) with the same recipe: 220.0 MB
(204 B/m2) when the sparse threshold is the same at every zoom, 132.0 MB
(122 B/m2) when it is multiplied by 4 per zoom step, and 111.0 MB (103 B/m2)
when it is multiplied by 10 (E011; the hosted archive). The size follows the area
(10 to 14 MB per mesh); the largest tile is 7.2 MB (z17), 2.65 MB (z16 with factor 10).
As a scale for the prefecture, extrapolated from this one valley: about 0.95 TB at
122 B/m2, about 0.8 TB at 103 B/m2; 0.71 TB for z17 alone (z17 is the same in both).
With the 12-byte records of Surfel Block version 6 (E016) the same archive is **83.2 MB (77 B/m2)**, exactly 0.75 of
version 5; for the prefecture, extrapolated from this one valley, that is about 0.6 TB (7,780 km2 at 77 B/m2). Loading all 46 tiles of the factor-4 build (8.25 million splats) at once took 0.8 s
to fetch, 3.2 s to decode and 2.1 s to upload on an Apple M1; it was not repeated for
the factor-10 build.

### Measured at Sasebo (airborne only, about 10 points/m2; 2026-11-25 to 27)

- 32 Open Nagasaki sheets (about 17 km2, about half sea; 201 million points): 1,234,118,714 B with z15 to z17 (73 MB/km2), and
  713,970,031 B with z13 to z17 and lower zooms capped per tile (E024; **42 MB/km2**, of which z17 is 86 %).
- Extrapolated from these 32 sheets to Nagasaki Prefecture (about 4,130 km2 of land, all of it in the same airborne data), with the E024 caps:
  about **0.17 TB** at 42 MB per km2 of sheet, and about **0.35 TB** if the sea, about half of the 32 sheets and nearly free, is counted out. The sheets are
  a town, its hills and a bay; mountains and other towns are not known to cost the same.
- The input it would come from (the download page's sheet list, 2026-11-27): 7,824 sheets, about 1.6 TB as zips (the list's sizes are the zips'), about 2.3 TB of LAS.
- Against Kawazu's 77 B/m2 (version 6, mobile mapping and airborne): the airborne-only density gives fewer splats per area at z17, and the caps
  make the lower zooms small; the prefecture figure from Kawazu above (about 0.6 TB) is an upper estimate for airborne data.

### Browser memory, and tiles of 10 MB

PMTiles reads one tile with one range request, so 10 MB tiles are not
practical to stream over the internet but are fine from a local file or a
fast network. What limits the browser is memory and CPU, not the network:

- Memory (E011): the decoded Splat objects were about 280 bytes each in the JS heap and were kept (739 MB at
  2.65 million splats); the demo now keeps only the GPU copy (56 bytes per splat at the time, about 150 MB at that size; 16 bytes since E013) and
  the heap stays at 230 to 420 MB.
- Decode time measured with the pane visible: 389,000 splats decoded in 90 ms
  (about 0.23 us each), uploaded in 84 ms; fetching the 6 MB set from the
  local server took 131 ms. A 700,000-splat tile is therefore a fraction of a
  second to decode. (The first load of the same page measured while the pane
  was hidden took 669 ms to decode; see NOTES.md.)
- GPU memory per splat is **16 bytes** (E013): the block's wire record is uploaded as it
  is and decoded in the vertex shader, so a 700,000-splat tile is about 11 MB and ten of
  them about 110 MB. Before E013 it was 56 bytes (position, two axes and a normal as
  float32, a flag and a color; 39 MB and 390 MB); that path is still there as
  `?gpu=legacy`. Not measured: the GPU's own memory use (the sizes are the buffers'
  byte lengths).
- The demo used to fetch and upload every tile of a tileset when the page opened.
  It now loads only the tiles in view (the nearest nine of the selected zoom, or with `?mixed=1` tiles of several
  zooms covering the view within a byte and splat budget, documents/demo.md); a prefecture-sized archive additionally needs a
  tile list that is not enumerated from the TileJSON bounds (the demo caps that
  list at 4,096 tiles; it was 64 until Sasebo's 6 km2 listed 164).

## Data size against 3D Tiles point clouds

Status: measurements and arithmetic from two areas (2026-11-23). What was measured and what is only computed is marked. Dorayaki is an experiment, not a
standard; 3D Tiles is an OGC standard with a large tool ecosystem. This page compares **bytes**, not capability.

### Short answer

For the same points, Dorayaki's tiles are **1.5 to 3 times smaller than 3D Tiles point tiles at 10 points/m2 (Sasebo), and 45 to 85 times smaller at 440
points/m2 (Kawazu)**. The reason is not a better codec: the Dorayaki archive holds **splats, not points**. Its size follows the number of occupied
cells (area at a resolution, plus vertical layers); a 3D Tiles point cloud follows the number of points. So the advantage is small where the cloud is thin
and large where it is dense. It is paid for with information: the individual points are gone (see "What is given up").

### What was measured

1. **Bytes per point of a published 3D Tiles point cloud** (measured). The UN Smart Maps Group's 3D Tiles of the Open Nagasaki LiDAR
   (<https://source.coop/smartmaps/ngs>; 3D Tiles 1.0, `.pnts`, ADD refinement, 718 nodes in its root tileset): the header and size of six `.pnts` files,
   from 120 B to 296 KB, give **15.0 bytes per point** in every case: POSITION as float32 x 3 (12 B) and RGB as 8 bits x 3 (3 B), no quantization and
   no Draco. (Only the headers were read, by range request; the dataset is a part of the prefecture and its thinning is unknown, so it says
   nothing about the total size over Sasebo.)
2. **Compressing and quantizing the same layout** (measured, `npm run measure:pnts -- <file.las> [cell m]`): points of 3 x 3 cells of 256 m (Sasebo)
   or 100 m (Kawazu) are laid out per cell as `.pnts` (float32 relative to the cell, RGB 8 bits), or with positions quantized to 16 bits per axis over the
   cell (9 B per point), then compressed per cell, in file order and in Morton order. Bytes per point:

   | layout | Sasebo `01JE3513` (airborne, 9.8 points/m2; 5.4 M points) | Kawazu `08OF4060` airborne (121 points/m2; 10.3 M points) |
   | --- | ---: | ---: |
   | LAS (format 2 / format 3, as stored) | 26.0 | 34.0 |
   | `.pnts` float32 + RGB, raw | 15.0 | 15.0 |
   | + gzip -6 | 12.6 | 9.3 |
   | + brotli 9 | 11.9 | 8.4 |
   | + gzip, Morton order | 11.8 | 8.2 |
   | + brotli, Morton order | 11.3 | 7.9 |
   | 16-bit positions + RGB, raw | 9.0 | 9.0 |
   | + gzip -6 | 8.5 | 8.1 |
   | + brotli 9 | 8.4 | 8.0 |
   | + gzip, Morton order | 8.1 | 7.9 |
   | + brotli, Morton order | 8.2 | 7.8 |

   About 8 bytes per point is the practical floor for "every point, RGB, no Draco": about 5 bytes of position and 3 of color survive any of these.
   Draco or meshopt point compression was **not** run (no encoder here); published figures for them are lower for positions, but none was measured, and none
   is claimed.
3. **Dorayaki** (measured): 8 Open Nagasaki sheets around Sasebo Bay (37,848,922 points, 6 km2, of which about half is sea) became 17.0 million splats and a
   **203,951,931 B** PMTiles file (Surfel Block v6, 12 bytes per splat, z15 to z17, raw tiles). Kawazu (9 Virtual Shizuoka meshes, MMS and airborne,
   476,004,940 points, 1.08 km2): 6,935,498 splats, **83,887,706 B**.

### The comparison

| | points | LAS as stored | 3D Tiles `.pnts` as published (15.0 B/pt) | 16-bit + brotli (about 8 B/pt) | Dorayaki | smaller than `.pnts` | smaller than 16-bit + brotli |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sasebo, 8 sheets, 6 km2 | 37.85 M | 984 MB | 568 MB | about 310 to 320 MB | **204 MB** | 2.8 x | 1.5 x |
| Kawazu, 9 meshes, 1.08 km2 | 476 M | about 16 GB (34 B/pt) | 7.1 GB | about 3.7 to 3.9 GB | **83.9 MB** | 85 x | 44 to 47 x |

(The `.pnts` and 16-bit columns are points x bytes per point: arithmetic, using the per-point figures above; they assume every point is kept once, as in an
ADD-refined point tileset. The Kawazu per-point figures come from its airborne file, and are assumed for its MMS points.)

Per area: Sasebo 34 B/m2, Kawazu 78 B/m2. Per source point: Sasebo 5.4 B, Kawazu 0.18 B.

### Why the ratio depends on density

A point tileset stores each point once: bytes = points x (8 to 15). The Dorayaki archive stores about one splat per occupied cell of each zoom
(z17 cells are 0.5 m, z16 1 m, z15 2 m), merged where neighbouring cells are coplanar and the same color: bytes = splats x 12. At Sasebo's 9.8 points/m2 there
are about 0.45 splats per point, so each splat stands for two points; at Kawazu's 440 points/m2 (MMS plus airborne) there are 0.015 splats per point, 68 points
per splat. At about 4 points/m2 or less a 0.5 m cell holds about one point, so at z17 there are as many splats as points and the advantage is gone (the 1 m cells of z16
still hold 3.5 points at Sasebo). Merging coplanar cells is what keeps Sasebo below one splat per point.

### What is given up

- **The points themselves.** A splat is a fitted Gaussian of the points in a cell (or a merged group of cells). Individual returns, their intensity,
  return number, scan angle and GPS time are not kept. The class code can travel in an optional class plane; Open Nagasaki's points are all class 1 anyway.
- **Precision.** Positions to 1/16384 of the tile (v6): about 1.6 cm at z17, 3 cm at z16, and merging coarsens it further on flat surfaces (the large
  flat discs on Sasebo's car parks are the visible case); color 6 bits per channel; height steps of at least 1 mm. 3D Tiles carries float32 positions
  (millimetre level at this extent) and 8-bit color.
- **Fitness for measurement.** Dorayaki is a rendering form. It is not a survey product and its accuracy against ground truth has not been evaluated.
  Do not measure on it.
- **Standardization.** The MLT frame tags 0xD0 and 0xD1 are experimental, not assigned. 3D Tiles is an OGC community standard with Cesium, deck.gl, iTowns,
  QGIS and others reading it.

### What is not size but may matter

- **Files.** The Smart Maps tileset has a median `.pnts` of about 92 KB (of the first 1,000 files its listing returned) and many hierarchical tileset files; Dorayaki is one PMTiles file read with
  Range requests, addressed by z/x/y. Not measured: request counts, time to first picture.
- **Gaussian splats inside 3D Tiles** (glTF with a Gaussian-splat extension): by the attribute list (float32 position 12 B, rotation 16, scale 12,
  opacity 4, color 12 for degree-0 SH), about 56 bytes per splat uncompressed against Dorayaki's 12 for a similar object. This is arithmetic from my reading
  of the extension, not a measurement, and the extension's details and its compressed variants were not checked.
- **Rendering cost** was not compared.

### Not measured or not done

- Draco, meshopt or SPZ-type compression of either layout; the per-point figures above are for gzip and brotli of simple layouts.
- 3D Tiles produced from the Sasebo or Kawazu points by a real tool (py3dtiles or similar): the per-point sizes are a model built from the published
  dataset's encoding.
- Level-of-detail overhead of a point tileset (some builders write coarse levels as extra copies); the table assumes none.
- Any area other than these two; the density dependence is shown by two points on one curve.

### Reproduce

`npm run measure:pnts -- data/nagasaki/2023-lp-01JE3513/01JE3513.las` and `... data/virtual-shizuoka/2019-lp-ground-08OF4060/08OF4060.las 100`
(the files are not in the repository: [datasets.md](datasets.md), [build.md](build.md)). The `.pnts` headers:
`https://data.source.coop/smartmaps/ngs/<key>` with `Range: bytes=0-4095`.
