# Kawazu tileset: recipe, size, hosting

Status: built and verified locally; hosting on stars is planned, not done.
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
| tiles, stored | 23,356,838 bytes (Surfel Block v5 in an experimental MLT frame) |
| archive | **15,952,873 bytes** (`dorayaki-kawazu.pmtiles`, gzip tiles and directories) |
| SHA-256 | `3c46b0430bb68559d947671c792fe9906b7b5d2f428b856c138e107fdb745bdc` |
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
and `demo/tiles/dorayaki-kawazu.pmtiles`. `DORAYAKI_TILE_COMPRESSION=none`
keeps the archive's tiles raw (23.4 MB; the fallback if a server mishandles
gzip tiles).

Verified: the archive's 11 directory entries each gunzip to exactly the file
on disk, and decoding all of them gives 1,459,754 splats.

## Hosting on stars (planned)

Procedure as for Numazu ([numazu-demo.md](numazu-demo.md); NOTES.md,
2026-11-15): authentication is the repository owner's.

1. Read-only check on `ssh spacex.optgeo.org`: no `dorayaki-kawazu*`, free
   space, Martin active.
2. `scp` the archive to `/home/stars/data/` under a hidden name
   (`.dorayaki-kawazu.pmtiles.new.<rand>`, invisible to Martin's scan), check
   size and SHA-256 on the host, then `mv -n` to `dorayaki-kawazu.pmtiles`.
3. Check `https://stars.optgeo.org/dorayaki-kawazu` (TileJSON), a tile at each
   zoom, and the response headers: **new for this archive is gzip tile
   compression**; Martin must send `Content-Encoding: gzip` so that the
   browser inflates the tile. If not, replace the file with the raw-tile
   build.
4. Rebuild the site with
   `DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu DORAYAKI_KAWAZU_TILEJSON=https://stars.optgeo.org/dorayaki-kawazu npm run site`.

The demo opens Kawazu with terrain on and splat scale 1.3 by default
(`?terrain=0`, `?extent=1` switch them off).

## Data licence

The source point clouds are Shizuoka Prefecture's VIRTUAL SHIZUOKA (CC BY);
the archive's attribution says so.
