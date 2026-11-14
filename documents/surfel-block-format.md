# Surfel Block format (experimental, version 4)

Status: implemented in `src/surfel-block.ts`. This is an experimental
layout for the Dorayaki proof of concept, not a specification. It may
change without backward compatibility; any such change will be stated
explicitly and will bump `version`. Version numbers are expected to rise
freely while the format is explored.

Version 4 changes what a record holds. Versions 1–3 stored a circular disc
(position, normal, radius) in 32 bytes. Version 4 stores an anisotropic
Gaussian splat, as 3D Gaussian Splatting does: position, three scales, a
rotation and a colour, quantized into 16 bytes.

## Byte order

All multi-byte fields are **little-endian**.

## Overall layout

```
offset      size          content
0           32            header
32          4 * L         level table (L = level_count)
32 + 4L     16 * count    splat records, Array of Structures
```

The total byte length must be exactly `32 + 4·L + 16·count`. Shorter input
is rejected as truncated; longer input is rejected as having trailing
bytes.

## Header (32 bytes)

| offset | size | type      | field        | value                                   |
| -----: | ---: | --------- | ------------ | --------------------------------------- |
|      0 |    4 | uint8[4]  | magic        | ASCII `DSRF` (`44 53 52 46`)            |
|      4 |    2 | uint16 LE | version      | `4`                                     |
|      6 |    2 | uint16 LE | record_bytes | `16`                                    |
|      8 |    4 | uint32 LE | count        | number of splat records                 |
|     12 |    4 | uint32 LE | level_count  | L, in `1..64`                           |
|     16 |    8 | float64 LE | z_origin    | metres: z of grid step 0                |
|     24 |    8 | float64 LE | z_step      | metres per z grid step, finite and > 0  |

`record_bytes` is redundant with `version`; the decoder requires it to
equal 16. It exists so a reader can report a record-size mismatch
distinctly from an unknown version.

## Level table (4 · L bytes)

L `uint32 LE` values: the number of records in each level, in stored
order. They must sum to `count`; levels may be empty. Records of level 0
come first, then level 1, and so on.

- A block with one level (`L = 1`, the value equal to `count`) is an
  ordinary block. All synthetic fixtures and tiles below maxzoom use it.
- In maxzoom tiles, producers may store the finest splats in nested
  refinement order (`src/progressive.ts`, `documents/progressive-maxzoom.md`).
  Then each prefix of whole levels covers every occupied cell of its
  finest level.
- Using the table is optional. A reader may ignore it and draw every
  record. That is correct, only slower.

`L` is capped at 64 so that a reader never allocates a large table from
untrusted input. This is a local limit, not a structural need.

## Splat record (16 bytes)

Offsets are relative to the start of the record.

| offset | size | type      | field    | meaning                                                  |
| -----: | ---: | --------- | -------- | -------------------------------------------------------- |
|      0 |    2 | uint16 LE | x        | tile-local x = `x / 65536`, in `[0, 1)`                  |
|      2 |    2 | uint16 LE | y        | tile-local y = `y / 65536`, in `[0, 1)`                  |
|      4 |    2 | uint16 LE | z        | `z_origin + z · z_step` metres                           |
|      6 |    1 | uint8     | sx       | scale code of local axis 0                               |
|      7 |    1 | uint8     | sy       | scale code of local axis 1                               |
|      8 |    1 | uint8     | sz       | scale code of local axis 2                               |
|      9 |    3 | uint24 LE | rotation | packed unit quaternion                                   |
|     12 |    1 | uint8     | r        | colour                                                   |
|     13 |    1 | uint8     | g        |                                                          |
|     14 |    1 | uint8     | b        |                                                          |
|     15 |    1 | uint8     | a        | opacity                                                  |

### Quantization

- **x, y**: `round(x · 65536)`, clamped to 65,535. Resolution is
  `W / 65536` of the tile width `W`: 1.7 mm at zoom 18, 0.4 mm at zoom 20.
- **z**: `z_origin` is the lowest z in the block. `z_step` is 1 mm, or the
  smallest whole number of millimetres for which the block's z range fits
  in 65,535 steps (a block taller than 65.5 m gets a coarser step). The
  decoder returns `float32(z_origin + z · z_step)`.
- **Scales** are standard deviations in metres along the three local axes.
  Code `b` means `2^(-16 + b / 10)` metres: a logarithmic grid of 10 steps
  per octave (about 7 % apart) from 15 µm to 724 m. The encoder clamps to
  that range. The error is at most half a step: 3.6 %.
- **Rotation** is the unit quaternion (w, x, y, z) that rotates the local
  axes into the tile's metric frame (east, south, up), in "smallest three"
  form. Bits 0–1 give the index of the largest component, which is not
  stored and is rebuilt as `sqrt(1 − sum of squares)`; q and −q are the same
  rotation, so it is taken non-negative. Bits 2–8, 9–15 and 16–22 give the
  other three components in w, x, y, z order, each as a code `c` in
  `0..126` meaning `(c − 63) / 63 · (1/√2)`. Code 63 is exactly 0, so the
  identity and every axis-aligned rotation are exact. Bit 23 is reserved
  and must be 0; code 127 is unused and rejected. The encoder tries the
  two nearest codes for each component (8 combinations) and keeps the one
  whose rebuilt quaternion is closest, because the rebuilt component's
  error can be several times the others'. Measured error (random
  rotations): mean 0.7°, worst 1.2°.
- **Colour** is RGB plus opacity, 8 bits each.

Decoding therefore returns values within these tolerances, not the exact
input.

## Meaning of a splat

A splat is the 2-sigma ellipse in the plane of its two longer axes, with
semi-axes `2·s_a` and `2·s_b` (metres). Its normal is the shortest axis. A
flat disc of radius `r` is a splat with in-plane scales `r / 2` and a
thinner third scale; `surfelToSplat` in `src/splat.ts` builds that for
fixtures.

Equal scales (within the 7 % grid) mean no preferred orientation: a round
blob, such as an isotropic Gaussian from a point-cloud fit. A renderer
should draw it facing the camera rather than along an arbitrary axis.

The sign of an axis carries no meaning (an axis is a line), except that a
disc's normal sign is what fixtures use for up- versus down-facing
surfaces; a renderer that must tell the two apart would need to treat that
separately. This is an open point, not a decision.

## Validation rules

Encoder: every coordinate, scale and quaternion component is finite;
x and y are in `[0, 1)`; scales are `> 0`; the quaternion is non-zero;
colour channels are integers in `0..255`; the level table has 1 to 64
entries summing to `count`.

Decoder: version 4, `record_bytes` 16, `level_count` in `1..64`, finite
`z_origin`, finite positive `z_step`, exact total length, a level table
that sums to `count`, reserved rotation bit 0, no code 127. Any violation
throws `SurfelBlockError`; the decoder never reads outside its input.

## Coordinate frame

| field | unit and meaning |
| --- | --- |
| `x` | tile-local, `0` = west edge of the tile, `1` = east edge (exclusive) |
| `y` | tile-local, `0` = north edge of the tile, `1` = south edge (exclusive) |
| `z` | orthometric height (標高): metres above the geoid, up |
| scales | metres |
| rotation | local axes to the local metric frame: east, south, up |

- `x` and `y` follow the MLT / MVT tile convention (x right, y down). Unlike
  versions 1–3, they must lie in `[0, 1)`: a record has no room for values
  outside the tile. The centre-ownership rule below is therefore part of
  the format's requirements, not only a producer convention. A splat's
  extent may still reach into neighbouring tiles.
- The tile address (`z/x/y`) is not stored in the block. As in MLT, it is
  known from outside the tile.
- The local metric frame converts tile-local `x, y` to metres with the
  tile's width in metres, `W`. Dorayaki computes `W` at the tile's centre
  latitude on the spherical Web Mercator Earth (radius 6,378,137 m):
  `W = 2π · 6378137 · cos(lat_centre) / 2^zoom`. Within one tile this
  ignores the change of Mercator scale with latitude. At zoom 16 and above
  the error is under 0.01 % (see NOTES.md).
- `z` is the height above the geoid (orthometric height, 標高), not an
  ellipsoidal height and not a height above local ground. Data that
  already carries elevations, such as Japanese survey point clouds in
  JGD2011 with heights referred to Tokyo Bay mean sea level, goes in
  unchanged. Synthetic fixtures put their ground at `z = 0`, which means
  sea level.

## Tile ownership

Dorayaki producers (`src/tiling.ts`) assign each splat to the one tile
that contains its centre, using half-open intervals: tile-local x and y in
`[0, 1)`. A centre exactly on a seam therefore goes to the east or south
tile. Splats may extend into neighbouring tiles. They are neither
duplicated nor clipped at tile edges. Geometry spanning several tiles is
sampled once on a grid that is continuous across seams, then split.

## Compatibility

**Version 4** (2026-11-15) replaces the 32-byte disc record with the
16-byte splat record and widens the header to 32 bytes (z origin and
step). Versions 1–3 are rejected (`UNSUPPORTED_VERSION`). This is an
intentional breaking change. Fixtures and test vectors were regenerated.
A v3 block can be converted by reading its discs and re-encoding them
with `surfelToSplat`, within the quantization tolerances above.

**Version 3** (2026-11-13) added `level_count` and the level table; the
record was unchanged. **Version 2** defined the coordinate frame (metric z
and radius) over the v1 layout. Version 1 was the first 12-byte-header,
32-byte-record layout. The vertical datum (orthometric height) was
defined on 2026-11-12 without a version change, because v2 had left it
undefined and no published data relied on another datum.

## Not yet defined

- Which geoid model a producer uses, and its accuracy, are not recorded
  in the block.
- How a renderer should shade a splat whose axis sign is arbitrary.

## Deferred (proposed, not implemented)

- Structure-of-arrays layout, Morton ordering within a level, and delta
  coding, followed by general-purpose compression. The next candidate for
  size (EXPERIMENTS.md E004 measures the v4 sizes first).
- Spare bits carrying rendering intent, as in the `gint` project
  (github.com/kenjiyoshidahome2026-bit/gint). That would interact with the
  rule against a second mandatory LOD mechanism in AGENTS.md.
- Spherical harmonics beyond the degree-0 colour, source-point storage and
  per-splat covariance beyond scales and a rotation.
