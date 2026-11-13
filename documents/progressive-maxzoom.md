# Proposal: maxzoom and progressive ordering inside maxzoom tiles

Status: **partly implemented.** Surfel Block v3 carries the level table
(`documents/surfel-block-format.md`). `src/progressive.ts` produces the nested
refinement order, and the Numazu demo builds z18/z19 aggregated tiles plus
a 3-level z20 maxzoom tile, drawn by prefix. Not implemented: compact
records (v4/v5), HTTP Range prefix fetch, and distance-based selection (see
"Findings from v3"). The measurements are observed (`npm run
measure:numazu`, PDAL for COPC).

## Problem

Point clouds from mobile mapping are very dense. VIRTUAL SHIZUOKA MMS mesh
08NE2701 has 976,195 points on 111.9 m² of footprint, about 8,700 points
per m². Its surroundings, the station mesh 08NE3811, average an estimated
1,900 points per m² over 400 m × 300 m. That figure is not measured: it
assumes the same zip compression ratio as 08NE2701 (3.24 GB zip).

The zoom hierarchy is Dorayaki's level-of-detail mechanism. Detail finer
than the maxzoom tile can only come from that tile, so the choice of
maxzoom trades tile size against depth:

- a high maxzoom (21–22) gives small tiles but a deep pyramid;
- a low maxzoom (18–20) gives a shallow pyramid but huge maxzoom tiles.

## Measurements (08NE2701, 35.13° N)

`v_z` is the tile width / 512, about one CSS pixel at zoom z. Each row
holds one Gaussian per occupied `v_z` voxel. "Added" is the number of
Gaussians that are new at that level when coarse cells are kept as
representatives. COPC baseline: PDAL `writers.copc`, with GPS time,
intensity and other attributes zeroed, is 5,183,226 bytes (5.31 bytes per
point). With all attributes it is 6,360,621 bytes (6.52 bytes per point).

| zoom | tile width | v_z | Gaussians | points / Gaussian | added | bytes at 32 B | × COPC (xyz+rgb) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 18 | 125.0 m | 24.4 cm | 7,650 | 127.6 | 5,643 | 244,800 | 0.05 |
| 19 | 62.5 m | 12.2 cm | 30,057 | 32.5 | 22,407 | 961,824 | 0.19 |
| 20 | 31.3 m | 6.1 cm | 99,926 | 9.8 | 69,869 | 3,197,632 | 0.62 |
| 21 | 15.6 m | 3.1 cm | 259,440 | 3.8 | 159,514 | 8,302,080 | 1.60 |
| 22 | 7.8 m | 1.5 cm | 512,461 | 1.9 | 253,021 | 16,398,752 | 3.16 |
| 23 | 3.9 m | 0.8 cm | 783,501 | 1.2 | 271,040 | 25,072,032 | 4.84 |

Observations:

- Gaussian counts grow about 4× per zoom at coarse levels (surfaces) and
  only about 1.5× near z23, where voxels approach the point spacing.
- With the current 32-byte record, Dorayaki beats COPC only down to z20
  detail. At z22 detail it is 3.2× larger.

## Proposed design

### 1. Tiles below maxzoom: aggregated Gaussians (unchanged concept)

A tile at zoom `z < M` holds one aggregated Gaussian per occupied `v_z`
voxel. This is the tile-hierarchy LOD, as today.

### 2. The maxzoom tile: nested refinement order (optional to use)

The maxzoom tile `M` holds the finest Gaussians down to a chosen finest
level `F > M`, ordered by level:

- level 0: one representative finest Gaussian per occupied `v_M` cell;
- level k: one representative per `v_{M+k}` cell not already represented;
- level F − M: all remaining finest Gaussians.

The union of all levels is exactly the finest set, so nothing is stored
twice. Level sizes are the "added" column, and level 0 has as many
Gaussians as an aggregated tile at `M`. The representative of a cell is
the finest Gaussian nearest to the cell's point centroid (deterministic).

The block header carries a small level table (one count per level).
Records stay plain, and there are no per-record bytes for rank, unlike
gint's spare-bit rank.

### 3. Rendering

At display zoom `Z ≥ M`, the renderer draws the prefix of levels
0..`Z − M`. It inflates the radius of drawn records to cover their cell:
`r' = max(r, c · v_Z)`. Below `M`, it uses the aggregated tiles.

### 4. Conformance with AGENTS.md

- The level table is optional to use. A decoder that ignores it decodes
  the whole block and draws every finest Gaussian. That is correct, only
  slower. Progressive refinement is therefore not required by the format
  or the decoder.
- It acts only beyond maxzoom, where the tile hierarchy cannot add detail.
  It complements the tile LOD rather than competing with it; there is
  still one mandatory LOD mechanism.

### 5. Partial fetch

Because levels are byte prefixes, a client can fetch only the first
`bytes(levels 0..k)` of a maxzoom tile with an HTTP Range request. That
works for z/x/y files and for PMTiles entries alike. Low-zoom views of a
large maxzoom tile then cost about as much as an aggregated tile.

## Choosing maxzoom (recommendation)

Extrapolated per tile, at the station mesh's estimated average density of
about 1,900 points per m², and with finest level F = z22 (about 1.9 points per
Gaussian):

| M | tile width | points per tile | finest Gaussians | level 0 | COPC (xyz+rgb) of same points |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 19 | 62.5 m | ≈ 7.3 M | ≈ 3.8 M | ≈ 225 k | ≈ 39 MB |
| 20 | 31.3 m | ≈ 1.8 M | ≈ 0.96 M | ≈ 187 k | ≈ 9.7 MB |

Recommendation: **M = 20 with levels to F = z22**. That gives three
levels: z20 base, z21, z22. M = 19 is possible if clients fetch prefixes
with Range requests, since its full tiles reach tens of MB. M = 18 is not
realistic for MMS density.

## Efficiency target and version plan

Target: in the worst case, the finest-level tile is smaller than COPC
(xyz+rgb) of the same points. At F = z22 that means at most about
**10 bytes per Gaussian** (5.31 bytes per point × 1.9 points per Gaussian);
aim for 8. At F = z23 the budget is about 6.6 bytes.

Each step is a separate version, measured against the table above:

1. **v3: nested refinement order.** The level table is added to the
   header; records unchanged (32 bytes). Measure prefix sizes and view
   quality. Structural; no compression yet.
2. **v4: compact record.** Position quantized to 1 mm relative to the
   tile, octahedral normal (2 × 8 bits), logarithmic radius (8 bits),
   RGBA8. Estimated 12–14 bytes.
3. **v5: structure of arrays.** Morton order within each level, delta
   coding per column, a general-purpose compressor. Measured against the
   ≤ 8–10 byte target.

Anisotropic shapes (scales and rotation) are a separate open question
(NOTES.md). They add bytes, so any such change will be measured against
the same COPC baseline.

## Findings from v3 (Numazu, 2026-11-13)

Built with `npm run demo:numazu`. The patch straddles two z20 tiles.

| tiles | Gaussians | bytes | × COPC (xyz+rgb, 5,183,226 B) |
| --- | ---: | ---: | ---: |
| z18 aggregated (1 tile) | 7,639 | 244,502 | 0.05 |
| z19 aggregated (1 tile) | 29,989 | 959,702 | 0.19 |
| z20 levels 0 | 99,660 | 3,189,176 | 0.62 |
| z20 levels 0–1 | 257,308 | 8,233,912 | 1.59 |
| z20 levels 0–2 (all, z22 detail) | 512,401 | 16,396,888 | 3.16 |

- Prefix sizes follow the measured "added" column. Level 0 of the
  maxzoom tile is the size of an aggregated z20 tile, as designed.
- **Selecting by map zoom fails for 3D close-ups.** MapLibre's zoom
  depends on camera altitude and pitch, not on the distance to data above
  the ground. Moving the camera from 60 m to 10 m in front of the trees at
  14 m eye height kept zoom 19.58, so the coarse z19 tile was drawn close
  up. Selection should use per-tile screen-space error from the camera
  distance, as in 3D Tiles.
- **Finest Gaussians have no shape.** At 1.5 cm voxels there are about 1.9
  points per Gaussian, and none of them is flat. Their normals are
  arbitrary (the first eigen-axis), and from above many discs are seen
  edge-on, so canopy coverage shows gaps even with inflated radii. Two
  consequences: round Gaussians should be drawn camera-facing, and a
  compact record (v4) can mark "no orientation" instead of storing a
  normal.
