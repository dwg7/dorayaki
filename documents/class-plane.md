# Class plane (experimental, version 1)

Status: implemented in `src/class-plane.ts` and `src/mlt-frame.ts`; written by the tileset builder
(`DORAYAKI_CLASS_PLANE=1`), read by the demo. An experiment, not a specification, and the frame tag is **not an assigned MLT value**.

A class plane gives every splat of a tile's Surfel Block one class code. It is a separate frame beside the block, so a reader that
does not know it skips it, and the block, whatever its version (5 or 6), is unchanged. Why a separate plane and not bits in the
record: E020 and E021 in EXPERIMENTS.md (about 1 % of the archive, against 2 to 8 % stored plainly or picture quality inside the
version 6 record).

## In the tile

```
tile := frame*
frame := [varint size] [u8 tag] [body]     (documents/mlt-frame.md)
```

The builder writes: an unknown demo frame (tag 0x7E), the surfel frame (0xD0), then the class plane frame (**0xD1**, experimental).
A reader finds the plane with `extractClassPlanes(tile)`; the order of frames does not matter.

## Body of the class plane frame

```
offset  size  content
0       4     magic "DCLS"
4       1     version = 1
5       1     compression: 0 none, 1 gzip
6       2     reserved, zero
8       4     count: uint32, the number of splats (must equal the block's count)
12      ...   payload: count class codes, one byte each, in the block's stored order;
              with compression 1, the gzip of those bytes
```

Little-endian. Errors a reader must report (`ClassPlaneError`): `TRUNCATED_HEADER`, `BAD_MAGIC`, `UNSUPPORTED_VERSION`,
`BAD_COMPRESSION` (a value other than 0 or 1, or a compressed plane with no inflate function), `LENGTH_MISMATCH` (uncompressed
payload not `count` bytes, or the decompressed bytes not `count`). A plane whose count differs from the block's is ignored by the demo.

The browser inflates a gzip payload natively (`DecompressionStream("gzip")`), so the plane can be compressed although stars' Martin
cannot serve gzip-compressed tiles (the frame is opaque bytes to it). The demo inflates a tile's plane only when a class feature is
used (hide vegetation, colour by class).

## Class codes

The ASPRS LAS classification codes, plus codes from 64 up that a build defines:

| code | meaning |
| ---: | --- |
| 0 | never classified |
| 1 | unclassified |
| 2 | ground |
| 3, 4, 5 | low, medium, high vegetation |
| 6 | building |
| 9 | water |
| 64 | **Dorayaki build rule**: an unclassified airborne point on a pulse with several returns (it reached through foliage), taken as vegetation |

The vegetation codes are 3, 4, 5 and 64 (`VEGETATION_CLASSES`). The airborne files of the Virtual Shizuoka 2019 data have only
classes 1 and 2, so their canopy is the rule behind 64; the MMS files carry 2 to 5.

A splat's class is the class most of its points have (the Gaussian of a voxel, or of merged voxels); purity is not stored.
E020 in EXPERIMENTS.md measured how mixed merged splats are (the share of splats whose dominant class holds 90 % of their points:
76.9 % at z17, 63.0 % at z16, 47.4 % at z15).

## Building

```sh
DORAYAKI_CLASS_PLANE=1 DORAYAKI_BLOCK_VERSION=6 npm run build:tileset -- <mms.las>,<lp.las> 8 <name> 17 16 15
npm run merge:tilesets -- <name> <dir> ...      # joins the planes of the tiles it merges
```

The builder counts the points of every voxel by LAS class (18 slots: LAS 0 to 15; 16 = the several-returns rule; 17 = any other class,
stored as 1), sums them exactly when voxels merge, and carries the dominant slot through the pipeline in the splat's opacity byte
(slot / 255), then moves it into the plane when the tile is written; the block's opacity is the usual 0.95. Voxel memory grows by
18 doubles per voxel (about 0.7 GB peak for a mesh against 0.3 GB).

## In the demo

- `hide vegetation` (checkbox, `?hideveg=1`) hides the codes 3, 4, 5, 64; `?hide=3,4,...` hides the listed codes.
- `colour: by class` (select, `?colour=class`) draws the splats in the palette of `demo/src/class-palette.ts`, vivid and close to the usual
  LAS palettes (ground orange, low vegetation lime, medium vegetation green, high vegetation dark green, canopy teal, building red, water
  blue, bridge purple, unknown magenta), with a legend of the classes in view and their shares.
- A tile without a plane uses the guess of `demo/src/vegetation.ts` (E019): code 64 for a guessed vegetation splat, 1 for the rest.
- On the GPU the class is an instanced `u8` attribute (`a_class`, one byte per splat, uploaded when the plane is inflated); the vertex shader
  skips hidden classes by a 128-bit mask (`u_hide_mask`) and looks the colour up in a 32-slot palette (`u_palette`).

## Not decided

The plane is optional per tile. Where to host a ground-only or classed variant, finer classes for the airborne data (a building
or water class would need a different source than the LAS class), and per-splat purity are open.
