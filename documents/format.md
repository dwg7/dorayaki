# Format: Surfel Block version 6, the MLT frame and the class plane

Status: implemented in `src/surfel-block.ts`, `src/mlt-frame.ts` and `src/class-plane.ts`. This is an experimental layout
for the Dorayaki proof of concept, **not a specification and not a standard**. The frame tags 0xD0 and 0xD1 are **not
assigned MLT values**. Any change will be stated explicitly and will bump a version number.

Since 2026-11-27 (compaction, documents/decisions.md) only **version 6** is written and read. Versions 1 to 5 (32-byte discs,
then 16-byte quantized splats as whole records or byte planes) are rejected with `UNSUPPORTED_VERSION`; their description is in
Git (tag `pre-compaction-2026-11-27`, `documents/format.md`). Why version 6: E016 in EXPERIMENTS.md.

## Surfel Block

All multi-byte fields are **little-endian**.

```
offset      size          content
0           40            header
40          4 * L         level table (L = level_count)
40 + 4L     12 * count    splat records, whole records in stored order
```

The total length must be exactly `40 + 4·L + 12·count`. Shorter input is rejected as truncated; longer input as having
trailing bytes.

### Header (40 bytes)

| offset | size | type | field | value |
| -----: | ---: | --- | --- | --- |
| 0 | 4 | uint8[4] | magic | ASCII `DSRF` (`44 53 52 46`) |
| 4 | 2 | uint16 | version | `6` |
| 6 | 2 | uint16 | record_bytes | `12` (redundant with `version`; reported apart as a record-size mismatch) |
| 8 | 4 | uint32 | count | number of splat records |
| 12 | 4 | uint32 | level_count | L, in `1..64` |
| 16 | 8 | float64 | z_origin | metres: z of grid step 0 |
| 24 | 8 | float64 | z_step | metres per z grid step, finite and > 0 |
| 32 | 4 | float32 | scale_log2_min | base-2 logarithm of scale code 0, in metres |
| 36 | 1 | uint8 | alpha | the opacity of every splat of the block, `alpha / 255` |
| 37 | 3 | | reserved | written as zero, not checked |

### Level table (4 · L bytes)

L `uint32` values: the number of records in each level, in stored order, summing to `count`. Every builder now writes one
level (`L = 1`, equal to `count`). A reader may ignore the table and draw every record. The demo still draws a prefix of
levels for a block that has several (`demo/src/tile-selection.ts`, from the removed progressive order of version 3); `L` is
capped at 64 so that a reader never allocates a large table from untrusted input.

### Record (12 bytes, 96 bits)

Bit 0 is the least significant bit of byte 0; fields are not aligned to bytes.

| field | bit offset | bits | meaning |
| --- | ---: | ---: | --- |
| x | 0 | 13 | `u / 8192` of the tile, west to east |
| y | 13 | 13 | `u / 8192`, north to south |
| z | 26 | 14 | `z_origin + u · z_step` metres |
| sx, sy, sz | 40, 47, 54 | 7 each | `2^(scale_log2_min + code / 6)` metres, standard deviations along the local axes |
| rotation | 61 | 17 | unit quaternion (w, x, y, z), "smallest three": bits 0-1 the index of the largest component (rebuilt as `sqrt(1 − sum of squares)`, taken non-negative); then three 5-bit codes `c` in `0..30` (15 = exactly 0) meaning `(c − 15) / 15 · (1/√2)`, the other components in w, x, y, z order; code 31 is invalid |
| r, g, b | 78, 84, 90 | 6 each | `round(code · 255 / 63)` |

Encoder choices: `z_step` is at least 1 mm and wide enough for the block's z range in 14 bits; `scale_log2_min` is the
base-2 logarithm of the block's smallest scale (as float32), and scales more than 127/6 = 21.2 octaves above it clamp.
Splats of one block must share one opacity: the encoder rejects anything else.

Tolerances (`test/helpers.ts`): position 1/16384 of the tile, height half a step, scale a factor 2^(1/12) (6 %), rotation
under 16° (a few degrees typically), color about 2 of 255, opacity exact. Measured on Kawazu (E016): about 1.6 of 255 mean
color error against the 16-byte layout in the software renderer, 0.63 in a browser comparison of 25 x 25 block means.

### Meaning of a splat

A splat is the 2-sigma ellipse in the plane of its two longer axes, with semi-axes `2·s_a` and `2·s_b` metres; its normal
is the shortest axis. A flat disc of radius `r` is a splat with in-plane scales `r / 2` and a thinner third scale
(`surfelToSplat` in `src/splat.ts`, used by the fixtures). Nearly equal scales mean no preferred orientation: a renderer
draws such a splat facing the camera (in the demo: largest over smallest scale code difference of at most 3). The sign of an
axis carries no meaning; how to shade a splat whose axis sign is arbitrary is not decided.

### Coordinate frame

| field | unit and meaning |
| --- | --- |
| `x` | tile-local, `0` = west edge, `1` = east edge (exclusive) |
| `y` | tile-local, `0` = north edge, `1` = south edge (exclusive) |
| `z` | orthometric height (標高): metres above the geoid, up |
| scales | metres |
| rotation | local axes to the local metric frame: east, south, up |

- The tile address is not stored in the block; as in MLT, it is known from outside.
- Tile-local `x, y` become metres with the tile width `W = 2π · 6378137 · cos(lat_centre) / 2^zoom` at the tile's centre
  latitude (spherical Web Mercator). At zoom 16 and above the error of ignoring the change of scale within a tile is under
  0.01 % (NOTES.md).
- `z` is not ellipsoidal and not above local ground. Japanese survey point clouds in JGD2011 with heights referred to Tokyo
  Bay mean sea level go in unchanged; synthetic fixtures put their ground at `z = 0`. Which geoid model a producer used is
  not recorded.

### Tile ownership

Producers assign each splat to the one tile that contains its centre, with half-open intervals (`src/tiling.ts` for the
fixtures; the tile frame of `src/geodesy/tile-frame.ts` for `build:tiled`). Splats may extend into neighbouring tiles; they
are neither duplicated nor clipped.

### Validation

Encoder: every coordinate, scale and quaternion component finite; x and y in `[0, 1)`; scales `> 0`; a non-zero quaternion;
color channels integers in `0..255`; one opacity; a level table of 1 to 64 entries summing to `count`.

Decoder: magic, version 6, `record_bytes` 12, `level_count` in `1..64`, finite `z_origin`, finite positive `z_step`, exact
total length, a level table that sums to `count`, no rotation code 31. Any violation throws `SurfelBlockError`; the decoder
never reads outside its input.

### On the GPU

The demo uploads the records as they are (`uvec3`, 12 bytes per instance) and decodes them in the vertex shader
(`demo/src/gpu-surfels.ts`, uniforms `uZOrigin`, `uZStep`, `uScaleBase`). `packedSurfelBlock` returns the header values and
a view of the records for that.

## MLT frame

Status: implemented in `src/mlt-frame.ts`. An experiment, not an MLT extension.

The MapLibre Tile specification (`maplibre-tile-spec`, `docs/overview.md` "Frames" and `docs/specification/v1.md` "Tile
Layout", read on 2026-11-12) makes a tile a concatenation of frames with no tile header:

```
tile   := frame*
frame  := [varint size] [u8 tag] [u8 body[size - 1]]
```

`size` counts the tag byte plus the body; a decoder must skip a frame whose tag it does not recognise. Upstream assigns
`0x01` (MLT v1) and `0x02` (MLT v2) and defines no private-use range. Dorayaki does not modify upstream MLT code and does
not parse v1/v2 layers: to this wrapper they are frames to skip.

### Surfel frame, tag 0xD0

```
offset  size     content
0       1..5     size: unsigned LEB128 varint = 1 + block_length
k       1        tag: 0xD0 (EXPERIMENTAL, unassigned)
k+1     block    Surfel Block bytes, unchanged
```

The frame adds no header or padding. Examples (`test/mlt-frame.test.ts`): an empty block (44 bytes) gives `2d d0 ...`;
the `bridge` fixture on a 128 m tile (5,228 bytes) gives `ed 28 d0 ...`. `0xD0` was chosen arbitrarily; a future upstream
assignment could collide with it.

### Decoder rules (`readFrames`)

- Every frame of the tile is validated, including frames after the surfel frame.
- `size` is limited to uint32 (at most 5 bytes): a local limit, not an MLT rule.
- Errors (`MltFrameError.code`): `TRUNCATED_VARINT`, `VARINT_OVERFLOW`, `ZERO_FRAME_SIZE` (no tag byte), `FRAME_OVERFLOW`
  (`size` beyond the remaining bytes).
- Bodies are views into the input. `extractSurfelBlocks` returns every 0xD0 body in tile order; what more than one per tile
  means is not defined.
- `src/mlt-frame.ts` imports nothing from `src/surfel-block.ts`: `decodeSurfelBlock(extractSurfelBlocks(tile)[0])`.

## Class plane, tag 0xD1 (version 1)

Status: implemented in `src/class-plane.ts`, `src/mlt-frame.ts` and `src/pointcloud/class-slots.ts`; written by
`build:tiled` with `DORAYAKI_CLASS_PLANE=1`, read by the demo. Why a separate plane and not bits in the record: E020 and E021
(about 1 % of the archive, against 2 to 8 % stored plainly, or picture quality inside the record). Reviewed on 2026-11-17
(ten findings, all addressed; in Git with `documents/format.md`).

A class plane gives every splat of a block one class code, in a frame beside the block, so a reader that does not know it
skips it. A tile may have no plane; with several, a reader uses the first. The order of frames does not matter.

```
offset  size  content
0       4     magic "DCLS"
4       1     version = 1
5       1     compression: 0 none, 1 gzip
6       2     reserved: written as zero, ignored
8       4     count: uint32, must equal the block's count
12      ...   count class codes, one byte each, in the block's stored order; with compression 1, their gzip
```

Errors (`ClassPlaneError`): `TRUNCATED_HEADER`, `BAD_MAGIC`, `UNSUPPORTED_VERSION`, `BAD_COMPRESSION` (also a compressed
plane and no inflate function), `LENGTH_MISMATCH`, `INVALID_CODE` (128 or more; refused by the encoder too). **A reader
inflates at most `count` bytes**, because a small gzip payload can expand without bound; the demo also ignores a plane whose
count differs from the block's. The browser inflates natively (`DecompressionStream("gzip")`): 305 ms for 785,133 splats on
an Apple M1 (E021), only when a class feature is used.

Class codes 0 to 127 are the ASPRS LAS codes plus build-defined codes from 64; 128 to 255 are reserved.

| code | meaning |
| ---: | --- |
| 0 | never classified |
| 1 | unclassified |
| 2 | ground |
| 3, 4, 5 | low, medium, high vegetation |
| 6 | building |
| 9 | water |
| 64 | Dorayaki build rule: an unclassified airborne point on a pulse with several returns, taken as vegetation |

A splat's class is the class most of its points have (lowest code on a tie); purity is not stored (E020: 76.9 % of z17
splats have a class holding 90 % of their points, 47.4 % at z15). The builder counts points per voxel in 18 slots (LAS 0 to
15; 16 = the several-returns rule, written as 64; 17 = LAS 16 and up, written as 1), carries the dominant slot through the
merge in the opacity byte and moves it into the plane when the tile is written. `DORAYAKI_CLASS_PLANE=1` needs
`DORAYAKI_ADAPTIVE_LEVELS` (which `build:tiled` requires anyway). In the demo: `?hideveg=1`, `?hide=3,4,...`, `?color=class`
(palette in `demo/src/class-palette.ts`); a tile without a plane gets the guess of `demo/src/vegetation.ts` (E019) while a
class feature is on.

## Not decided

- Which geoid model a producer uses, and recording it.
- How to shade a splat whose axis sign is arbitrary.
- What more than one surfel frame per tile means.
- Where to host a ground-only or classed variant; finer classes for airborne data; per-splat purity.
- Spare bits carrying rendering intent, spherical harmonics beyond degree 0, source points: deferred (AGENTS.md).
