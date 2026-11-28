# Decisions

Status: a log of what was decided from 2026-11-21 (the Sasebo expansion, the demo's look and view behavior, the compaction), with the reason for each decision and what
is still open. Facts and numbers live in the documents linked from each item; this page is the index. Dorayaki is an experiment, not a standard.

## Decisions

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D1 | Soft look: opaque core scale **1.0** (was 0.85). | At 0.85 a flat, regular grid showed dark diamonds at the disc corners ("lattice" look on flat ground). | [demo.md](demo.md), NOTES.md |
| D2 | Per-splat **jitter** (`?jitter=`, default **0.6** for point-cloud tilesets): a deterministic shift of at most jitter/2 of the semi-axes and a growth (never a shrink), hashed from `gl_InstanceID`. | Core 1.0 left the grid regular; jitter breaks the regularity without holes. Option A (core) was tried first, B (jitter) added on top. | [demo.md](demo.md) |
| D3 | The viewer ranks tiles by distance to **`map.getCenter()`**, not to the bounds' center. | On a tilted view the bounds' center lies far beyond the point the user looks at; the tiles in front of the camera vanished. | NOTES.md |
| D4 | After a pan drag the zoom is restored with an **ease** (`?zoomease=<ms>`, default **1500 ms**, 0 jumps). | The correction lurched ("gakkun") after a scroll; a slow ease reads as a camera move. | [demo.md](demo.md) |
| D5 | Wide-area expansion starts with **Sasebo** (Open Nagasaki, CC BY 4.0), not Kawazu or Numazu. | Rises from the sea (easier to control than Kawazu's slopes); no MMS data, so a thinner and simpler cloud. | [datasets.md](datasets.md) |
| D6 | Naming: **`dorayaki-sasebo`** (`dorayaki-<place>`; no mesh codes, dates or `-area`); the version is a `?v=` on the TileJSON. | Same rule as Kawazu; Cloudflare caches tiles and TileJSON for 4 hours per origin, so a new archive needs a new `?v=`. | [datasets.md](datasets.md) |
| D7 | Build with **`build:tiled`**, not `build:tileset` (removed since, D20), for more than one sheet. Recipe: adaptive levels 3, thickness 0.2, color 0.2, sparse 0, block version 6, 3 workers; `DORAYAKI_ATTRIBUTION` for non-Shizuoka data. | Two sheets in one `build:tileset` process run out of memory (8 GB); the tile-aligned build took 47 s for two sheets and 104 s for eight. | [build.md](build.md), [datasets.md](datasets.md) |
| D8 | **Step 4 of E022**: a streaming PMTiles writer (`src/pmtiles-file.ts`), used by `build:tiled`. | The archive was built in memory, which caps the area. Byte-identical to the in-memory writer (tested). | [build.md](build.md) |
| D9 | Hosted area grown to **eight sheets, 6 km2** (17.0 M splats, 203,951,931 B), toward the harbor; the stars archive was replaced and the site pins `?v=20261123b`. | The two-sheet area was too small for the national-survey training (2026-11-25). | [datasets.md](datasets.md) |
| D10 | The demo's TileJSON guard is **4,096** tiles, counted before listing. | Eight sheets list 164 tiles (the guard was 64); a country-sized bound used to overflow the stack in `tiles.push(...)`. | [datasets.md](datasets.md) |
| D11 | Compare data size with 3D Tiles by **bytes per point and per area**, marking what is measured and what is arithmetic. Result: 1.5 to 3 x smaller than `.pnts` at 10 points/m2 (Sasebo), 45 to 85 x at 440 points/m2 (Kawazu). | The advantage is not a better codec: Dorayaki stores splats (occupied cells), 3D Tiles stores points. It is paid for with the individual points and with precision. | [datasets.md](datasets.md) |
| D12 | **`?mixed=1` is the default for `sasebo`** (`?mixed=0` switches it off); other tilesets are unchanged. | The nine-tile limit covered only part of a tilted view at 6 km2. Same view: 9 z16 tiles, 2.60 M splats, 31 MB, against 20 tiles of z17 and z16, 3.68 M splats, 44 MB, filling the view. | [datasets.md](datasets.md), [demo.md](demo.md) |
| D13 | Build a wider area with the **hosted recipe first**, then make it finer (2026-11-24). | The stricter recipes keep more detail at 1.45 times the bytes; whether the build scales mattered more first. | [datasets.md](datasets.md) (E023) |
| D14 | A z15 or z16 tile at **about a quarter** of its size; **z14 and z13** added; **size, not the look, is the criterion**, and the merge may adapt by zoom and place (2026-11-25). | Low-zoom tiles were 4 to 16 MB, and the area will grow. Detail lost at the low zooms is accepted. | E024, [datasets.md](datasets.md) |
| D15 | A **view budget of 40 MB and 4 million splats** that **covers the whole screen** (`?mixed=1`), to be tightened later if needed. | The cap of 24 nearest tiles left the far part of a tilted view empty. | E024, [demo.md](demo.md) |
| D16 | The **32-sheet archive** (about 17 km2, z13 to z17, 714 MB) replaces the hosted one; nine gap sheets were added before hosting (2026-11-25). | One replacement instead of two; the hole between the two groups showed. | [datasets.md](datasets.md) |
| D17 | Camera direction: the **agent-operated shot script** comes first; step 1 is a player of hand-written shot JSON, without FreeCameraOptions (2026-11-26). | Fujimura's decision in documents/demo.md; the centre/zoom/pitch/bearing approximation was tried first. | [demo.md](demo.md), NOTES.md |
| D18 | While a tour plays, the player sets the **look-at height itself** (map clamping off); a **status control** with Stop and Replay; on Pages a **Play tour** button and `?shots=` (2026-11-26). | The camera rode the terrain; the end of a tour was not visible; Pages had no way to start one. | NOTES.md (2026-11-26), [demo.md](demo.md) |
| D19 | Inputs and build work go to an **external disk**; the **whole of Open Nagasaki** is downloaded, one file at a time with pauses, `01JE` around central Sasebo first (2026-11-27). | 32 sheets filled the internal disk once; the next step is the prefecture. | [datasets.md](datasets.md) (last section) |
| D20 | **Compaction** (2026-11-27): Surfel Block **version 6 only**; `build:tiled` the one builder; finished experiment scripts, experiment tilesets and the in-memory pyramid and progressive order removed; documents merged into five (format, build, demo, datasets, decisions) beside EXPERIMENTS.md and NOTES.md; Numazu re-encoded as version 6 and replaced on stars (`?v=20261127a`). Tag `pre-compaction-2026-11-27` marks the state before. | The code and the documents carried every past layout and builder; Git keeps them, so the working tree need not (Fujimura: "Git に履歴が残されていることを信頼し、コンパクションは積極的に行う"). Lines removed: stage 1 −57, stage 2 −873 (+330), stage 3 −2,086 (+17), stage 4 (documents) about −2,200 (+1,700). | this page, AGENTS.md |
| D21 | Production z17: **cells of about 1 m and at most 100,000 splats per z17 tile** (`DORAYAKI_Z17_CELL_SCALE=2`, `DORAYAKI_ZOOM_TARGET_SPLATS=17:100000,...`), in `produce:opennagasaki` (2026-11-28). | z17 was 90 % of the archive; on four sheets this is a third of the z17 bytes and builds faster than the hosted recipe (51 s against 68 s), where a cap alone needs twice the time. The prefecture at roughly 120 GB instead of 330 GB (arithmetic). Forest merges into larger patches; accepted (Fujimura chose it after the look). | E025, [datasets.md](datasets.md) |
| D22 | **Priorities for the prefecture: first, every zoom level stays smooth in the viewer after the whole area is rolled out; then, data size ("no wasted gigabytes")** (hfu, 2026-11-28). Every size experiment is judged against the first before the second: a change that bounds the merge error but makes tiles too heavy for the viewer's budget (D15) is not taken. Work by many short prototype-and-measure loops, from the end user's side. | The goal of the week is all of Nagasaki with smooth camera work; size matters only once smoothness holds. Sasebo (town, harbour, forest, steep slopes in one field) is the field for tuning general parameters, which differ by zoom and by landscape (not a true fractal). | E026 |
| D23 | **Storage: the zips on a 2 TB HDD (`/Volumes/dorayaki-hdd`), work directories and output on a 2 TB SSD (`/Volumes/dorayaki`)**; `opennagasaki/zips` is a symbolic link to the HDD. The 447 GB SSD was copied, checked file by file (sizes, an rsync dry run, a zip test sample) and erased (2026-11-28). | The prefecture is 1.6 TB of zips plus about 1.35 TB of shards if built at once (0.84 x the zips, measured on 01JE); zips are read once, so a slow disk is enough, while tile jobs read the shards and want an SSD. The laptop's port was needed for power. | [datasets.md](datasets.md) |
| D24 | **Lower zooms drop splats whose long axis is under 2 pixels at their own zoom** (`DORAYAKI_MIN_LONG_AXIS_PX=16:2,15:2,14:2,13:2` in `produce:opennagasaki`; z17 keeps every splat), 2026-11-28. | hfu's idea (prune what is too short for the zoom). On four sheets: 9 to 17 % fewer splats at z16 to z13 (those zooms 9.7 % smaller, the archive 2.8 %), holes under 1 % and a mean color difference under 1 of 255; wide views draw fewer splats (D22). At 3 pixels holes reach 12 to 54 %: the smallest splats are single voxels of 2 pixels. z17 is shown up to view zoom 19, where its splats are 4 to 8 times larger, so it is not pruned. | E027 |

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

## Open (as of 2026-11-28)

- **z17 at about 10 points/m2**: decided for size (D21, E025); the hosted Sasebo archive still has the older z17. Whether a stricter recipe (E023) is wanted somewhere is open.
- **The budget**: 40 MB / 4 million splats per view (D15) may be tightened; not measured on weaker GPUs or slow networks.
- **The prefecture**: the download has started (D19); disk is settled (D23). Not decided: how a prefecture-sized archive is listed in the viewer (the TileJSON tile list is capped at 4,096); whether stars serves a multi-GB archive well.
- **Camera direction**: storyboard stills (step 2) and the agent bridge (step 3); a tour can outrun the tiles; the zoom-dependent splat lift may still heave during zooming shots.
- **Merge error under the size cap** (E026): on four sheets the cap of D21 loosened the rule at most 8 times (1.6 m, color 0.57), mostly at z16; a ceiling of 4 nearly doubled
  z16 for a small picture difference, so there is no ceiling for now. To be checked on the per-tile steps of the whole 01JE build.
- **Proposed by hfu**: pruning by screen size is in (D24, lower zooms only); whether z17 can lose anything when zoomed in is open, as are thresholds by landscape.
  Color by splat tilt (slope and/or aspect of the normal; aspect is axial because the normal's sign carries no meaning) is prototyped in the demo.
- Real-drag behavior of the zoom ease and of `?mixed=1`; other browsers and GPUs; seams checked in a few views only.
- Not measured against 3D Tiles: Draco or meshopt, a real 3D Tiles tool's output, level-of-detail overhead, rendering cost.
- Next-step candidates to always offer: the three visual ideas (splat look, vivid color, false-color by class).

- The national-survey slides (2026-11-25) were written for about 1.5 km2; the hosted area is now about 17 km2. This session has not told the slides session.

Closed since 2026-11-23: the tile budget in bytes and splats (D15, done); the external disk and the paths of the sheets (D19: the download page's own list).

## Earlier decisions

Decisions before 2026-11-21 are recorded with their experiments in EXPERIMENTS.md (each experiment ends with its decision). The maxzoom and progressive-order proposal of 2026-11-13 (version 3 level tables, nested refinement) was not pursued: every builder writes one level per tile, the lower zooms are the level of detail, and its code was removed in D20 (the proposal is in Git as `documents/progressive-maxzoom.md`).
