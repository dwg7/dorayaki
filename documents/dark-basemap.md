# Dark basemap for the splat demo (proposal)

Status: **proposed** (name chosen: `bvmap-nightsky`), with one prototype measured in the demo. Nothing here is hosted or part of bvmap yet.

## Why

The demo draws splats over the bvmap-starlight basemap, which is light (white background, white `AdmArea` fill, silver
grays). Where the splats are missing (camera close to a slope, the edge of the data, tiles still loading) the screen
shows white, which reads as a broken page (NOTES.md, 2026-11-22). The mean color of the splats on screen in Kawazu was
rgb(68, 71, 67) (z18.5, pitch 60), an almost neutral dark olive gray. A basemap close to it makes gaps look like more
ground.

## What was tried (demo only, nothing committed upstream)

1. Dark container and background only: the white became light gray. The white comes mostly from the 11 `fill` layers
   (`AdmArea` white, water, buildings), which the demo also fades to 20 % at zoom 19.
2. Also recoloring those 11 fills to `#2f3a30`: the gaps became dark olive. Roads and contours stayed visible.
3. A mechanical night version of the whole style (`?basemap=<style URL>` in the demo): every `rgba()` literal in the
   published bvmap-starlight style is mapped by its lightness `t` (0 black, 1 white) to
   `dark + (1 - t) * (light - dark)` with dark `#2f3a30` and light `#eaedea`, alpha kept. White becomes dark green, black
   becomes near white, the ordering of the grays is reversed, so a road that was darker than the ground is now lighter
   than it. Looked right at zoom 20 and 15.2 in Kawazu. Not checked: labels in a dense area (none in the view), sprite
   icons (the starlight sprite is dark gray icons on transparent, so they will not show on dark), the zoom 4-7 land/sea
   swap, and every layer one by one.

## Where a real dark style belongs

bvmap-starlight is generated: `dwg7/bvmap` `generator/starlight-input.yaml` (about 28 palette tokens, categories,
priority chains, `patches`; 9 layers still literal) through `assemble.py`; `dwg7/bvmap-koicha`
`style/make_koicha_starlight.py` builds the koicha style from a snapshot of the published starlight style; `hfu/stars`
serves both. Notes for the sessions that own them:

- A dark variant is mostly a second palette. The colors in `starlight-input.yaml` are tokens, and the mechanical test
  above shows a lightness reversal with a green tint is enough as a first pass. Reading rules to settle there, not here:
  the `background` step expression (zoom 4-8 gray, which paints sea against the white `AdmArea`), text halos (7 symbol
  layers use white; they must become dark), the 9 literal layers, the tokens that two layers share on purpose.
- `bvmap-dark.json` in `dwg7/bvmap` is the GSI style under a misleading name (white background); a new dark style should
  not reuse that name.
- The sprite needs a light-on-dark version (`generator/sprite_grayscale.py` makes the starlight one from the GSI sprite;
  a night one is its inverse).
- koicha: its style would be generated from the dark variant in the same way; tiles are unchanged.
- Whether the variant also gets the splat-friendly settings of the demo (fade, a green tint chosen from the data) is a
  design question for bvmap, not for this repository.

## Name

Starlight names the palette (low saturation, bright, silver gray). The general-purpose dark style that is kept beside it
is named **`bvmap-nightsky`** (chosen by the owner on 2026-11-22; the other candidates were `bvmap-midnight` and
`bvmap-moonlight`). The tea names stay with koicha (the tile set), so a koicha style from it would follow koicha's own
naming rule (D20), which is for that repository to settle.

## Next steps (not started)

1. Send this note to the bvmap session (palette, halo, sprite) and the koicha session (generated style); neither session was running on 2026-11-22.
2. Prototype as a second palette in `starlight-input.yaml`; compare with the mechanical version above.
3. Then publish through hfu/stars, with the owner's approval, and point the demo at it.
