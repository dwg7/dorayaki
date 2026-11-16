# Kawazu tileset: recipe, size, hosting

Status: built, verified and hosted on stars as one archive, `dorayaki-kawazu`
(raw-tile PMTiles, the factor-10 build of 2026-11-16). The Pages site lists it as
`?fixture=kawazu`.
Facts about the data are in [large-point-clouds.md](large-point-clouds.md); the
experiments behind the choices are E005 to E011 in
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
| splats | z15 84,477; z16 678,826; z17 6,172,195; total 6,935,498 |
| archive | **83,230,962 bytes** (Surfel Block version 6), raw tiles, gzip directories; SHA-256 `9f416dcb7558e81d38a915c25ff6a9685a0f1277666d592e7ba47c9a02165e5f` |
| per area | 77 B/m2 (z17 alone 69 B/m2) |
| tiles | z15 1,014,034 B, z16 8,146,845, z17 74,068,696; largest tile 5.4 MB (z17) |
| bounds | 138.93585, 34.78674, 138.95233, 34.79802 (west, south, east, north); centre 138.93930, 34.79176 |
| served | `https://stars.optgeo.org/dorayaki-kawazu` (TileJSON, zoom 15 to 17), `.../{z}/{x}/{y}` |

The archive's own metadata still names it `kawazu-v2: merged kawazu-m08OF4060, ...`
(the name it was built under); the name stars serves is the file name.

## Per-zoom threshold factor 10 (hosted 2026-11-16)

E011 raised the per-zoom threshold factor from 4 to 10
(`DORAYAKI_ADAPTIVE_SPARSE_SCALE=10`): nine meshes give 111.0 MB (z15 1.4, z16 10.9,
z17 98.8 MB) instead of 132.0 MB (the earlier factor-4 archive, SHA-256 `5ff8eafc...`),
and the showcase view fetches 10.8 MB instead of 26.9 MB. It replaced the factor-4
file on stars on 2026-11-16, with the TileJSON URL moved to `?v=20261117`.

## Version 6 (hosted 2026-11-17)

The hosted archive is the same content as the factor-10 build written as Surfel Block version 6 (12-byte records,
[surfel-block-format.md](surfel-block-format.md), E016): 83,230,962 bytes against 110,972,600, exactly 0.750 (z15
1,014,034, z16 8,146,845, z17 74,068,696; 46 tiles, 6,935,498 splats). It was built with
`DORAYAKI_BLOCK_VERSION=6` on every `build:tileset` and on `merge:tilesets`, and checked tile by tile against the files
(46 of 46 byte-identical, read with the reference `pmtiles` reader) before and after the upload. The TileJSON URL is now
`?v=20261117v6b`. Version 5 data (the earlier archive, SHA-256 `90afb84f...`, 110,972,600 bytes) is kept only locally
as `demo/tiles/dorayaki-kawazu-v2.pmtiles`; the live site reads both versions. A browser that still has the older page
bundle cached cannot read version 6 tiles (it reports an unsupported version) until it reloads.

The archive's centre (the demo's default view) comes from the first tileset given to `merge:tilesets`: put
`kawazu-m08OF4060` (the loop bridge) first, or the view opens about 300 m north. The first upload of this archive had the
mesh `08OF4050` first and was replaced the same day by a rewrite with the centre set back (the tile files are unchanged).

## Recipe

Each mesh is built alone, because the voxel accumulators need about 100 bytes per
voxel and this machine has 8 GB of RAM; the tilesets are then merged
(`npm run merge:tilesets`, [large-point-clouds.md](large-point-clouds.md)).
Cells are tile width / 512 at each zoom (z17: 49 cm). Merging
([adaptive-merging.md](adaptive-merging.md)) at every zoom: thickness 20 cm, colour
tolerance 0.2, three merge levels, the sparse rule at 24 points at z17 multiplied
by 10 for each zoom below (z16: 240, z15: 2,400).

```sh
export DORAYAKI_ADAPTIVE_REFINE=0 DORAYAKI_ADAPTIVE_LEVELS=3 \
  DORAYAKI_ADAPTIVE_THICKNESS=0.2 DORAYAKI_ADAPTIVE_COLOUR=0.2 \
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
between two meshes is fitted in each).

Verified: the archive's 46 directory entries each equal the file on disk and decode
to 6,935,498 splats.

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
- 2026-11-17: the version 6 archive (83,230,961 B, SHA-256 `3395c2c3...`) replaced the factor-10 version 5 archive
  (`rm`, 8 s pause, `mv -n`); its centre was wrong (see above), so a rewrite with the right centre (83,230,962 B,
  `9f416dcb...`) replaced it minutes later, and the TileJSON URL moved to `?v=20261117v6b`. Both uploads: SHA-256 equal on
  the host, tiles served with the Pages origin byte-identical to the local files.
- 2026-11-16 (later): the factor-10 area archive (110,972,600 B, SHA-256 matched on
  the host) replaced the factor-4 file the same way (`rm`, 8 s pause, `mv -n`); the
  TileJSON URL became `?v=20261117` because of the stale edge cache below.

**Not compressed in transit.** With `Accept-Encoding: gzip, br`, the 6.33 MB tile
of the single mesh still crossed the wire as 6,333,031 bytes (Cloudflare does not
compress this content type), so the saving of gzip tiles is not realised until
Martin supports gzip MLT tiles or the type is added to the CDN's compression
list: a question for the stars project.

The page loads only the tiles in view ([demo-and-site.md](demo-and-site.md)): at
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
its tile template, so requesting `https://stars.optgeo.org/dorayaki-kawazu?v=20261117v6b`
gives tile URLs ending in `?v=20261117v6b`, which miss the stale entries (the four tiles
and the formerly cached 404 tested were served with the new sizes). The site is built
with a versioned URL; bump `v` whenever the archive behind a name is replaced.

The site is rebuilt with:

```sh
DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu \
DORAYAKI_KAWAZU_TILEJSON='https://stars.optgeo.org/dorayaki-kawazu?v=20261117v6b' npm run site
```

The demo opens Kawazu with terrain on (lowered by 2 m) and splat scale 1.3 by
default (`?terrain=0`, `?extent=1` switch them off).

## Data licence

The source point clouds are Shizuoka Prefecture's VIRTUAL SHIZUOKA (CC BY); the
archive's attribution says so.
