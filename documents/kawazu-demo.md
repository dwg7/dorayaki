# Kawazu tileset: recipe, size, hosting

Status: built, verified and hosted on stars as one archive, `dorayaki-kawazu`
(raw-tile PMTiles). The Pages site built from this branch lists it as
`?fixture=kawazu`; the site that is live goes with the merge to `main`.
Facts about the data are in [large-point-clouds.md](large-point-clouds.md); the
experiments behind the choices are E005 to E010 in
[EXPERIMENTS.md](../EXPERIMENTS.md).

## What it is

The Kawazu loop bridge and the valley below it: nine meshes of 300 m x 400 m
(`08OF4050` to `08OF4072`, rows 5 to 7, columns 0 to 2 of the 5000-scale cell
`08OF40`; 900 m x 1,200 m = 1.08 km2; JGD2011 zone VIII). Airborne laser (LP, all
returns) for all nine meshes and mobile mapping (MMS) for four of them, merged.
Elevations are orthometric (130 to 360 m), so the demo turns MapLibre terrain on,
lowered by 2 m ([adaptive-merging.md](adaptive-merging.md), E010).

| | |
| --- | --- |
| input | 476,004,940 points: LP 148.2 million in 9 files, MMS 327.8 million in 4 files (LAS 1.2 format 3) |
| zooms | z15 (4 tiles), z16 (12), z17 (30): 46 tiles |
| splats | z15 391,166; z16 1,688,254; z17 6,172,195; total 8,251,615 |
| archive | **132,030,481 bytes**, raw tiles, gzip directories; SHA-256 `5ff8eafcb0f9f70996b57b7f0c70460c34c8585857d26a2ea1a4edec4dd85733` |
| per area | 122 B/m2 (z17 alone 91 B/m2) |
| tiles | median 3.6 MB at z17, largest 7.2 MB (z17) |
| bounds | 138.93585, 34.78674, 138.95233, 34.79802 (west, south, east, north); centre 138.93930, 34.79176 |
| served | `https://stars.optgeo.org/dorayaki-kawazu` (TileJSON, zoom 15 to 17), `.../{z}/{x}/{y}` |

The archive's own metadata still names it `kawazu-area: merged kawazu-m08OF4050, ...`
(the name it was built under); the name stars serves is the file name.

## Recipe

Each mesh is built alone, because the voxel accumulators need about 100 bytes per
voxel and this machine has 8 GB of RAM; the tilesets are then merged
(`npm run merge:tilesets`, [large-point-clouds.md](large-point-clouds.md)).
Cells are tile width / 512 at each zoom (z17: 49 cm). Merging
([adaptive-merging.md](adaptive-merging.md)) at every zoom: thickness 20 cm, colour
tolerance 0.2, three merge levels, the sparse rule at 24 points at z17 multiplied
by 4 for each zoom below (z16: 96, z15: 384).

```sh
export DORAYAKI_ADAPTIVE_REFINE=0 DORAYAKI_ADAPTIVE_LEVELS=3 \
  DORAYAKI_ADAPTIVE_THICKNESS=0.2 DORAYAKI_ADAPTIVE_COLOUR=0.2 \
  DORAYAKI_ADAPTIVE_SPARSE=24 DORAYAKI_ADAPTIVE_SPARSE_SCALE=4
R=data/virtual-shizuoka
for m in 08OF4050 08OF4051 08OF4052 08OF4060 08OF4061 08OF4062 08OF4070 08OF4071 08OF4072; do
  files=$R/2019-lp-ground-$m/$m.las
  [ -f $R/2019-mms-$m/$m.las ] && files=$R/2019-mms-$m/$m.las,$files   # MMS exists for 4050, 4060, 4070, 4071
  npm run build:tileset -- $files 8 kawazu-m$m 17 16 15
done
npm run merge:tilesets -- kawazu kawazu-m08OF4050 kawazu-m08OF4051 kawazu-m08OF4052 \
  kawazu-m08OF4060 kawazu-m08OF4061 kawazu-m08OF4062 kawazu-m08OF4070 kawazu-m08OF4071 kawazu-m08OF4072
```

This writes `demo/tiles/kawazu/` (raw tiles and TileJSON, for the local demo) and
`demo/tiles/dorayaki-kawazu.pmtiles`. The nine builds took 20 to 50 s each (peak
1.23 GB) and 269 s in all. Tiles in the archive are raw because stars' Martin 1.14
cannot read gzip MLT tiles; `DORAYAKI_TILE_COMPRESSION=gzip` would make them about
30 % smaller (see below). Mesh seams are not reconciled (a voxel cut by the edge
between two meshes is fitted in each).

Verified: the archive's 46 directory entries each equal the file on disk and decode
to 8,251,615 splats.

## Hosting on stars

Procedure as for Numazu ([numazu-demo.md](numazu-demo.md); NOTES.md): the owner
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
- **Not compressed in transit.** With `Accept-Encoding: gzip, br`, the 6.33 MB tile
  of the single mesh still crossed the wire as 6,333,031 bytes (Cloudflare does not
  compress this content type), so the saving of gzip tiles is not realised until
  Martin supports gzip MLT tiles or the type is added to the CDN's compression
  list: a question for the stars project.

The page loads only the tiles in view ([demo-and-site.md](demo-and-site.md)): at
`?fixture=kawazu#map=16.63/34.790766/138.939214/128.7/67` it fetched 8 tiles,
26.9 MB, 1,680,486 splats from stars (the slowest tile 3.1 s; decoding 2.1 s in all
on an Apple M1).

The site is rebuilt with:

```sh
DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu \
DORAYAKI_KAWAZU_TILEJSON=https://stars.optgeo.org/dorayaki-kawazu npm run site
```

The demo opens Kawazu with terrain on (lowered by 2 m) and splat scale 1.3 by
default (`?terrain=0`, `?extent=1` switch them off).

## Data licence

The source point clouds are Shizuoka Prefecture's VIRTUAL SHIZUOKA (CC BY); the
archive's attribution says so.
