# Decisions and work, 2026-11-21 to 2026-11-23

Status: a log of what was done and decided in this stretch (the Sasebo expansion and the demo's look and view behavior), with the reason for each decision and what
is still open. Facts and numbers live in the documents linked from each item; this page is the index. Dorayaki is an experiment, not a standard.

## Decisions

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D1 | Soft look: opaque core scale **1.0** (was 0.85). | At 0.85 a flat, regular grid showed dark diamonds at the disc corners ("lattice" look on flat ground). | [demo-and-site.md](demo-and-site.md), NOTES.md |
| D2 | Per-splat **jitter** (`?jitter=`, default **0.6** for point-cloud tilesets): a deterministic shift of at most jitter/2 of the semi-axes and a growth (never a shrink), hashed from `gl_InstanceID`. | Core 1.0 left the grid regular; jitter breaks the regularity without holes. Option A (core) was tried first, B (jitter) added on top. | [demo-and-site.md](demo-and-site.md) |
| D3 | The viewer ranks tiles by distance to **`map.getCenter()`**, not to the bounds' center. | On a tilted view the bounds' center lies far beyond the point the user looks at; the tiles in front of the camera vanished. | NOTES.md |
| D4 | After a pan drag the zoom is restored with an **ease** (`?zoomease=<ms>`, default **1500 ms**, 0 jumps). | The correction lurched ("gakkun") after a scroll; a slow ease reads as a camera move. | [demo-and-site.md](demo-and-site.md) |
| D5 | Wide-area expansion starts with **Sasebo** (Open Nagasaki, CC BY 4.0), not Kawazu or Numazu. | Rises from the sea (easier to control than Kawazu's slopes); no MMS data, so a thinner and simpler cloud. | [sasebo-expansion.md](sasebo-expansion.md) |
| D6 | Naming: **`dorayaki-sasebo`** (`dorayaki-<place>`; no mesh codes, dates or `-area`); the version is a `?v=` on the TileJSON. | Same rule as Kawazu; Cloudflare caches tiles and TileJSON for 4 hours per origin, so a new archive needs a new `?v=`. | [sasebo-expansion.md](sasebo-expansion.md) |
| D7 | Build with **`build:tiled`**, not `build:tileset`, for more than one sheet. Recipe: adaptive levels 3, thickness 0.2, color 0.2, sparse 0, block version 6, 3 workers; `DORAYAKI_ATTRIBUTION` for non-Shizuoka data. | Two sheets in one `build:tileset` process run out of memory (8 GB); the tile-aligned build took 47 s for two sheets and 104 s for eight. | [tile-aligned-build.md](tile-aligned-build.md), [sasebo-expansion.md](sasebo-expansion.md) |
| D8 | **Step 4 of E022**: a streaming PMTiles writer (`src/pmtiles-file.ts`), used by `build:tiled`. | The archive was built in memory, which caps the area. Byte-identical to the in-memory writer (tested). | [tile-aligned-build.md](tile-aligned-build.md) |
| D9 | Hosted area grown to **eight sheets, 6 km2** (17.0 M splats, 203,951,931 B), toward the harbor; the stars archive was replaced and the site pins `?v=20261123b`. | The two-sheet area was too small for the national-survey training (2026-11-25). | [sasebo-expansion.md](sasebo-expansion.md) |
| D10 | The demo's TileJSON guard is **4,096** tiles, counted before listing. | Eight sheets list 164 tiles (the guard was 64); a country-sized bound used to overflow the stack in `tiles.push(...)`. | [size-and-scale.md](size-and-scale.md) |
| D11 | Compare data size with 3D Tiles by **bytes per point and per area**, marking what is measured and what is arithmetic. Result: 1.5 to 3 x smaller than `.pnts` at 10 points/m2 (Sasebo), 45 to 85 x at 440 points/m2 (Kawazu). | The advantage is not a better codec: Dorayaki stores splats (occupied cells), 3D Tiles stores points. It is paid for with the individual points and with precision. | [size-vs-3d-tiles.md](size-vs-3d-tiles.md) |
| D12 | **`?mixed=1` is the default for `sasebo`** (`?mixed=0` switches it off); other tilesets are unchanged. | The nine-tile limit covered only part of a tilted view at 6 km2. Same view: 9 z16 tiles, 2.60 M splats, 31 MB, against 20 tiles of z17 and z16, 3.68 M splats, 44 MB, filling the view. | [sasebo-expansion.md](sasebo-expansion.md), [demo-and-site.md](demo-and-site.md) |

## A bug found on the way (fixed)

`?mixed=1` drew the far tiles empty. With `staged`, a tile in both the stage set and the final set reached the layer without data when the final `setTiles` replaced
the stage set before the next frame applied it (the demo hands its data over and drops its copy). Fixed by `inheritPendingData` (`demo/src/pending-tiles.ts`, 2 tests).
Found by comparing the tile list the layer held (`packed: 0` on the empty ones) with the list that was fetched. See NOTES.md, 2026-11-23.

## How decisions were made (working rules that held)

- A relayed approval from a peer session is not authorization; a removal on the production host (stars) was done only after the user allowed it in chat, and was never
  routed around the permission classifier.
- Before replacing a served file: check the target and the temporary file on the host first. On 2026-11-23 a command offered as a fallback was also run by the user after it
  had been done, and deleted the new file; Sasebo was 404 for about 2 minutes until it was uploaded again. When something offered as a fallback has been done, say so in the same turn.
- Each change on its own branch and PR; never push to a branch whose PR is merged.
- The site is rebuilt with all three TileJSON variables (`DORAYAKI_NUMAZU_TILEJSON`, `DORAYAKI_KAWAZU_TILEJSON`, `DORAYAKI_SASEBO_TILEJSON`); without them Numazu, Kawazu or Sasebo drop out.

## Open

- **Sasebo-specific tuning** (not started): the merge recipe was tuned on Kawazu (121 to 440 points/m2); at 10 points/m2 flat surfaces (car parks, roofs) become large discs.
  The z17 voxel (0.5 m) holds 1.5 points; 1 m voxels hold 3.5. Candidates: another recipe at z17, or accepting z16 as the working zoom.
- **Tile budget in splats or bytes** instead of a tile count for `?mixed=1` (z17 tile about 0.1 M splats, z16 about 0.3 M): proposed, not decided; the cap is still 24 tiles.
- Real-drag behavior of the zoom ease and of `?mixed=1`; other browsers and GPUs; seams checked in a few views only.
- Extending toward Shokanzan and a wide area (about 110 km2): needs an external disk (shards about 17 GB; the machine has 8 GB of RAM and 14 to 19 GB free) and more downloads
  (the sheets' paths are not exposed by the download site). See [sasebo-expansion.md](sasebo-expansion.md).
- Not measured against 3D Tiles: Draco or meshopt, a real 3D Tiles tool's output, level-of-detail overhead, rendering cost.
- The national-survey slides (English, 2026-11-25) were written for about 1.5 km2; the area is now 6 km2. Images are to be swapped after the tuning.
- Next-step candidates to always offer: the three visual ideas (splat look, vivid color, false-color by class).
