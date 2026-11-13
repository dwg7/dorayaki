# Experimental MLT frame for a Surfel Block

Status: implemented in `src/mlt-frame.ts`. This is an experiment, not an
MLT extension, and the tag below is **not an assigned MLT value**.

## Upstream framing (not changed)

According to the MapLibre Tile specification (`maplibre-tile-spec`,
`docs/overview.md` "Frames" and `docs/specification/v1.md` "Tile Layout",
as read on 2026-11-12), a tile is a concatenation of frames with no tile
header:

```
tile   := frame*
frame  := [varint size] [u8 tag] [u8 body[size - 1]]
```

- `size` counts the tag byte plus the body.
- A decoder must skip a frame whose tag it does not recognise, using
  `size`.
- Upstream assigns tag `0x01` (MLT v1) and `0x02` (MLT v2). It defines no
  experimental or private-use range.

Dorayaki does not modify upstream MLT code and does not parse v1/v2
layers. To this wrapper, a `0x01` or `0x02` frame is just another frame
to skip.

## Dorayaki surfel frame

```
offset  size     content
0       1..5     size: unsigned LEB128 varint = 1 + block_length
k       1        tag: 0xD0 (EXPERIMENTAL, unassigned)
k+1     block    Surfel Block bytes, unchanged (documents/surfel-block-format.md)
```

`k` is the byte length of the size varint. The body is the Surfel Block
byte-for-byte; the frame adds no header or padding of its own.

Examples:

- empty Surfel Block (v3, 20 bytes): `15 d0 44535246 0300 2000 00000000 01000000 00000000`
- `bridge` fixture on a 128 m tile (v3, 13,844 bytes): `95 6c d0 ...` (size 13,845)

### Tag `0xD0`

`0xD0` was chosen arbitrarily for this proof of concept. It is not
reserved or assigned by MLT, and a future upstream assignment could
collide with it. If some other format used `0xD0`, the Surfel Block
decoder would most likely reject its body at the `DSRF` magic check, but
that is not a guarantee.

## Decoder rules (`readFrames`)

- Every frame in the tile is validated, including frames after the
  surfel frame.
- `size` is an unsigned LEB128 varint. Dorayaki limits it to uint32
  (at most 5 bytes). This is a local implementation limit, not an MLT
  rule.
- Errors (`MltFrameError.code`):
  - `TRUNCATED_VARINT`: the input ends inside a size varint;
  - `VARINT_OVERFLOW`: the varint exceeds uint32 or is longer than 5 bytes;
  - `ZERO_FRAME_SIZE`: `size` is 0, so there is no tag byte;
  - `FRAME_OVERFLOW`: `size` exceeds the bytes remaining in the tile.
- Frame bodies are returned as views into the input, not copies.
- `extractSurfelBlocks` returns every `0xD0` body in tile order. What
  more than one surfel frame per tile means is not defined.

## Separation

`src/mlt-frame.ts` imports nothing from `src/surfel-block.ts`; it treats
bodies as opaque bytes. Callers compose the two:
`decodeSurfelBlock(extractSurfelBlocks(tile)[0])`.
