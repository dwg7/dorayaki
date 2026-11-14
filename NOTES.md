# Notes

Observed findings from the experimental loop, newest last. Only things
that have actually been observed are recorded here.

## 2026-11-12 — `bridge` fixture

- The naive Surfel Block v1 represents the bridge without any format
  change: ground (z = 0, +z), underside (z = 4/16, −z) and deck
  (z = 5/16, +z) at the same x/y, plus vertical pier faces (horizontal
  normals). Encode/decode preserves all layers and their order (tests in
  `test/bridge.test.ts`). The format is not a height field.
- Limitation observed: the relationship between z and x/y is undefined.
  The fixture had to pick a vertical scale, and it uses the unit square's
  unit for z as well, so the deck sits at 5/16 of a tile width. Read as
  geographic data this height is arbitrary, and it would change with zoom
  level. The codec does not need a frame; geographic rendering does.
- Also observed: a decoded block has no part identity. The tests can tell
  ground, deck, underside and supports apart only by array order, normal,
  and colour. Nothing so far needs it.

## 2026-11-12 — experimental MLT frame

- Upstream MLT framing is `[varint size][u8 tag][body]` with `size`
  counting the tag byte. The Surfel Block fits as a frame body unchanged;
  no wire-format change was needed.
- The MLT specification assigns tags 0x01 and 0x02 only and defines no
  experimental or private-use range, so the local tag 0xD0 has no
  protection against a future collision.
- The specification as read does not state a maximum for `size`; the
  uint32 / 5-byte varint limit is a Dorayaki choice.

## 2026-11-12 — first browser render (MapLibre GL JS 6.16.0)

Observed in Chromium (Claude desktop browser pane) with
`npm run demo`:

- The bridge renders in geographic position. Viewed top-down, the
  projected tile corners match the ground surfel extent. Deck (light
  grey), underside (dark), piers (brown) and ground (green) are distinct.
  The view follows pan, scroll zoom, keyboard pitch and programmatic
  bearing/pitch changes.
- Depth testing works: with it off, the underside (drawn after the deck)
  paints over the deck and the piers paint over everything.
- Vertical scale: with z in tile-width units the deck is about 155 m
  above ground at z16. This confirms the earlier note in practice: the
  height depends on the tile's zoom level, not on any physical unit.
- The deck and underside are discs with no edge faces. From a low side
  view the deck shrinks to a line and nearly disappears. This is a
  fixture limitation, not a format one.
- Disc radius (half the cell diagonal) makes every surface edge scalloped
  and overshoot its intended boundary. Ground discs extend past the tile
  boundary, and pier discs poke above the underside and below the ground.
- The 2D tile-outline line layer is not depth-tested, so it draws over the
  deck where they overlap.
- A page in a hidden browser pane did not finish loading the map
  (the worker request stalled, no `load` event). It loaded normally once
  the pane was visible. This is the test environment, not the demo.

## 2026-11-12 — metric z and radius (Surfel Block v2)

- With z and radius in metres, the fixtures need the carrying tile's
  width (`tileWidthMetres`) to choose radius and pier sampling. A tile's
  content is therefore no longer independent of its address. This is
  expected for metric data.
- Demo tile moved to z18 (124.2 m wide). The deck at 12 m now looks like a
  bridge on the OSM basemap rather than a 155 m platform. Top-down, the
  projected tile corners still match the ground extent.
- With the vertical extent (11 m) small relative to the disc radius
  (5.49 m), disc overshoot is more visible. The top pier row (centre
  8.25 m) reaches 13.7 m and pokes through the 12 m deck, visible from
  above as square outlines and from the side above the deck.
- The relative change of Mercator scale across one tile is at most
  2π / 2^zoom (0.0096 % at zoom 16), so the single per-tile width is
  adequate at the zooms used so far.

## 2026-11-12 — `overhang` fixture

- Surfel Block v2 represents the overhang without any format change. Under
  the shelf, decoded columns hold ground (+z, 0 m), underside (−z, 8 m)
  and top (+z, 16 m), in that order.
- Viewed in the demo from beside the tile's east edge with the camera
  3 m above ground, it reads as an overhang: the underside is visible
  overhead, between the hanging lip and the back wall. The camera was
  placed with `calculateCameraOptionsFromCameraLngLatAltRotation`.
  Pitch above 90° drew nothing.
- Disc overshoot now hides architecture, not only edges. On the 124 m
  tile (pitch 7.76 m, radius 5.49 m), the lip's lower row (centre 10 m)
  reaches down to 4.5 m, below the 8 m underside. From the front at eye
  level, the 8 m opening is mostly covered, and the underside shows only
  through the gaps between the scalloped discs. The back wall's discs
  also reach below the ground.
- With a fixed light from the north-west, every south-facing face (lip
  and back wall) gets ambient light only and looks the same dark brown.
  From the front, the two faces cannot be told apart.

## 2026-11-12 — per-patch sampling (fixture change, no format change)

- Change: each fixture surface is sampled on its own grid
  (`src/fixtures/sampling.ts`). The spacing is at most P (1/16 of the tile)
  and fits both sides of the patch, and the radius is half the cell
  diagonal. Before, vertical faces used the horizontal pitch for their
  radius. Horizontal grids are unchanged, so layers still share x/y.
- On the 124 m demo tile:

  | | before | after |
  | --- | --- | --- |
  | overhang lip bottom (underside at 8 m) | 4.51 m | 7.21 m |
  | overhang back wall top (underside at 8 m) | 11.49 m | 8.79 m |
  | bridge pier top (deck at 12 m) | 13.74 m | 12.03 m |
  | surfels: bridge / overhang | 416 / 448 | 432 / 512 |

- In the demo, the overhang's underside now shows from the front at eye
  level as a continuous band under the lip, with the back wall behind it.
  The pier outlines no longer show through the deck from above.
- Residual: circular discs still overshoot a patch edge by r − cell/2.
  That is at most (√5 − 1)/4 ≈ 0.31 of the spacing, or 0.21 for square
  cells (tested). The bridge pier tops still end 3 cm above the deck, and
  the ground, deck and top edges stay scalloped by about 1.6 m. Removing
  the overshoot entirely would need a different surfel shape (for
  example elliptical or clipped discs). That is a format change, not
  pursued here.

## 2026-11-12 — vector basemap at Sapporo Station

- The demo basemap is now `bvmap-koicha-starlight` from hfu/stars
  (`https://stars.optgeo.org/style/bvmap-koicha-starlight`, 125 layers,
  MLT-encoded vector tiles, z3–16). The demo tile moved to Sapporo Station,
  z18/234000/96256 (111.7 m wide), inside the `bvmap-koicha-hokkaido`
  bounds. Rendering over the vector basemap needed no change to the
  surfel layer. Top-down, the tile outline still matches the ground
  extent, and the console showed no errors.
- The surfel layer is added after every style layer, including the
  basemap's labels, so labels inside the tile are hidden by the surfels.
  Inserting it below the label layers would need a rule for which style
  layer to insert before. Not changed.

## 2026-11-12 — `boundary` fixture and a 2 × 2 tile block

- Ownership rule tried: each surfel goes to the tile containing its
  centre (half-open `[0, 1)`); discs may cross into neighbours; nothing is
  duplicated or clipped. The geometry is sampled once on a grid continuous
  across seams, then split (`src/tiling.ts`). No format change: v2
  already allows the disc extent to leave the tile.
- Demo: a 20 m building centred on the corner of four z18 tiles at
  Sapporo Station. The demo loads the four tiles separately, each with its
  own placement matrix and tile width. Top-down and oblique, the roof,
  walls and ground show no gap, overlap or step at the seams. The tile
  outlines (drawn on top) are the only sign of them.
- The half-open rule makes tile sizes uneven when a sample row lies
  exactly on a seam. On the 111.7 m tile, a wall column falls on x = 1.0
  and goes to the east tile: 9005 / 9101 / 9101 / 9197 bytes for NW / NE
  / SW / SE. This is expected, not a defect.
- The four tiles' widths differ by about 2π / 2^18 · sin(43°) relative
  (≈ 1.6 × 10⁻⁵, under 2 mm at 111.7 m). The fixture uses the north-west
  tile's width for sampling; at this zoom no seam artefact was visible.

## 2026-11-12 — toy 3DGS → surfel mapping

- Added a minimal 3DGS PLY reader (binary little-endian, scalar vertex
  properties, reference 3DGS conventions) and a deliberately lossy mapping
  to v2 surfels. The normal is the shortest axis, the radius is
  2·√(product of the other two scales), the colour is the SH DC term, and
  alpha is sigmoid(opacity). Tested on a deterministic toy PLY (flat
  ground, a wall rotated 30°, an isotropic "tree" blob) placed at Sapporo
  Station. No format change.
- Flat Gaussians (ground, wall) map naturally. The ground's in-plane
  anisotropy (1.5:1) is lost to the circular disc.
- Isotropic Gaussians have no shortest axis. The blob's discs all took
  the first axis (east) as their normal, and in the demo the tree renders
  as three thin vertical slabs: a volume collapsed into planes. The disc
  record has no way to say "this Gaussian is not flat". The mapping
  records this as `flatness` (≈ 1 for the blob), but the record drops it.
- Alpha is stored (sigmoid(opacity) · 255) but the renderer draws
  opaquely, so the blob's 0.6 opacity is not visible.

## 2026-11-12 — first real data: VIRTUAL SHIZUOKA MMS point cloud (Numazu)

Source: Shizuoka Prefecture VIRTUAL SHIZUOKA, 2019 MMS, mesh 08NE2701
(CC BY; zip 14,113,240 bytes, LAS 1.2 point format 3, 976,195 points,
plane rectangular zone VIII, about 14 m × 14 m × 12 m). Classes:
ground 254,441, low vegetation 406,061, medium vegetation 246,434, high
vegetation 69,259. Not committed; `npm run demo:numazu` rebuilds from
`data/`.

- Pipeline: LAS → one Gaussian per 0.25 m voxel (mean, covariance, mean
  colour) → reference-3DGS PLY → existing PLY → surfel mapping → z18 tile
  by centre ownership. 6,365 Gaussians in one tile (z18/232154/103715),
  203,726 bytes. The run took 0.17 s.
- Placement: Gauss–Krüger inverse checked against GSI xy2bl to 1e-8°
  (≈ 1 mm). In the demo the data sits at 35.13419° N, 138.81596° E on GSI
  pale tiles. The stars basemap has no coverage here.
- Not a height field: from beside, the tree canopy overhangs the ground,
  and the trimmed hedges show vertical faces.
- Gaussian shape statistics (after fitting): flatness median 0.24, 57 %
  flat (< 0.3), 17 % round (> 0.6); in-plane anisotropy median 1.4,
  90th percentile 5.0. The circular disc drops the anisotropy, and round
  vegetation Gaussians collapse into arbitrarily oriented discs, as the
  toy fixture predicted.
- Coverage: disc radius (2σ) has median 0.13 m against the 0.25 m voxel
  spacing, so surfaces show the voxel lattice as dotted grids with gaps.
  This comes from the toy fitting and RADIUS_SIGMAS, not from the format.
- Colours are dark in the source itself (mean RGB about 41–55 / 255;
  medium vegetation about 20), so the render is dark. Not adjusted.
- Vertical datum: the LAS heights are absolute (lowest ground point
  7.526 m). The demo sets z = 0 at that point to sit on the flat
  basemap. Real data makes the open "vertical datum" question concrete.
- Size: 32 bytes per surfel; this 14 m patch alone fills 204 KB at 0.25 m
  voxels. The station mesh 08NE3811 is a 3.24 GB zip. Evidence for the
  deferred quantization is starting to appear, but it depends on the
  voxel size chosen.

## 2026-11-12 — z is orthometric height; nationwide basemap

- Surfel Block v2 now defines `z` as orthometric height (標高, metres above
  the geoid). No byte or version change; see the format document's
  compatibility note. Synthetic fixtures' ground at z = 0 means sea level.
- The VIRTUAL SHIZUOKA LAS heights are already orthometric. Ground points
  near the data centre have median 7.78 m, and the GSI 1 m laser DEM gives
  7.6 m there (an ellipsoidal height would be about 40 m higher). The
  Numazu tiles now carry the LAS Z unchanged: z 7.53–19.89 m.
- Changing the vertical origin moved the 0.25 m voxel boundaries:
  6,365 → 6,266 Gaussians, 203,726 → 200,558 bytes. The toy voxel fit
  depends on the coordinate origin, not only on the data.
- On the flat basemap (no terrain), the Numazu data now floats at its
  real elevation, about 7.5 m above the map plane, as seen from beside at
  3 m eye height. Showing it on the ground would need terrain in the
  basemap, or a display offset that the data must not carry.
- Every tileset now uses stars' nationwide `bvmap-starlight` style
  (123 layers, GSI optimized vector tiles). The Numazu source attribution
  is added through MapLibre's `customAttribution`. The GSI pale-tile
  fallback is removed.

## 2026-11-13 — density, zoom levels, and a COPC baseline (08NE2701)

- COPC baseline (PDAL 2.10.2 `writers.copc`, same 976,195 points):
  6,360,621 bytes with all attributes (6.52 B per point); 5,183,226 bytes
  with GPS time, intensity and other non-geometry attributes zeroed
  (5.31 B per point). Plain LAZ: 5,150,333 bytes.
- Footprint 111.9 m², about 8,700 points per m².
- One Gaussian per occupied voxel of v_z = tile width / 512 (`npm run
  measure:numazu`): z18 7,650 · z19 30,057 · z20 99,926 · z21 259,440 ·
  z22 512,461 · z23 783,501. Growth per zoom falls from about 3.9× to
  1.5× as the voxels approach the point spacing.
- At the current 32-byte record, the Gaussians beat COPC (xyz+rgb) only
  down to z20 detail (0.62×). z21 detail is 1.60× and z22 detail 3.16×.
  This is the first measured evidence for a more compact record.
- Design proposal written up in `documents/progressive-maxzoom.md` (not
  implemented).

## 2026-11-13 — v3: level table and a progressive maxzoom tile (Numazu)

- Surfel Block v3: a 16-byte header with `level_count` and a level table
  (uint32 per level) before the unchanged 32-byte records. v1/v2 are
  rejected. Fixture hashes and test vectors regenerated.
- Numazu pyramid (`npm run demo:numazu`, 3.6 s): z18 aggregated 7,639
  Gaussians (244,502 B), z19 aggregated 29,989 (959,702 B), and z20 as two
  maxzoom tiles with 512,401 finest Gaussians (1.53 cm voxels) in 3
  levels. The z20 prefixes are 3.19 MB (level 0), 8.23 MB (0–1) and
  16.4 MB (all), that is 0.62×, 1.59× and 3.16× COPC (xyz+rgb).
- Bug found by real data: `placeDiscs` used `Math.min(...array)`, which
  overflows the call stack above about 500 k elements. Now uses loops,
  with a 600 k test.
- In the demo, zoom-based selection works top-down: z18 → z19 → z20 levels
  1, 2, 3 at zooms 18.5, 19.5, 20.3, 21.3, 22.3. In pitched close-ups it
  does not: the map zoom stayed 19.58 from 60 m to 10 m in front of the
  trees, so coarse tiles were drawn close up. Selection needs camera
  distance (screen-space error), not map zoom.
- None of the finest Gaussians is flat (about 1.9 points each). Their
  normals are arbitrary, and from above, edge-on discs leave the canopy
  gappy. This is evidence for camera-facing rendering of round Gaussians
  and for dropping the normal from round records in a compact v4.

## 2026-11-13 — GitHub Pages site from main:docs/

- Design documents moved from `docs/` to `documents/` (hfu offered either
  that or a miso instance; cafebabe noted that miso means authoring an
  instance, not moving files). `docs/` now holds only the built site
  (`npm run site`).
- First build: MapLibre unbundled, `maplibre-gl.mjs` and its worker side by
  side under `docs/vendor/`, relative import map. At `/dorayaki/` (local
  Python http.server, symlinked root) the worker returned 200 and all four
  synthetic fixtures rendered.
- Switched to the dwg7-recommended single-file page (pointed out by hfu):
  `docs/index.html` with all JS (demo + MapLibre GL JS 6.16.0, minified,
  about 1.09 MB) and all CSS inline; no hashed file names. Only
  `docs/maplibre-gl-worker.mjs` (519 KB, self-contained in 6.16.0), the
  tiles and `.nojekyll` are separate. Bundled, MapLibre's `import.meta.url`
  is the page, so the build defines the worker path and the demo calls
  `setWorkerUrl`. At `/dorayaki/` the worker was fetched from
  `/dorayaki/maplibre-gl-worker.mjs` (200), and the bridge fixture and the
  vector basemap rendered with no console errors. The other three
  fixtures' tiles were fetched (200/304), but their rendering was not
  observed: the browser pane was hidden, so the map never fired `load`.
- Not yet verified on GitHub Pages itself: the live URL and the
  Content-Type served for `.mlt` (read as an ArrayBuffer, so it should not
  matter).

## 2026-11-14 — Numazu: omission at maxzoom; EXPERIMENTS.md

- Pages is live at https://dwg7.unopengis.org/dorayaki/. The worker is
  served as `text/javascript` (200) and `.mlt` tiles as
  `application/octet-stream` (200). Numazu was missing because the site
  build excluded it (17.6 MB).
- Omission measured in `EXPERIMENTS.md` E002. Keeping level 0 whole and
  dropping refinement surfels with support below 6 brings the whole
  Numazu pyramid to 5,140,841 B (0.99× COPC xyz+rgb), with all level-0
  cells covered.
- The large-array spread trap struck again, in a measurement script
  (`push(...keep)` with about 170 k elements). Fixed with a loop.
- `splitByTile` and `orderByRefinement` are now generic, so per-surfel
  producer data (here `support`) survives tiling and ordering.
- Browser timings (GPU upload, frame time) could not be taken: the
  session's browser pane was hidden, so MapLibre never fired `load`. The
  demo now carries the instrumentation (`dorayaki.report()`,
  `dorayaki.measureFrames()`).

## 2026-11-14 — Numazu as PMTiles on stars; scale-floor artefact

- Decision (hfu): the Numazu tiles are not committed to `docs/`. They are
  packed into one PMTiles archive, `dorayaki-numazu.pmtiles`, for stars,
  where Martin decodes the archive and serves z/x/y. `src/pmtiles.ts`
  writes PMTiles v3: tile type 6 (MLT), raw tiles, and gzip directories
  and metadata, the same shape as stars' existing MLT archives. Tile IDs
  match the pmtiles reference implementation exhaustively at z4 and at
  sample tiles up to z26. The pmtiles 4.5.0 reader reads back the header,
  metadata and every tile.
- stars' answer (stars session): files go to `/home/stars/data/` on the
  stars host, uploaded under a hidden name and then moved into place.
  Martin 1.14.0 registers them without a restart and serves them as
  `application/vnd.maplibre-tile`. CORS echoes the requesting origin.
  Missing in-range tiles are 204. Placement needs hfu's direct instruction
  to the stars session; this session does not upload.
- The demo now reads external tilesets from TileJSON (local
  `tiles/numazu/tilejson.json`, or Martin's), and lists tiles from bounds
  and zoom range. East and south edges count as exclusive, so pyramid
  bounds do not pull in neighbour tiles. The site build lists Numazu only
  when `DORAYAKI_NUMAZU_TILEJSON` is set.
- Artefact found: the voxel fit floored every Gaussian's scales at a
  quarter voxel (since v3). This erased the thin axis of planar voxels.
  Fixed: the floor applies only to voxels with fewer than 3 points. It
  corrects the 2026-11-13 "0 % flat" finding (EXPERIMENTS.md E003).

## 2026-11-15 — Surfel Block v4: anisotropic splat records (breaking)

- The record is now a 16-byte quantized Gaussian splat instead of a
  32-byte disc: x, y as uint16 of the tile, z as uint16 steps (1 mm) from a
  per-block float64 origin, three log-quantized scales (10 steps per octave),
  a 23-bit "smallest three" rotation, and RGBA. Header 32 bytes (z origin and
  step added). v1–v3 are rejected. Decoding is lossy within documented
  tolerances (`documents/surfel-block-format.md`).
- Quantization finding: with codes 0..126 and code 63 = 0, the identity and
  all axis-aligned rotations are exact. A first grid of 128 codes could not
  represent 0 and left every identity rotation 0.6° off. Round-to-nearest
  on the three stored components then gave up to 1.6° worst case on random
  rotations, and more than 2° where all four components are about 0.5 (the
  wall normals of the synthetic fixtures). Choosing the best of 8 round-up/
  down combinations at encode time brings that to 1.2° worst, 0.7° mean,
  with no change to the decoder.
- Fixtures stay circular surfels and are converted by `surfelToSplat` before
  encoding; the demo reduces decoded splats back to discs (`splatToSurfel`) in
  this step. The renderer does not draw anisotropy or round blobs
  differently yet; that is the next step.
- Test vectors, fixture hashes and the MLT frame examples were regenerated.
  Tests compare decoded splats with the originals within the quantization
  tolerances (`test/helpers.ts`) instead of exactly.
- Numazu pyramid in v4 (`npm run demo:numazu`, same inputs and omission as
  E002): z18 122,294 B, z19 479,894 B, z20 491,326 + 1,477,086 B; the
  PMTiles archive (gzip directories) is 2,571,655 B, exactly half of the v3
  archive (5,141,899 B) and 0.50x the COPC (xyz+rgb, 5,183,226 B). Node
  decode of the larger z20 tile: 26.2 ms for 92,313 splats (v3: 22.7 ms).
