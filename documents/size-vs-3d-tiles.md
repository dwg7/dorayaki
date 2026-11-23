# Data size against 3D Tiles point clouds

Status: measurements and arithmetic from two areas (2026-11-23). What was measured and what is only computed is marked. Dorayaki is an experiment, not a
standard; 3D Tiles is an OGC standard with a large tool ecosystem. This page compares **bytes**, not capability.

## Short answer

For the same points, Dorayaki's tiles are **1.5 to 3 times smaller than 3D Tiles point tiles at 10 points/m2 (Sasebo), and 45 to 85 times smaller at 440
points/m2 (Kawazu)**. The reason is not a better codec: the Dorayaki archive holds **splats, not points**. Its size follows the number of occupied
cells (area at a resolution, plus vertical layers); a 3D Tiles point cloud follows the number of points. So the advantage is small where the cloud is thin
and large where it is dense. It is paid for with information: the individual points are gone (see "What is given up").

## What was measured

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

## The comparison

| | points | LAS as stored | 3D Tiles `.pnts` as published (15.0 B/pt) | 16-bit + brotli (about 8 B/pt) | Dorayaki | smaller than `.pnts` | smaller than 16-bit + brotli |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sasebo, 8 sheets, 6 km2 | 37.85 M | 984 MB | 568 MB | about 310 to 320 MB | **204 MB** | 2.8 x | 1.5 x |
| Kawazu, 9 meshes, 1.08 km2 | 476 M | about 16 GB (34 B/pt) | 7.1 GB | about 3.7 to 3.9 GB | **83.9 MB** | 85 x | 44 to 47 x |

(The `.pnts` and 16-bit columns are points x bytes per point: arithmetic, using the per-point figures above; they assume every point is kept once, as in an
ADD-refined point tileset. The Kawazu per-point figures come from its airborne file, and are assumed for its MMS points.)

Per area: Sasebo 34 B/m2, Kawazu 78 B/m2. Per source point: Sasebo 5.4 B, Kawazu 0.18 B.

## Why the ratio depends on density

A point tileset stores each point once: bytes = points x (8 to 15). The Dorayaki archive stores about one splat per occupied cell of each zoom
(z17 cells are 0.5 m, z16 1 m, z15 2 m), merged where neighbouring cells are coplanar and the same color: bytes = splats x 12. At Sasebo's 9.8 points/m2 there
are about 0.45 splats per point, so each splat stands for two points; at Kawazu's 440 points/m2 (MMS plus airborne) there are 0.015 splats per point, 68 points
per splat. At about 4 points/m2 or less a 0.5 m cell holds about one point, so at z17 there are as many splats as points and the advantage is gone (the 1 m cells of z16
still hold 3.5 points at Sasebo). Merging coplanar cells is what keeps Sasebo below one splat per point.

## What is given up

- **The points themselves.** A splat is a fitted Gaussian of the points in a cell (or a merged group of cells). Individual returns, their intensity,
  return number, scan angle and GPS time are not kept. The class code can travel in an optional class plane; Open Nagasaki's points are all class 1 anyway.
- **Precision.** Positions to 1/16384 of the tile (v6): about 1.6 cm at z17, 3 cm at z16, and merging coarsens it further on flat surfaces (the large
  flat discs on Sasebo's car parks are the visible case); color 6 bits per channel; height steps of at least 1 mm. 3D Tiles carries float32 positions
  (millimetre level at this extent) and 8-bit color.
- **Fitness for measurement.** Dorayaki is a rendering form. It is not a survey product and its accuracy against ground truth has not been evaluated.
  Do not measure on it.
- **Standardization.** The MLT frame tags 0xD0 and 0xD1 are experimental, not assigned. 3D Tiles is an OGC community standard with Cesium, deck.gl, iTowns,
  QGIS and others reading it.

## What is not size but may matter

- **Files.** The Smart Maps tileset has a median `.pnts` of about 92 KB (of the first 1,000 files its listing returned) and many hierarchical tileset files; Dorayaki is one PMTiles file read with
  Range requests, addressed by z/x/y. Not measured: request counts, time to first picture.
- **Gaussian splats inside 3D Tiles** (glTF with a Gaussian-splat extension): by the attribute list (float32 position 12 B, rotation 16, scale 12,
  opacity 4, color 12 for degree-0 SH), about 56 bytes per splat uncompressed against Dorayaki's 12 for a similar object. This is arithmetic from my reading
  of the extension, not a measurement, and the extension's details and its compressed variants were not checked.
- **Rendering cost** was not compared.

## Not measured or not done

- Draco, meshopt or SPZ-type compression of either layout; the per-point figures above are for gzip and brotli of simple layouts.
- 3D Tiles produced from the Sasebo or Kawazu points by a real tool (py3dtiles or similar): the per-point sizes are a model built from the published
  dataset's encoding.
- Level-of-detail overhead of a point tileset (some builders write coarse levels as extra copies); the table assumes none.
- Any area other than these two; the density dependence is shown by two points on one curve.

## Reproduce

`npm run measure:pnts -- data/nagasaki/2023-lp-01JE3513/01JE3513.las` and `... data/virtual-shizuoka/2019-lp-ground-08OF4060/08OF4060.las 100`
(the files are not in the repository: [sasebo-expansion.md](sasebo-expansion.md), [large-point-clouds.md](large-point-clouds.md)). The `.pnts` headers:
`https://data.source.coop/smartmaps/ngs/<key>` with `Range: bytes=0-4095`.
