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
