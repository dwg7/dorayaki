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

So tiles of the size of the question "10 MB per tile" occur at 25 cm where
there is vertical structure. Moving the constant 512 up or down moves the
resolution at a given zoom and the tile size together.

## Bytes per square metre, and a prefecture

Kawazu 08OF4060: the mesh's bounding box is 113,572 m2 (MMS header).

| set | all tiles | bytes per m2 of the box |
| --- | ---: | ---: |
| uniform 49 cm (z16 + z17) | 6.33 MB | 55.7 |
| adaptive, 24.5 cm base, 20 cm / 0.2 | 6.22 MB | 54.8 |
| uniform 24.5 cm (z16 to z18) | 26.05 MB | 229 |

Shizuoka Prefecture is about 7,800 km2 (7.8e9 m2). Multiplying (this assumes
the whole prefecture looks like this mesh, which it does not):

| resolution | estimate for the prefecture |
| --- | ---: |
| 49 cm uniform | about 0.43 TB |
| 49 cm adaptive | about 0.43 TB (this scene saves little at equal count; see below) |
| 24.5 cm uniform | about 1.8 TB |

A bound that needs no scene: a fully occupied single layer at 49 cm is
4.16 cells/m2 x 16 B = 66.5 B/m2, 88.7 B/m2 with the pyramid (z16 and above add
1/4 + 1/16 + ... = 1/3), so about 0.69 TB for the prefecture. At 24.5 cm the same
bound is four times that, about 2.8 TB. Buildings, forest and bridges add
layers; empty ground (sea, bare mountain) costs little.

Reading, not a decision: a prefecture within 1 TB is plausible at 49 cm and
out of reach at 24.5 cm. Whether the real prefecture lands near 0.4 or
above 1 TB depends on how many surfaces there are per column; this has not
been measured outside Kawazu.

Where the savings can come from: adaptive merging (E005) cuts splats where
the surface is flat (up to about half at a loose limit, 11 to 20 % at a strict
one on this scene); an archive that stores a mesh's tiles contiguously and
gzips them (PMTiles internal compression is on for directories only;
compressing tiles is untried); structure-of-arrays and delta coding (deferred).
None of these is measured for tiles yet.

## Browser memory, and tiles of 10 MB

PMTiles reads one tile with one range request, so 10 MB tiles are not
practical to stream over the internet but are fine from a local file or a
fast network. What limits the browser is memory and CPU, not the network:

- Decode time measured with the pane visible: 389,000 splats decoded in 90 ms
  (about 0.23 us each), uploaded in 84 ms; fetching the 6 MB set from the
  local server took 131 ms. A 700,000-splat tile is therefore a fraction of a
  second to decode. (The first load of the same page measured while the pane
  was hidden took 669 ms to decode; see NOTES.md.)
- GPU memory per splat is currently 56 bytes (position, two axes and a normal
  as float32, a flag and a colour), so a 700,000-splat tile is about 39 MB and
  ten of them about 390 MB. The wire record is 16 bytes. Uploading the 16-byte
  records and decoding in the vertex shader would cut this by 3.5 times; that
  is proposed, not implemented.
- The demo fetches and uploads every tile of a tileset when the page opens.
  Loading only the tiles in view is not implemented and is required before a
  prefecture-sized archive can be used.
