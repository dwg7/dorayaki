# Adaptive merging and gap coverage

Status: implemented (`src/pointcloud/adaptive.ts`, demo `?extent=`), measured
on one 196.6-million-point mesh (Kawazu MMS). Experiments E005 and E006 in
[EXPERIMENTS.md](../EXPERIMENTS.md) hold the measurements; this page is the
design in one place. Nothing here is part of the wire format: the result is an
ordinary list of splats of different sizes in one level.

## The problem

A uniform grid spends the same number of splats on a flat road as on a tree
crown. At 49 cm cells (z17) Kawazu is 318,817 splats, 6.33 MB with z16. At
24.5 cm (z18) it is 1,232,293 splats, 26.0 MB.

## Adaptive merging

Starting from the occupied voxels of a streaming accumulator, each merge
level doubles the cell size. The occupied children of a parent cell are
combined exactly (parallel-axis moments, so the merged Gaussian is the fit of
all its points) and replaced by one Gaussian when

1. the smallest standard deviation of the merged points is at most
   `thickness` (the patch is still flat, or a line), and
2. every child's mean color is within `color` of the merged mean, per channel.

A parent that fails keeps its children and blocks every larger ancestor, so
splats of different sizes never overlap. A parent with one child passes
upwards unchanged so that it can still merge with neighbours later.

A third rule, the **sparse rule** (E008): a parent is also merged when every
child is supported by fewer than `sparseSupport` points, whatever the
thickness and color. A voxel supported by a handful of points carries little
more than the points; this is how vegetation volume is kept small (at 24
points, MMS + all airborne returns of Kawazu fall from 73.4 MB uniform to
20.0 MB). Merging applies to every zoom of the pyramid. A coarser zoom has cells of 4 times
the area, which hold about 4 times the points, so the threshold is multiplied by
`DORAYAKI_ADAPTIVE_SPARSE_SCALE` (4 in the recipe) for each zoom below the
maxzoom: without it, the zooms below z17 held nearly as many splats as z17 (E009);
with it, the whole pyramid is 0.34 times the z17 size instead of 1.2 times.

Environment variables of `npm run build:tileset`: `DORAYAKI_ADAPTIVE_LEVELS`
(merge levels; enables the feature), `DORAYAKI_ADAPTIVE_REFINE` (start from
cells 2^refine times finer than the maxzoom's), `DORAYAKI_ADAPTIVE_THICKNESS`
(metres, default 0.05), `DORAYAKI_ADAPTIVE_COLOR` (default 0.1), `DORAYAKI_ADAPTIVE_SPARSE` (default 0 = off).
`npm run measure:adaptive -- <file.las> <zone> <base cell metres> <levels>`
prints splat counts for a grid of limits without writing tiles.

### What was measured

- With a strict limit (5 cm) merging removes only 11 % (49 cm base) to 20 %
  (24.5 cm base) of the splats: most voxels here (trees, railings, walls,
  scanner noise) are not flat to 5 cm.
- A uniform 49 cm cell is itself up to 14 cm thick (cell / sqrt(12)), so a
  20 cm limit is not looser than the uniform grid. Starting from 24.5 cm cells
  with thickness 20 cm and color 0.2 gives 311,871 splats (6.22 MB), the same
  as the uniform 49 cm set (318,817; 6.33 MB), with the lane markings of the
  loop road visible in the adaptive one and blurred in the uniform one.
- In four oblique views no failure that the uniform 49 cm set does not already
  have was found. Not examined: railing close-ups, roof edges, airborne data.

## Gaps between splats

A splat is the 2-sigma ellipse. A square cell of side `s` filled evenly has a
standard deviation of `s / sqrt(12)` = 0.29 `s`, so the ellipse's semi-axis
(2 sigma) is 0.58 `s`, but the cell's corner is 0.71 `s` from its centre.
Neighbouring splats on a square lattice therefore leave a hole at every
corner, which shows as a regular pattern of white gaps on a road seen
obliquely. Covering the corners needs a factor of 0.71 / 0.58 = 1.22.

The demo has a debug flag `?extent=<factor>` that scales every splat's
semi-axes (`u_extent` in the shader). It is a drawing choice, not stored in
the data. The share of near-white (background) pixels in a screen rectangle
over the road (`dorayaki.holeFraction(rect)` in the page), at the close-up
view zoom 20.5, bearing -30, pitch 60:

| extent | uniform 49 cm | adaptive (20 cm, 0.2) |
| ---: | ---: | ---: |
| 1.0 | 5.05 % | 5.42 % |
| 1.2 | 1.24 % | 1.67 % |
| 1.3 | 0.97 % | 1.37 % |
| 1.5 | 0.62 % | 0.88 % |

Two other views (zoom 20.3 and 20.0) fall in the same direction but less: the
share has a floor from real gaps (foliage, sky) in the rectangle. The factor
also thickens thin structures and widens the overlap at edges; that cost was
not measured. A value near 1.3 is the working candidate; it is not the
default yet.
