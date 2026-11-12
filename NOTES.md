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
