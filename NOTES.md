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

## 2026-11-15 — renderer: ellipses and camera-facing round splats

- The demo draws each splat as its 2-sigma ellipse in the plane of its two
  longer axes (`demo/src/splat-instances.ts` builds the per-splat semi-axis
  vectors; the shader uses `centre ± axisU ± axisV`). A splat whose largest
  scale is under 1.5x its smallest (`ROUND_RATIO`) is a round blob and is
  drawn as a camera-facing disc of the equal-area radius; the camera's right
  and up come from rows 0 and 1 of the local-frame-to-clip matrix.
- Shading is now two-sided (`abs(dot(normal, light))`), because an axis's
  sign carries no meaning in v4. The synthetic fixtures' down-facing
  surfaces (bridge underside, overhang underside) are therefore lit like
  up-facing ones and are told apart by their colour, no longer by being dark.
  Round splats use a constant shade.
- Observed: in `toy-gs` the isotropic blob, which v3 drew as three thin
  vertical slabs, now reads as a rounded cluster. In the Numazu tiles the
  crown of the tree reads as a volume and the roof as tiled ellipses; the
  vector basemap is unchanged.
- Numazu in the browser (Apple M1, ANGLE Metal): the four tiles (2,570,600 B,
  160,644 splats) took 59 ms to fetch from the local server, 505 ms to
  decode and 47 ms to upload. The decode is about 3 µs per splat in the
  page against 0.28 µs in Node: the first calls run cold, and each splat
  becomes a JS object. Decoding straight into typed arrays is the obvious
  next optimization, but it is not needed yet.
- Browser tooling: navigating to a URL that differs only in the hash does not
  reload the page, so a rebuilt bundle was not picked up until a query was
  added. Screenshots of the hidden pane lag: the DOM and the map state are
  current, but the image can show an earlier frame for several seconds.

## 2026-11-15 — Numazu profiles; coarser is better at close range

- `buildPyramid` (`src/pointcloud/pyramid.ts`) now builds the Numazu
  pyramid; `npm run demo:numazu` takes `DORAYAKI_NUMAZU_PROFILE` = `medium`,
  `fine` (the E002 pyramid) or `coarse`. Sizes and the
  visual comparison are in EXPERIMENTS.md E004: PMTiles 2,204,268 B
  (medium), 2,571,701 B (fine), 603,132 B (coarse).
- The finding that matters: the thinned `fine` pyramid looks worse close up
  than the single-level `medium` one, although it costs more. Its level 0
  is made of sampled 1.5 cm Gaussians, so it is a sparse cloud, not a
  surface.
- The demo has `?lod=<zoom>`, a debug override that chooses tiles and levels
  as if the map were at that zoom. It exists because the map zoom does not
  follow the camera's distance to the data.
- The medium PMTiles was cross-checked with go-pmtiles 1.28 (`pmtiles tile`
  returned a z20 tile byte-identical to the file written by the producer).
- During these browser checks someone clicked in the pane, and the camera
  state can drift if scripted and manual input mix.

## 2026-11-15 — coarse becomes the standard Numazu tileset

- Direction (hfu): the hosted `dorayaki-numazu.pmtiles` is the `coarse`
  profile, to lead with how light it is (603,132 B, 0.12 times the COPC,
  0.62 bytes per source point), then refine according to need. `npm run
  demo:numazu` now defaults to `coarse`; `medium` builds
  `dorayaki-numazu-medium.pmtiles` and the dev demo's `numazu-medium`, `fine`
  builds `numazu-fine`.
- The standard archive: 2 tiles (z18/232154/103715 and z19/464309/207430),
  gzip directories, tile type MLT, minzoom 18, maxzoom 19. go-pmtiles 1.28
  returned the z19 tile byte-identical to the producer's file. The z19 tile
  differs from the one inside the `medium` archive: in `coarse` it goes
  through the maxzoom path (ordered by cell), in `medium` through the
  aggregated path, so the content is the same set of Gaussians in a different
  order.
- Upload procedure on stars (from hfu/stars `CLAUDE.md` and
  `docs/KNOWN_FACTS.md`): `ssh spacex.optgeo.org` lands as the `stars`
  user; files go to `/home/stars/data/`; stage under a hidden name
  (`.dorayaki-numazu.pmtiles.new.<rand>`, invisible to Martin's `*.pmtiles`
  scan), then `mv` into place; Martin registers new files without restart.
  Authentication is hfu's.

## 2026-11-15 — dorayaki-numazu.pmtiles published on stars

- Uploaded with hfu authenticating (Cloudflare Access opens a browser window
  for `ssh spacex.optgeo.org`; the first attempt timed out at a 20 s connect
  timeout while the window waited, so use a long `ConnectTimeout`):
  read-only check (no dorayaki files, 1.3 TB free, Martin active), `scp` to
  `/home/stars/data/.dorayaki-numazu.pmtiles.new.<rand>`, size and sha256
  verified on the host (603,132 B, `7c3ce0b1…d643b017`), then `mv -n` to
  `dorayaki-numazu.pmtiles`.
- Martin registered it with no restart. `https://stars.optgeo.org/dorayaki-numazu`
  returns a TileJSON (minzoom 18, maxzoom 19, the attribution from the
  PMTiles metadata). z18 and z19 tiles come back as
  `application/vnd.maplibre-tile` with the exact sizes (122,294 and 479,894 B)
  and the producer's sha256. Out-of-range tiles are 404. CORS echoes the
  request origin (`https://dwg7.unopengis.org` and a local origin were
  checked). Responses are cached for 4 hours (`max-age=14400`).
- Martin 1.14.0 read the archive with gzip directories and raw MLT tiles, as
  predicted. A `?cb=` query on the TileJSON request is copied into the
  `tiles` template it returns; without a query the template is clean.
- The demo page (built with `DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu`)
  loads Numazu from stars: 2 tiles, 602,188 B, 37,628 splats. Fetch from
  stars 235 ms, decode 14.7 ms, upload 13.5 ms (Apple M1, local page, remote
  data), with no console errors.

## 2026-11-15 — high elevation: the camera is relative to sea level; Virtual Shizuoka survey

Observed with a debug offset (`?dz=<metres>` raises every tile; demo only,
`SurfelLayer.setZOffset`) on the local Numazu tileset at zoom 17.6, pitch 0
and 60. The splats disappear at +300 m and above (and from +200 m at pitch
60, where they move off the top of the screen). Reading
`defaultProjectionData.mainMatrix` in the page, the clip-space `w` of a point
over the tile centre falls linearly with its height, from 985.5 at z = 0 to
0 at about z = 318 m, and is negative above that. So MapLibre places the
camera about 318 m above sea level at this zoom, and any splat higher than
that is behind it. The camera altitude scales with 2^(−zoom): roughly 950 m
at zoom 16, 120 m at zoom 19, 60 m at zoom 20 (extrapolated, not measured).
Cause: MapLibre's camera is positioned above z = 0 of the (flat) basemap;
it does not know that the data is hundreds of metres higher. Consequences
for high ground (a dam at several hundred metres): the data vanishes or is
magnified wildly when the camera is close, and it floats that many metres
above the flat basemap. Not yet tried: subtracting a per-tileset base
elevation in the layer (for a flat basemap), or MapLibre terrain.

Virtual Shizuoka bucket (`virtual-shizuoka.s3.ap-northeast-1.amazonaws.com`,
public listing): `2019`–`2022`, `2025`; per year some of `ALB` (airborne
laser bathymetry), `LP` (airborne laser), `MMS`, `Backpack`, `UAV`, `MISC`.
2019 MMS ground points cover mesh zone 08 only: 1,795 zips, 1.56 TB. Mesh
codes `08NE2701` decode as: 50 km-class cell `NE` (30 km north-south,
40 km east-west; zone VIII, row `A` starts at X = +300 km, column `A` at
Y = −160 km), then a 5000-scale cell `27` (3 km × 4 km, row then column from
the north-west), then a 300 m × 400 m sub-cell `01`. This reproduces the
Numazu mesh. By this rule the Kawazu loop bridge (34.7917 N, 138.9390 E;
plane coordinates X = −133,954, Y = 40,173) is in `08OF4060`: the 2019 MMS
zip is 2,940 MB, 14–15 bytes per point at Numazu's zip ratio suggests
on the order of 200 million points (estimate, not read). The current LAS
reader loads a whole file, which that size rules out. ALB 2019 covers
`08NE`, `NF`, `OE`, `OF`, `PE`; none of the survey data has been downloaded
beyond Numazu's `08NE2701`.

## 2026-11-15 — MapLibre terrain and the custom layer (mapterhorn-japan-bridge)

Debug flag `?terrain=<exaggeration>` in the demo adds a `raster-dem` source
from `https://stars.optgeo.org/mapterhorn-japan-bridge` (Terrarium, WebP,
minzoom 0, maxzoom 16, GSI DEM tiers) and calls `map.setTerrain`. Observed
with MapLibre GL JS 6.16.0, local Numazu tileset, mostly zoom 18–21:

- The custom layer still draws and its matrix is still in true elevation.
  With terrain on, the camera follows the terrain under the map centre. In
  the page, the clip `w` of a point at ground level was 985–1020 at zoom 18
  and 20, pitch 60, whether the ground was at 7.6 m (Numazu) or 3,770 m
  (Mt Fuji summit); a point at sea level was far away (`w` 8,735 at the
  summit, zoom 18). Without terrain the camera was relative to 0 m (see the
  entry above). So terrain does the job of a base elevation, and a splat's
  z needs no offset when it is on the terrain.
- The DEM and the point cloud agree here: the terrain elevation at the data's
  centre is 7.59 m; the splats' ground is at about 7.5 m. Splats and the
  basemap (draped on the terrain) line up with no visible gap at pitch up
  to 82°.
- Terrain exaggeration is not applied to splats. At exaggeration 3 the
  terrain at the data was 22.8 m, the splats stayed at 7.5 m, and they were
  hidden inside the terrain.
- That burying is a depth test against the terrain mesh, not the
  background colour: making the basemap's `background` colour transparent
  (`rgba(0,0,0,0)`) left the splats hidden, and switching the layer's depth
  test off made them visible. (Only the `background` layer's colour was
  tried, not other fills.)
- Unexplained: with terrain on there were rows of blue-tinted dots near the
  building (top of the view at zoom 21, pitch 70), also with depth test off.
  They were not seen without terrain. Not investigated.

Not checked: stability while panning and zooming over steep terrain with
real data at high elevation (there is none locally), the cost of terrain on
frame time, and globe projection.

## 2026-11-15 — Kawazu loop mesh `08OF4060` downloaded and its header read

Downloaded `08OF4060.zip` (2,939,949,911 B, SHA-256 `3c1403f1…4f9c24`, from
`2019/MMS/Ground/08/OF/40/` of the Virtual Shizuoka bucket) into `data/`
(not committed). It holds one file, `08OF4060.las` (6,684,694,805 B).
Header, read by streaming the first 375 bytes out of the zip (not extracted):
LAS 1.2, point format 3 (RGB + GPS time, 34 bytes per record), producer
Aero Asahi Corp., **196,608,664 points** (the 200 million estimated from the
zip size). Scale 1 mm. Plane rectangular zone VIII bounds: easting
40,001.8–40,380.4 m, northing −134,100.0 to −133,800.0 m (379 m × 300 m, so
the mesh is nearly full and the loop bridge, X = −133,954 / Y = 40,173, is
inside), height 177.1–245.2 m (68 m of relief). Mean density about 1,700
points per m², one fifth of Numazu's 8,700 per m² but 200 times the points.
Not yet read: colour content, classification, the actual distribution of
points over the loop bridge.

## 2026-11-15 — streaming voxelisation of the Kawazu mesh (196.6 million points)

`VoxelAccumulator` (`src/pointcloud/voxel-accumulator.ts`) feeds points one at
a time into a typed-array hash table; `npm run measure:stream` reads a LAS
file in 64 MB chunks. Checks and measurements (Apple M1, Node 22):

- On Numazu (`08NE2701`) it reproduces the in-memory counts exactly:
  29,989 voxels at z19 (12.2 cm) and 7,639 at z18, the same as the demo
  draws. A unit test compares it with `fitVoxelGaussians` on synthetic points
  (positions to 1e-9, scales and colours to 1e-6, same supports).
- On `08OF4060` (196,608,664 points, 6.68 GB LAS) one pass with both grids
  took 22.2 s (8.8 million points per second), peak RSS 0.81 GB.
  Occupied voxels: 1,232,293 at z18 (24.5 cm, 160 points per voxel) and
  4,384,382 at z19 (12.3 cm, 45 points per voxel).
- So the coarse profile for this mesh would hold about 4.4 million splats at
  z19, about 70 MB of 16-byte records before tile overhead, plus 1.2 million
  at z18. Against COPC the ratio is not measured here; Numazu's COPC was 5.3
  bytes per point, which would put this mesh's COPC near 1 GB (extrapolation,
  not a measurement), so the ratio would be of the order of 0.07.
- The accumulator is not the limit; what comes after it is. 4.4 million
  Gaussians as JavaScript objects, then placed splats and tile splitting, are
  a few GB of heap. Next: fit and write one tile at a time.

## Kawazu mesh 08OF4060 at 50 cm and 25 cm (2026-11-15)

`npm run build:tileset` (scripts/build-tileset.ts) streams a LAS file into one
accumulator per voxel size and builds the pyramid from them
(`buildPyramidFrom`); one level per tile, cells = tile width / 512 at each zoom.
Run on the 196.6 M-point Kawazu MMS mesh (zone 8), built and viewed with
`?terrain=1`:

| set | zooms | cell at maxzoom | splats at maxzoom | all tiles | build time, RSS |
| --- | --- | --- | --- | --- | --- |
| `kawazu-50cm` | z16, z17 | 49 cm | 318,817 | 6.33 MB (6 tiles) | 20 s, 0.68 GB |
| `kawazu-25cm` | z16, z17, z18 | 24.5 cm | 1,232,293 | 26.0 MB (13 tiles) | 36 s, 1.46 GB |

- The 50 cm estimate (about 6 MB for the finest level) matched: z17 is 5.1 MB.
  Against the extrapolated COPC of about 1 GB these are about 0.006 and 0.026
  (the COPC size is itself an extrapolation, not measured).
- On Numazu the streaming builder gives the same splat count per tile and the
  same x, y. About 6 % (z18) to 12 % (z19) of the records differ in the
  last bit of z (1 mm), a colour level or the rotation code, from a different
  summation order. It is not byte-identical.
- Looked at at zoom 17.3 and 18.6, pitch 45–55: both show the loop, the
  pillars and the trees. 50 cm is visibly coarser: lane markings and the
  railings blur into patches, tree crowns become blocks. 25 cm keeps the road
  surface and the pillar shapes. Judged by eye in one browser; no frame time
  or image metric was taken.

## 2026-11-15 — Slow loading in the browser pane was the hidden pane

While comparing Kawazu sets the demo page sat on "loading..." for 30 to 60 s.
`performance.getEntriesByType("resource")` showed all requests to the local
server and to stars finished within 0.2 s, then nothing until the DEM TileJSON
request (made in `map.on("load")`) started at 60.3 s. The page's own timings
(`dorayaki.report()`) were small: fetch 97 ms, decode 669 ms, upload 103 ms for
388,755 splats (6.2 MB). The Browser pane was hidden (`tabs_context` said so);
a hidden page runs as a background page and its animation frames are throttled,
and MapLibre's `load` waits for a rendered frame. After showing the pane and
reloading, `load` fired at 447 ms, and fetch 132 ms, decode 90 ms, upload
84 ms, the page ready within about 10 s (the check happened after a 10 s wait).
So the slowness was a property of measuring in a hidden pane, not of the demo.
What it does not show: behaviour on a slower GPU or phone, or with tile counts
far above 6; the demo still fetches and uploads every tile at start.

## 2026-11-15 — dorayaki-kawazu.pmtiles on stars; Martin 1.14 does not read gzip MLT tiles

- The first archive (Surfel Block v5, gzip tiles, 15,952,873 B) was uploaded
  with hfu authenticating. Martin did not register it: its log
  (`systemctl --user status martin`; `/home/stars/martin.log` is old) said
  `reload apply failed; retaining baseline for retry error=PmtilesError(
  InvalidMetadata("Format Mlt and compression Gzip are not yet supported"))`, and
  `/dorayaki-kawazu` was 404 (Martin's catalog lists a source only when it
  loads). The file was replaced by a raw-tile archive (23,357,992 B, SHA-256
  `042e4dce...b3dbc`), which Martin registered within seconds.
- Served tiles equal the local files byte for byte; Cloudflare does not
  compress them in transit (6,333,031 B for the largest tile with
  `Accept-Encoding: gzip, br`).
- The Pages site was rebuilt with both tilesets listed from stars. Numazu is
  still a version 4 archive on stars; the version 5 decoder reads it (37,628
  splats). Kawazu loads with terrain and splat scale 1.3 by default.
- A browser pane that has been hidden again between steps stalls MapLibre's
  `load` (no basemap or DEM request is made); show the pane and reload.

## 2026-11-16 — nine-mesh area on stars; the demo streams tiles; the terrain is lowered 2 m

- `dorayaki-kawazu-area.pmtiles` (132,030,481 B, 46 tiles) is on stars. The first
  `ssh spacex.optgeo.org` of the day timed out at 180 s while the Cloudflare Access
  window waited for hfu; with `ConnectTimeout=300` it passed once he approved.
- The demo now fetches only the tiles in view (nearest nine of the selected zoom)
  and swaps the set when complete. Before it, `?fixture=kawazu-area` requested all 46
  tiles (132 MB; fetch 0.8 s, decode 3.2 s, upload 2.1 s locally); after it, zoom 16.4
  requested 9 tiles (25.8 MB) and the zoom 17.6 view 12 (59 MB, now capped at 9).
- Terrain: the DEM is up to 2.4 m above the point cloud's ground (E010); the demo
  lowers it by 2 m (`?terrainshift=`). MapLibre's `raster-dem` custom encoding takes
  `baseShift` with the opposite sign to what the name suggests (elevation = decoded -
  baseShift).
- `map.once('idle')` never fired on the demo page (the custom layer keeps repainting
  or the terrain keeps loading), so a script that awaits it hangs; use a timeout.
- Later on 2026-11-16, at hfu's request, stars was left with one Kawazu archive:
  `dorayaki-kawazu.pmtiles` (single mesh, 23,357,992 B) was removed and
  `dorayaki-kawazu-area.pmtiles` renamed over it (`rm`, 8 s, `mv -n`). The new source
  appeared within the first poll, its tiles equal the local files, and
  `dorayaki-kawazu-area` returns 404 (TileJSON and tile). The local copies were renamed
  alike: `demo/tiles/kawazu` is the area, `kawazu-single` the first version. Until the
  PR that changes the demo is merged, the live site (which fetches every tile of a
  TileJSON) loads the 132 MB archive in full.

## 2026-11-16 — after the merge: stale tiles at the edge; the TileJSON URL is versioned

Checked the live site (`dwg7.unopengis.org`) after PR #12 was merged: the page code was
new, but it drew the old single mesh (4 tiles, 550,330 splats). Cloudflare served
the old `dorayaki-kawazu` tiles (age about 1,770 s, `cf-cache-status: HIT`) for the
live origin, and cached 404s for tiles that now exist: 20 of 46 tiles stale; other
origins and `?cb=` saw the new files. The TileJSON itself had expired and was fresh.
`https://stars.optgeo.org/dorayaki-kawazu?v=20261116` returns a tile template with
`?v=20261116`; those URLs returned the new tiles (MISS). The site is built with that
URL. Lesson: after replacing an archive under an existing name, check the live origin
with `curl -sI -H 'Origin: https://dwg7.unopengis.org' <tile>` and bump `?v=`.

## 2026-11-16 — zoom-out instability: heap and lost contexts (E011)

- Decoded `Splat` objects were retained after upload (about 280 bytes per splat: 739 MB at
  z17, 1,058 MB right after z17 to z16). Now instance data (56 bytes per splat) is built at load
  and dropped after upload: 420 MB fresh at z17, 229 to 383 MB over a zoom sequence.
- After `WEBGL_lose_context` loseContext/restoreContext the `surfels` layer was gone from the style
  and never came back (MapLibre 6.16.0 restores its own layers only); the demo now adds a new layer
  on `webglcontextrestored` and reloads the tiles (1.9 s).
- The per-zoom sparse threshold factor is 10 from now on (111.0 MB for nine meshes against
  132.0 MB with 4; the z16 view of the showcase angle is 10.8 MB instead of 26.9 MB).
- Tooling: a script run in the pane executes in the *fronted* tab; after the user clicks another tab
  it silently runs there. Pass `tabId` to `javascript_tool` and `tabs_select` first.
