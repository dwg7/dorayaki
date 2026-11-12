# Naive Surfel Block format (experimental, version 1)

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
|      4 |    2 | uint16 LE | version       | `1`                             |
|      6 |    2 | uint16 LE | record_bytes  | `32`                            |
|      8 |    4 | uint32 LE | count         | number of surfel records        |

`record_bytes` is redundant with `version` in version 1; the decoder
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

## Not yet defined

- The coordinate frame and units of `x, y, z` and `radius`. The codec
  does not interpret them. The `plane` fixture uses an abstract unit
  square (see `src/fixtures/plane.ts`); the mapping to tile and
  geographic coordinates is deferred to the rendering step.
- Embedding in a MapLibre Tile frame.
