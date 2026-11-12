# Naive Surfel Block format (experimental, version 2)

Status: implemented in `src/surfel-block.ts`. This is an experimental
layout for the Dorayaki proof of concept, not a specification. It may
change without backward compatibility; any such change will be stated
explicitly and will bump `version`.

## Byte order

All multi-byte fields are **little-endian**. Floats are IEEE 754
binary32 (float32).

## Overall layout

```
offset  size          content
0       12            header
12      32 * count    surfel records, Array of Structures
```

The total byte length must be exactly `12 + 32 * count`. Shorter input is
rejected as truncated; longer input is rejected as having trailing bytes.

## Header (12 bytes)

| offset | size | type      | field         | value                           |
| -----: | ---: | --------- | ------------- | ------------------------------- |
|      0 |    4 | uint8[4]  | magic         | ASCII `DSRF` (`44 53 52 46`)    |
|      4 |    2 | uint16 LE | version       | `2`                             |
|      6 |    2 | uint16 LE | record_bytes  | `32`                            |
|      8 |    4 | uint32 LE | count         | number of surfel records        |

`record_bytes` is redundant with `version` in version 2; the decoder
requires it to equal 32. It exists so a reader can report a record-size
mismatch distinctly from an unknown version.

## Surfel record (32 bytes)

Offsets are relative to the start of the record. Because the header is
12 bytes, every record and every float32 field is 4-byte aligned.

| offset | size | type       | field  |
| -----: | ---: | ---------- | ------ |
|      0 |    4 | float32 LE | x      |
|      4 |    4 | float32 LE | y      |
|      8 |    4 | float32 LE | z      |
|     12 |    4 | float32 LE | nx     |
|     16 |    4 | float32 LE | ny     |
|     20 |    4 | float32 LE | nz     |
|     24 |    4 | float32 LE | radius |
|     28 |    1 | uint8      | r      |
|     29 |    1 | uint8      | g      |
|     30 |    1 | uint8      | b      |
|     31 |    1 | uint8      | a      |

## Validation rules (encoder and decoder)

- All seven float fields must be finite (no NaN or ±Infinity).
- `radius` must be `>= 0`.
- Colour channels must be integers in `0..255` (always true when decoding).

Not validated: normal length (unit length is expected but not enforced)
and coordinate ranges.

## Coordinate frame (version 2)

| field | unit and meaning |
| --- | --- |
| `x` | tile-local, `0` = west edge of the tile, `1` = east edge |
| `y` | tile-local, `0` = north edge of the tile, `1` = south edge |
| `z` | orthometric height (標高): metres above the geoid, up |
| `nx, ny, nz` | unit normal in the local metric frame: east, south, up |
| `radius` | metres |

- `x` and `y` follow the MLT / MVT tile convention (x right, y down).
  Values outside `[0, 1]` are allowed. They describe geometry that
  crosses the tile edge.
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

Normals and radius are metric so that a disc's shape and size do not
depend on the zoom level of the tile that carries it.

## Tile ownership (producer convention)

Dorayaki producers (`src/tiling.ts`) assign each surfel to the one tile
that contains its centre, using half-open intervals: tile-local x and y
in `[0, 1)`. A centre exactly on a seam therefore goes to the east or
south tile. Discs may extend into neighbouring tiles. Surfels are neither
duplicated nor clipped at tile edges. Geometry spanning several tiles is
sampled once on a grid that is continuous across seams, then split.

The decoder does not enforce this convention. Version 2 still accepts
x, y outside `[0, 1]`, so this is not a format change.

## Compatibility

Version 2 has the same byte layout as version 1. It only defines the
units above, which version 1 left undefined. Version 1 blocks are
rejected (`UNSUPPORTED_VERSION`) rather than reinterpreted. This is an
intentional breaking change. All fixtures and test vectors were
regenerated.

## Vertical datum: compatibility

Defining `z` as orthometric height (2026-11-12) did not change the byte
layout or `version`. Version 2 previously left the datum undefined, and no
published data relied on a different datum. The only real-data tiles,
the locally generated Numazu demo tiles, are regenerated with absolute
elevations. Version 2 blocks are therefore read with this definition.

## Not yet defined

- Which geoid model a producer uses, and its accuracy, are not recorded
  in the block.

## Deferred (proposed, not implemented)

Quantized encoding of the record. Raised by the repository owner on
2026-11-12. It is deferred because no fixture or dataset has shown a
size or bandwidth problem yet (see AGENTS.md on optimization). The
rationale is that surfels are a coarse approximation, so carrying their
positions at float32 precision is out of proportion.

Directions considered, to revisit when evidence calls for it:

- `z` as integer millimetres, possibly relative to a per-block offset.
  float32 metres already resolves under 1 mm up to about 8 km, so the
  gain would be bytes and uniform precision, not accuracy.
- `x, y` as integers on a per-block tile grid, as MLT uses `extent`.
  At zoom 18 a tile is about 150 m wide at most, so 1 mm needs about
  18 bits per axis, whereas float32 near 1.0 resolves about 0.01 mm.
- `radius` with relative rather than absolute precision (for example
  float16 or a logarithmic code). A radius is bounded by the tile size in
  practice, and a fraction-of-a-percent error is invisible in a splat.
- Normal as an octahedral 2 × 16-bit code instead of 3 × float32.
- Spare low bits carrying rendering intent, as in the `gint` project
  (github.com/kenjiyoshidahome2026-bit/gint). It packs Morton-ordered
  integer coordinates and a 6-bit visibility rank into 64 bits. This
  would interact with the "no second LOD mechanism" rule in AGENTS.md.
