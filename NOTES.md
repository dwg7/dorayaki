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
