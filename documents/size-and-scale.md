# Size and scale: what a tile and a prefecture cost

Status: arithmetic from measurements. The Kawazu figures are measured; the
prefecture figures are extrapolations from one mountain-road mesh and say so.

## What bounds a tile

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

## Bytes per square metre, and a prefecture

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

## Widened to nine meshes (E009)

On 3 x 3 meshes (1.08 km2, 476 million points) with the same recipe: 220.0 MB
(204 B/m2) when the sparse threshold is the same at every zoom, 132.0 MB
(122 B/m2) when it is multiplied by 4 per zoom step, and **111.0 MB (103 B/m2)**
when it is multiplied by 10 (E011; the hosted archive). The size follows the area
(10 to 14 MB per mesh); the largest tile is 7.2 MB (z17), 2.65 MB (z16 with factor 10).
As a scale for the prefecture, extrapolated from this one valley: about 0.95 TB at
122 B/m2, about 0.8 TB at 103 B/m2; 0.71 TB for z17 alone (z17 is the same in both).
Loading all 46 tiles of the factor-4 build (8.25 million splats) at once took 0.8 s
to fetch, 3.2 s to decode and 2.1 s to upload on an Apple M1; it was not repeated for
the factor-10 build.

## Browser memory, and tiles of 10 MB

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
  float32, a flag and a colour; 39 MB and 390 MB); that path is still there as
  `?gpu=legacy`. Not measured: the GPU's own memory use (the sizes are the buffers'
  byte lengths).
- The demo used to fetch and upload every tile of a tileset when the page opened.
  It now loads only the tiles in view (the nearest nine of the selected zoom,
  documents/demo-and-site.md); a prefecture-sized archive additionally needs a
  tile list that is not enumerated from the TileJSON bounds (the demo caps that
  list at 64 tiles).
