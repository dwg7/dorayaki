# Class plane (experimental, version 1)

Status: implemented in `src/class-plane.ts`, `src/mlt-frame.ts` and `src/pointcloud/class-slots.ts`; written by the tileset builder
(`DORAYAKI_CLASS_PLANE=1`), read by the demo. An experiment, not a specification, and the frame tag is **not an assigned MLT value**.
Reviewed on 2026-11-17 (see "Review"); the rules below include what the review changed.

A class plane gives every splat of a tile's Surfel Block one class code. It is a separate frame beside the block, so a reader that
does not know it skips it, and the block, whatever its version (5 or 6), is unchanged. Why a separate plane and not bits in the
record: E020 and E021 in EXPERIMENTS.md (about 1 % of the archive, against 2 to 8 % stored plainly, or picture quality inside the
version 6 record).

## In the tile

```
tile := frame*
frame := [varint size] [u8 tag] [body]     (documents/mlt-frame.md)
```

The tileset builder writes: an unknown demo frame (tag 0x7E, `encodeDemoTile`), the surfel frame (0xD0), then the class plane
frame (**0xD1**, experimental). A reader finds planes with `extractClassPlanes(tile)`; the order of frames does not matter.
A tile may have no plane (the plane is optional). If a tile has more than one plane frame a reader uses the first and ignores the rest.

## Body of the class plane frame

```
offset  size  content
0       4     magic "DCLS"
4       1     version = 1
5       1     compression: 0 none, 1 gzip
6       2     reserved: written as zero, ignored by readers
8       4     count: uint32, the number of splats (must equal the block's count)
12      ...   payload: count class codes, one byte each, in the block's stored order;
              with compression 1, the gzip of those bytes
```

Little-endian. The order of the codes is the stored order of the block's records (for a block with a level table, the stored order of
all levels, level 0 first), not an order of positions.

Errors a reader must report (`ClassPlaneError`):

| code | when |
| --- | --- |
| `TRUNCATED_HEADER` | fewer than 12 bytes |
| `BAD_MAGIC` | the first four bytes are not "DCLS" |
| `UNSUPPORTED_VERSION` | version other than 1 |
| `BAD_COMPRESSION` | compression other than 0 or 1; or a compressed plane and no inflate function |
| `LENGTH_MISMATCH` | uncompressed payload not `count` bytes; or the decompressed bytes not `count` |
| `INVALID_CODE` | a class code of 128 or more (also refused by the encoder) |

**A reader inflates at most `count` bytes** (`decodeClassPlane` hands `count` to the inflate function as the most it may produce; the demo
reads the stream in pieces and stops when it would exceed that; Node uses `gunzipSync(..., { maxOutputLength })`), because a small gzip
payload can expand without bound. The demo also requires `count` to equal the block's count before it keeps a plane, so `count` is
bounded by the block. A plane whose count differs from the block's is ignored.

The browser inflates a gzip payload natively (`DecompressionStream("gzip")`), so the plane can be compressed although stars' Martin
cannot serve gzip-compressed tiles (the frame is opaque bytes to it). The demo inflates a tile's plane only when a class feature is
used (hide vegetation, color by class): 305 ms for 785,133 splats in a browser on an Apple M1 (E021).

## Class codes (0 to 127)

The ASPRS LAS classification codes, plus codes from 64 up that a build defines. **Codes 128 to 255 are reserved**: the encoder refuses
them and the decoder rejects a plane that has one (they could not be hidden or given a color: the demo's hide mask has 128 bits and its
palette one entry per code).

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

A splat's class is the class most of its points have (the Gaussian of a voxel, or of merged voxels; the lowest class number on a tie);
purity is not stored. E020 measured how mixed merged splats are (the share of splats whose dominant class holds 90 % of their points:
76.9 % at z17, 63.0 % at z16, 47.4 % at z15).

## Building

```sh
DORAYAKI_ADAPTIVE_LEVELS=3 ... DORAYAKI_CLASS_PLANE=1 DORAYAKI_BLOCK_VERSION=6 \
  npm run build:tileset -- <mms.las>,<lp.las> 8 <name> 17 16 15
npm run merge:tilesets -- <name> <dir> ...      # joins the planes of the tiles it merges
```

- `DORAYAKI_CLASS_PLANE=1` needs `DORAYAKI_ADAPTIVE_LEVELS`: the class travels through the adaptive merge; the builder stops with an error
  otherwise (without it every splat would keep the default opacity and the plane would hold nonsense).
- The builder counts the points of every voxel by slot (`src/pointcloud/class-slots.ts`, 18 slots: LAS 0 to 15; 16 = the several-returns rule,
  written as code 64; 17 = any LAS class from 16 up, written as code 1), sums them exactly when voxels merge, and carries the dominant slot
  through the pipeline in the splat's opacity byte (slot / 255), then moves it into the plane when the tile is written; the block's opacity is
  the usual 0.95. Voxel memory grows by 18 doubles per voxel (about 0.7 GB peak for a mesh against 0.3 GB).
- `merge:tilesets` joins the planes of the source tiles in the order of their splats (`joinClassCodes`). If any source tile has no plane, or a
  plane of another length than its splats, the merged tile gets no plane and the merge prints a warning (classes are never put on the wrong splats).
- LAS classes of 16 and up (for example 17, bridge deck) are stored as 1: the data of this project does not use them.

## In the demo

- `hide vegetation` (checkbox, `?hideveg=1`) hides the codes 3, 4, 5, 64; `?hide=3,4,...` hides the listed codes (0 to 127). The hide set is a 128-bit
  mask computed once when it changes.
- `color: by class` (select, `?color=class`) draws the splats in the palette of `demo/src/class-palette.ts` (one entry per code 0 to 127; the
  defined codes are vivid and close to the usual LAS palettes: ground orange, low vegetation lime, medium vegetation green, high vegetation dark
  green, canopy teal, building red, water blue, bridge purple; any other code magenta), with a legend of the classes in view and their shares. The
  legend is cleared when no class feature is on.
- A tile without a plane gets the guess of `demo/src/vegetation.ts` (E019; code 64 for a guessed vegetation splat, 1 for the rest), **made only
  while a class feature is on**; switching one on later reloads the drawn tiles (from the browser's cache) so that they get it.
- On the GPU the class is an instanced `u8` attribute (`a_class`, one byte per splat, uploaded when the plane is inflated; a tile that already has
  one gets the old buffer deleted); the vertex shader skips hidden classes by the mask (`u_hide_mask`) and looks the color up in `u_palette[128]`.

## Review (2026-11-17)

An independent review of the class plane work (the `code-review` skill, ten findings) and a review of this specification. What was found and what
was done:

| finding | decision |
| --- | --- |
| `DORAYAKI_CLASS_PLANE=1` without adaptive merge wrote a plane of the default opacity byte, 242, for every splat | the builder stops with an error; slot logic moved to `src/pointcloud/class-slots.ts` and tested |
| `merge:tilesets` joined planes without checking their length against the splats (and spread them into JS arrays) | `joinClassCodes` checks every part, typed arrays only, warning when a plane is dropped |
| the browser inflated a plane without a limit | `count` is the limit, in the codec's interface, the demo and the merge |
| codes 128 to 255 could not be hidden and were all colored as canopy | reserved and rejected (codes 0 to 127 only), a palette entry per code |
| the legend stayed after switching class features off | cleared |
| attaching classes twice left the old buffer allocated | the old class buffer is deleted |
| the hide mask was rebuilt for every draw call | computed once in the layer (`hideMaskOf`) |
| the vegetation guess was computed for every tile even when unused | computed only while a class feature is on, tiles reloaded on switching |
| E021 stated "0.1 s per million splats" without a measurement | measured: 305 ms for 785,133 splats (0.39 s per million) |
| no tests for the builder slots, the merge join, the inflate limit | tests added (`test/class-plane.test.ts`): slots, joining, limit, invalid codes, the carry through the adaptive merge |

Reviewed without change: the frame layout; the choice of a second frame over a sidecar archive; one byte per splat plus gzip over a 2-bit or
run-length form (0.25 % of the archive more; simpler, and codes up to 127); the plane being optional; reserved header bytes ignored.

## Not decided

Where to host a ground-only or classed variant, finer classes for the airborne data (a building or water class would need another source than the
LAS class), per-splat purity, and a real test for the demo's use of the plane (the browser path was looked at by hand).
