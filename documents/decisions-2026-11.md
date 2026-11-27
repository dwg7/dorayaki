# Decisions and work, 2026-11-21 to 2026-11-27

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
| D13 | Build a wider area with the **hosted recipe first**, then make it finer (2026-11-24). | The stricter recipes keep more detail at 1.45 times the bytes; whether the build scales mattered more first. | [sasebo-expansion.md](sasebo-expansion.md) (E023) |
| D14 | A z15 or z16 tile at **about a quarter** of its size; **z14 and z13** added; **size, not the look, is the criterion**, and the merge may adapt by zoom and place (2026-11-25). | Low-zoom tiles were 4 to 16 MB, and the area will grow. Detail lost at the low zooms is accepted. | E024, [sasebo-expansion.md](sasebo-expansion.md) |
| D15 | A **view budget of 40 MB and 4 million splats** that **covers the whole screen** (`?mixed=1`), to be tightened later if needed. | The cap of 24 nearest tiles left the far part of a tilted view empty. | E024, [demo-and-site.md](demo-and-site.md) |
| D16 | The **32-sheet archive** (about 17 km2, z13 to z17, 714 MB) replaces the hosted one; nine gap sheets were added before hosting (2026-11-25). | One replacement instead of two; the hole between the two groups showed. | [sasebo-expansion.md](sasebo-expansion.md) |
| D17 | Camera direction: the **agent-operated shot script** comes first; step 1 is a player of hand-written shot JSON, without FreeCameraOptions (2026-11-26). | Fujimura's decision in documents/camera-direction.md; the centre/zoom/pitch/bearing approximation was tried first. | [camera-direction.md](camera-direction.md), NOTES.md |
| D18 | While a tour plays, the player sets the **look-at height itself** (map clamping off); a **status control** with Stop and Replay; on Pages a **Play tour** button and `?shots=` (2026-11-26). | The camera rode the terrain; the end of a tour was not visible; Pages had no way to start one. | NOTES.md (2026-11-26), [demo-and-site.md](demo-and-site.md) |
| D19 | Inputs and build work go to an **external disk**; the **whole of Open Nagasaki** is downloaded, one file at a time with pauses, `01JE` around central Sasebo first (2026-11-27). | 32 sheets filled the internal disk once; the next step is the prefecture. | [sasebo-expansion.md](sasebo-expansion.md) (last section) |

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

## Open (as of 2026-11-27)

- **z17 at about 10 points/m2**: the hosted recipe is smooth but flat on roofs and bare ground; a stricter one keeps detail at 1.45 times the bytes (E023). z17 is now 86 % of the
  archive, so it is also the size question.
- **The budget**: 40 MB / 4 million splats per view (D15) may be tightened; not measured on weaker GPUs or slow networks.
- **The prefecture**: the download has started (D19). Not decided: removing converted zips as the build goes, or more disk (the prefecture is about 1.6 TB of zips, the disk 447 GB);
  how a prefecture-sized archive is listed in the viewer (the TileJSON tile list is capped at 4,096); whether stars serves a multi-GB archive well.
- **Camera direction**: storyboard stills (step 2) and the agent bridge (step 3); a tour can outrun the tiles; the zoom-dependent splat lift may still heave during zooming shots.
- Real-drag behavior of the zoom ease and of `?mixed=1`; other browsers and GPUs; seams checked in a few views only.
- Not measured against 3D Tiles: Draco or meshopt, a real 3D Tiles tool's output, level-of-detail overhead, rendering cost.
- Next-step candidates to always offer: the three visual ideas (splat look, vivid color, false-color by class).

- The national-survey slides (2026-11-25) were written for about 1.5 km2; the hosted area is now about 17 km2. This session has not told the slides session.

Closed since 2026-11-23: the tile budget in bytes and splats (D15, done); the external disk and the paths of the sheets (D19: the download page's own list).
