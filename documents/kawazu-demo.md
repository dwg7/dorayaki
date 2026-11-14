# Kawazu tileset: recipe, size, hosting

Status: built, verified, and hosted on stars (2026-11-15) as raw-tile PMTiles; the
Pages site that lists it is built but not yet published (it goes live when the
branch is merged to `main`).
Facts about the data are in [large-point-clouds.md](large-point-clouds.md); the
experiments behind the choices are E005 to E008 in
[EXPERIMENTS.md](../EXPERIMENTS.md).

## What it is

The Kawazu loop bridge area (mesh `08OF4060`, 300 m x 400 m, JGD2011 zone VIII):
the mobile-mapping (MMS) point cloud of the road corridor merged with the
airborne laser (LP) point cloud of the whole mesh, all returns. Elevations are
orthometric (130 to 360 m), so the demo turns MapLibre terrain on for it.

| | |
| --- | --- |
| input | 196,608,664 MMS points + 14,551,545 LP points (LAS 1.2 format 3) |
| zooms | z15 and z16 (aggregated), z17 (maxzoom): 11 tiles |
| splats | z15 207,285; z16 550,330; z17 702,139; total 1,459,754 |
| tiles | 23,356,838 bytes (Surfel Block v5 in an experimental MLT frame) |
| hosted archive | **23,357,992 bytes** (`dorayaki-kawazu.pmtiles`, raw tiles, gzip directories), SHA-256 `042e4dce409b5d03f2840a1cffb817edb67a5b8b9e3fbf53ca9bb47aa89b3dbc` |
| with gzip tiles | 15,952,873 bytes (SHA-256 `3c46b043...745bdc`), **not hostable on stars today**: see below |
| build | 63 s on an Apple M1 |
| bounds | 138.93585, 34.78899, 138.94409, 34.79351 (west, south, east, north); centre 138.93930, 34.79176 |

Browser load measured on an Apple M1 with the pane visible, the file served
locally: fetch 110 ms, decode 836 ms, GPU upload 333 ms for 1,459,754 splats.

## Recipe

Cells are tile width / 512 at each zoom (z17: 49 cm). All zooms use adaptive
merging with these limits ([adaptive-merging.md](adaptive-merging.md)):
thickness 20 cm, colour tolerance 0.2, three merge levels, and the sparse rule
at 24 points (voxels supported by fewer than 24 points are merged into larger
blobs, which is how the vegetation is kept small).

```sh
M=data/virtual-shizuoka/2019-mms-08OF4060/08OF4060.las
P=data/virtual-shizuoka/2019-lp-ground-08OF4060/08OF4060.las
DORAYAKI_ADAPTIVE_REFINE=0 DORAYAKI_ADAPTIVE_LEVELS=3 \
DORAYAKI_ADAPTIVE_THICKNESS=0.2 DORAYAKI_ADAPTIVE_COLOUR=0.2 DORAYAKI_ADAPTIVE_SPARSE=24 \
  npm run build:tileset -- $M,$P 8 kawazu 17 16 15
```

This writes `demo/tiles/kawazu/` (raw tiles and TileJSON, for the local demo)
and `demo/tiles/dorayaki-kawazu.pmtiles`. Tiles in the archive are raw (23.4 MB), which is what stars hosts; with
`DORAYAKI_TILE_COMPRESSION=gzip` they are gzipped (16.0 MB), and the archive does
not load in Martin 1.14 (see below). The first build of this archive used gzip
by default; the default is now raw.

Verified: the archive's 11 directory entries each gunzip to exactly the file
on disk, and decoding all of them gives 1,459,754 splats.

## Hosting on stars

Done on 2026-11-15, with the repository owner authenticating, following the
Numazu procedure ([numazu-demo.md](numazu-demo.md); NOTES.md): read-only check,
`scp` to a hidden name in `/home/stars/data/`, size and SHA-256 compared on the
host, `mv -n` into place. Martin registered the file without a restart.

- **Gzip tiles failed.** The first upload had gzip-compressed tiles (15.95 MB).
  Martin 1.14.0 kept retrying it and logged `Format Mlt and compression Gzip are
  not yet supported`; `/dorayaki-kawazu` stayed 404. It was replaced by the
  raw-tile archive (the old file was removed after its SHA-256 matched what had
  been uploaded).
- Served now: `https://stars.optgeo.org/dorayaki-kawazu` (TileJSON: zoom 15 to
  17, bounds as above, attribution from the archive) and
  `https://stars.optgeo.org/dorayaki-kawazu/{z}/{x}/{y}`. Four tiles checked
  (z15, z16, two z17): byte-identical to the local files, content type
  `application/vnd.maplibre-tile`, no `Content-Encoding`, CORS echoes the
  request origin, `cache-control: max-age=14400`; z18 is 404.
- **Not compressed in transit.** With `Accept-Encoding: gzip, br`, the 6.33 MB
  z17 tile still crossed the wire as 6,333,031 bytes (Cloudflare does not
  compress this content type), so the 31 % that gzip would save is not realised
  until Martin supports gzip MLT tiles or the type is added to the CDN's
  compression list. This is a question for the stars project.
- The demo reads it from stars with the flag-free dev entry `kawazu-stars`
  (11 tiles, 1,459,754 splats; fetch of the 21 requests finished within 4 s, the
  largest tiles 3.2 to 3.7 s; decode 624 ms and upload 318 ms on an Apple M1,
  with the pane visible).

Rebuild the site (done; `docs/` is committed):

```sh
DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu \
DORAYAKI_KAWAZU_TILEJSON=https://stars.optgeo.org/dorayaki-kawazu npm run site
```

The demo opens Kawazu with terrain on and splat scale 1.3 by default
(`?terrain=0`, `?extent=1` switch them off).

## Data licence

The source point clouds are Shizuoka Prefecture's VIRTUAL SHIZUOKA (CC BY);
the archive's attribution says so.
