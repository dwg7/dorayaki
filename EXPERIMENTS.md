# Experiments

One entry per experiment: the question, the baseline, what was measured,
what was observed, and the decision. `NOTES.md` stays the chronological
log; this file collects the measured comparisons. Fields that were not
measured say so. They are not left blank.

## E001: Naive 32-byte AoS surfels

### Question

Can a conventional z/x/y tile carry enough fully 3D surfels for an
interactive MapLibre proof of concept?

### Baseline

- float32 position
- float32 normal
- float32 radius
- uint8 RGBA
- no compression
- no quantization
- no intra-tile progression

Measured on Surfel Block v3. The record is unchanged from the original
32-byte layout. The v3 header (16 bytes, plus a 4-byte table holding one
level) is 8 bytes longer than v1's 12-byte header. A single-level table
means no intra-tile progression.

### Fixture

bridge: ground, deck, underside, two four-faced piers. The demo tile is at
Sapporo Station, z18/234000/96256, 111.7 m wide.

### Measurements

- surfel count: 432
- encoded bytes: 13,844 (Surfel Block); 13,877 as the served tile (MLT
  frames, including one synthetic unknown frame)
- decode time: 0.136 ms; encode 0.137 ms (median of 50 runs, Node
  v22.19.0, `npm run measure:codec`). Browser decode: not measured.
- GPU upload time: not measured. The demo now records it (`onAdd`,
  including `gl.finish()`); read it with `dorayaki.report()` in the
  page's console.
- frame time: not measured. The demo now measures it with
  `await dorayaki.measureFrames(120)`: median frame interval and median
  CPU time of the surfel layer's `render()`. GPU time is not measured.
- browser and hardware: codec timings from Node v22.19.0 on an Apple M1
  (8 cores, 8 GB, macOS 27.2.1). Browser figures are pending. The Claude
  browser pane was hidden during this session, and in that state MapLibre
  never fires `load`.

### Observation

- In earlier sessions the bridge rendered at its geographic position in
  Chromium (Claude desktop browser pane), with pan, zoom, bearing and
  pitch working. Deck, underside and piers stayed distinct, and the depth
  test held (NOTES.md, 2026-11-12).
- At this scale, size and codec time are not constraints: 14 KB and about
  0.14 ms.

### Decision

Retain the 32-byte AoS record as the baseline. Constraints first appear
with real point-cloud data (E002), not with synthetic fixtures.

### Follow-up (2026-11-15, Surfel Block v4)

The record is no longer the 32-byte disc: v4 stores a 16-byte quantized
splat (E004's baseline). The v3 numbers above remain the 32-byte baseline;
v3 is in git history (commit `f43af71` and later, until the v4 commit).

- bridge, v4: 432 splats, 6,948 B block (50.2 % of the v3 block), 6,981 B as
  the served tile. Node codec: encode 0.73 ms, decode 0.27 ms
  (`npm run measure:codec`, median of 50). Encode is slower than v3 because
  the quaternion encoder tries 8 rounding combinations per splat.
- Browser (Claude desktop browser pane, Chromium; GPU string `ANGLE (Apple,
  ANGLE Metal Renderer: Apple M1)`): fetch 17.8 ms, decode 2.2 ms (first
  call, cold JIT, includes MLT frame extraction), GPU upload 2.6 ms
  (program creation, buffer upload and `gl.finish()`), from
  `dorayaki.report()`.
- Frame time: still not measured. `dorayaki.measureFrames()` timed out after
  20 s: the pane reports `document.visibilityState = "hidden"`, so
  `requestAnimationFrame` does not run continuously, although single frames
  do render once the tab is fronted.

## E002: Omitting weakly supported surfels in maxzoom tiles

### Question

Can omitting weakly supported surfels in maxzoom tiles bring the Numazu
tile pyramid below the COPC of the same points, without opening holes in
coverage?

### Baseline

Surfel Block v3. z18 and z19 aggregated tiles. z20 maxzoom tiles hold the
finest Gaussians (1.53 cm voxels, z22 detail) in 3 nested refinement levels
(`documents/progressive-maxzoom.md`). Nothing omitted: z20 = 16,396,888
bytes, 3.16× COPC.

### Fixture

VIRTUAL SHIZUOKA MMS mesh 08NE2701 (Numazu; 976,195 points; CC BY), one
Gaussian per voxel. COPC reference: PDAL `writers.copc` with only
xyz+rgb kept, 5,183,226 bytes (5.31 B per point).

### Measurements

`npm run measure:omission`. Support = number of source points in a
finest Gaussian's voxel. Of 512,401 finest Gaussians, 321,545 (63 %) have
support 1; support 2: 80,074; 3: 40,711; 4: 27,580; 5: 17,368; 6: 9,507;
7: 8,380; 8 or more: 7,236.

| strategy | min support | kept | z20 bytes | × COPC | level-0 cells covered |
| --- | ---: | ---: | ---: | ---: | ---: |
| none | — | 512,401 | 16,396,888 | 3.16 | 100 % |
| (a) global: drop before ordering | 2 | 190,856 | 6,107,448 | 1.18 | 33.8 % |
| (a) global | 4 | 70,071 | 2,242,328 | 0.43 | 12.3 % |
| (b) last level only | 2 | 383,062 | 12,258,040 | 2.36 | 100 % |
| (b) last level only | 8 | 261,165 | 8,357,336 | 1.61 | 100 % |
| (c) all refinement levels, level 0 whole | 2 | 273,132 | 8,740,280 | 1.69 | 100 % |
| (c) | 4 | 164,804 | 5,273,784 | 1.02 | 100 % |
| **(c)** | **6** | **123,016** | **3,936,568** | **0.76** | **100 %** |
| (c) | 8 | 106,351 | 3,403,288 | 0.66 | 100 % |

With (c) at support 6, as built by `npm run demo:numazu`:

- z18: 244,502 B (7,639 Gaussians)
- z19: 959,702 B (29,989 Gaussians)
- z20: 3,936,637 B (levels 99,660 / 8,416 / 14,940)
- whole pyramid: 5,140,841 B, **0.99× COPC**

Decode time (Node, median of 50): z19 tile 5.8 ms (29,989 surfels); the
larger z20 tile 22.7 ms (92,313 surfels), about 0.25 µs per surfel. Browser
decode, GPU upload and frame time: not measured (see E001).

### Observation

- Most finest Gaussians stand on a single point. They carry no shape
  (NOTES.md 2026-11-13) and are the bulk of the bytes.
- (a) is effective for size but destroys coverage. Weak cells vanish at
  every level, so the z20 view gets holes.
- (b) keeps coverage but cannot go below levels 0–1 (1.59× COPC).
- (c) keeps every level-0 cell and thins only the added detail. At
  support 6 the whole pyramid is just under COPC.
- Level 0 of z20 (99,660 Gaussians, 3.19 MB at 32 bytes) is now the floor.
  Further reduction needs a smaller record (v4), not more omission.
- Decoding into one JS object per surfel costs about 0.25 µs per surfel.
  Decoding straight into GPU-ready typed arrays would avoid it.
- Not yet checked: how z21–z22 views look with the thinned refinement
  levels.

### Decision

Adopt (c) with minimum support 6 for the Numazu tileset. It is a
producer choice (`omitWeakRefinements` in `src/progressive.ts`); the wire
format does not change. The threshold is set by `DORAYAKI_MIN_SUPPORT`.
The tileset is distributed as one PMTiles archive (`dorayaki-numazu.pmtiles`,
5,141,899 B), to be hosted on stars, not committed to `docs/`.
Next: coarser Gaussians and a compact record (E003, v4), measured against
the same COPC reference.

Update (2026-11-15): E004 compared the thinned `fine` pyramid with coarser
ones in Surfel Block v4 and chose a single-level pyramid for the hosted
Numazu tileset. The omission rule stays available (`fine` profile).

Note (2026-11-14): these runs floored every Gaussian's scales at a quarter
voxel. E003 found that this erases the thin axis of planar voxels. Counts,
supports and bytes above do not depend on it; shape statistics do.

## E003: Coarser Gaussians, and what anisotropy buys

### Question

The maxzoom tiles reproduce the point cloud closely, but cost about 5 MB.
If surfels are produced more coarsely, how much smaller does the data get,
how much fidelity is lost, and does keeping the Gaussian's anisotropy (as
3DGS does) do better than the current circular disc?

### Baseline

One Gaussian per voxel; the current record collapses each Gaussian into a
circular disc (normal = shortest axis, radius = 2·sqrt(s_a·s_b)), 32 bytes.

### Fixture

VIRTUAL SHIZUOKA MMS mesh 08NE2701 (Numazu, 976,195 points). COPC reference
5,183,226 B (xyz+rgb).

### Measurements

`npm run measure:coarse`. Voxel = tile width / 512 at the zoom whose detail
it targets. For each Gaussian, the voxel's own points are tested against the
splat's shape:

- disc: a circle of radius 2·sqrt(s_a·s_b);
- ellipse: the in-plane 2σ ellipse, which has the same area (4π·s_a·s_b);
- both use the same thickness test, |distance along normal| <= 2 s_min.

"Plane residual" is the RMS distance of points from their Gaussian's plane.
Byte ratios use 32 B (current), and estimates of 12 B for a compact disc and
16 B for a compact ellipsoid (proposed records, not implemented).

| detail | voxel | Gaussians | points / G | flat | mean anisotropy | plane residual | disc coverage | ellipse coverage | 32 B × COPC | 12 B disc × COPC | 16 B ellipsoid × COPC |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| z21 | 3.1 cm | 259,440 | 3.8 | 28 % | 1.69 | 0.21 cm | 83.3 % | 91.4 % | 1.60 | 0.60 | 0.80 |
| z20 | 6.1 cm | 99,926 | 9.8 | 46 % | 1.76 | 0.36 cm | 87.3 % | 91.3 % | 0.62 | 0.23 | 0.31 |
| z19 | 12.2 cm | 30,057 | 32.5 | 51 % | 1.96 | 0.79 cm | 86.2 % | 88.9 % | 0.19 | 0.07 | 0.09 |
| z18 | 24.4 cm | 7,650 | 127.6 | 52 % | 2.60 | 1.75 cm | 85.6 % | 88.3 % | 0.05 | 0.02 | 0.02 |

Scales are floored at 1 mm, or at a quarter voxel only for voxels with
fewer than 3 points. A first run floored every voxel at a quarter voxel. It
showed 0 % flat Gaussians and anisotropy of about 1.15 at every size: the
floor had erased the thin axis.

### Observation

- Coarsening is effective for size: each zoom step down cuts the count by
  2.6–3.9×, and the plane residual stays about 6–7 % of the voxel size, so
  under a pixel at the zoom the voxel is meant for.
- Coarse voxels are more surface-like: the flat share rises from 28 % to
  52 % and anisotropy from 1.7 to 2.6. That is the shape a circular disc
  throws away.
- At equal area, the anisotropic ellipse covers more of its points than the
  disc at every size (+8.1, +4.0, +2.7 and +2.7 points). A 12 cm ellipse
  (16 B, 0.09× COPC) covers more (88.9 %) than a 6 cm disc (12 B, 0.23×
  COPC, 87.3 %) at about 40 % of the bytes.
- Coverage of a voxel's own points favours larger shapes; the plane
  residual is the counterweight. Rendering quality is not yet compared.
- The 2026-11-13 finding "finest Gaussians are round (0 % flat)" was partly
  this floor artefact. With the corrected floor, 4.6 % of the 1.53 cm
  Gaussians are flat; most of them still stand on 1–2 points.

### Decision

Pending hfu's direction. Proposed next step: v4 record = compact anisotropic
Gaussian (quantized position, 3 log scales, quantized rotation, RGBA8;
about 16 B). Then a Numazu pyramid whose maxzoom stops at coarser detail
(z19–z20 voxels instead of point-level), compared visually and by size
against the current tiles. The scale-floor fix is adopted now
(`degenerateScale` in `src/pointcloud/voxel-gaussians.ts`).

## E004: Coarser Numazu pyramids in Surfel Block v4

### Question

Surfel Block v4 (16-byte anisotropic splats) halves the size of the same
tiles. Producing the surfels more coarsely should shrink the data further:
by how much, and what does it cost in how the data looks?

### Baseline

Numazu mesh 08NE2701 as in E002, with the `fine` profile: z18 and z19
aggregated; z20 maxzoom with 3 nested levels (6.1, 3.1 and 1.5 cm cells),
refinement Gaussians with fewer than 6 points omitted. In v3 (32-byte
records) it was 5,141,899 B as PMTiles.

### Fixture

VIRTUAL SHIZUOKA MMS mesh 08NE2701 (Numazu, 976,195 points, CC BY). COPC
reference 5,183,226 B (xyz+rgb).

### Measurements

`DORAYAKI_NUMAZU_PROFILE=<name> npm run demo:numazu`. All use v4, 16-byte
records, gzip PMTiles directories.

| profile | pyramid | splats | tile bytes | PMTiles | × COPC | bytes per source point |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| v3 `fine` (reference) | z18, z19; z20 × 3 levels, support ≥ 6 | 160,644 | 5,140,841 | 5,141,899 | 0.99 | 5.27 |
| `fine` | the same, v4 | 160,644 | 2,570,600 | 2,571,701 | 0.50 | 2.63 |
| `medium` | z18, z19; z20 one level (6.1 cm) | 137,684 | 2,203,224 | 2,204,268 | 0.43 | 2.26 |
| `coarse` | z18; z19 one level (12.2 cm) | 37,628 | 602,188 | 603,132 | 0.12 | 0.62 |

Per zoom (splats / bytes): z18 7,639 / 122,294 in every profile; z19 29,989 /
479,894 in `fine` and `medium`; z20 `fine` 123,016 / 1,968,412, `medium`
100,056 / 1,601,036.

Visual comparison: one camera 9 m south of the data and 12 m above sea
level, pitch 80°, looking north (`?lod=22` forces the finest tile and level
choice; see Observation).

- `fine`: close up, the surfaces read as a sparse cloud of small dots about
  6 cm apart, with gaps;
- `medium`: continuous, overlapping 6 cm splats; roof tiles, walls and the
  tree crown read as surfaces and volumes;
- `coarse`: 12 cm discs, visibly separate at 9 m, but the structure (roof,
  walls, crown) is still readable.

### Observation

- v4 halves the `fine` pyramid (5.14 → 2.57 MB), as the record halves.
- Going coarser saves more: `medium` is 14 % smaller than `fine` and
  `coarse` is 77 % smaller. Stopping at z19 puts the whole pyramid at 12 %
  of the COPC.
- The 6 cm level at z20 is most of the bytes: 1.60 MB of the `medium`
  pyramid's 2.20 MB.
- The nested refinement levels did not help at close range. In the
  `fine` tile, level 0 holds one *finest* (1.5 cm) Gaussian per 6 cm cell,
  not a 6 cm Gaussian. The renderer widens the drawn splats only to cover
  the cell of the finest level it draws. When all three levels are drawn,
  that floor is 1.1 cm, and omitted refinements leave holes. The extra
  detail costs 19 % more bytes than `medium` and looks worse.
- The hypothesis this suggests, not tested: a level should carry
  Gaussians fitted at its own cell size, so that each prefix is a complete
  surface, instead of sampled fine Gaussians.
- At 9 m from the data the map zoom stayed about 19.8, so by default the
  demo would draw z19 there. `?lod=` was added to the demo to compare
  levels fairly. Distance-based selection is still not implemented.
- Fidelity of the sampling itself is in E003: plane residual 0.36 cm at
  6.1 cm and 0.79 cm at 12.2 cm, with the ellipse covering 91 % and 89 % of
  a voxel's own points.

### Decision

Direction from the repository owner (2026-11-15): host `coarse` as
`dorayaki-numazu.pmtiles` (603,132 B). Lead with how light it is (0.12 times
the COPC of the same points, 0.62 bytes per source point), and refine
according to need afterwards. `medium` (2,204,268 B,
`dorayaki-numazu-medium.pmtiles`) is the next step up when close-up quality
matters, and `fine` stays as a profile for reference and for datasets dense
enough to need progressive levels. The default profile of
`npm run demo:numazu` is therefore `coarse`.

## E005: Adaptive merging of voxel Gaussians (Kawazu MMS, 50 cm class)

### Question

A uniform 49 cm grid (`kawazu-50cm`: 318,817 splats at z17, 6.33 MB with
z16) spends the same number of splats on a flat road as on a tree crown.
Can the splat count at that size be cut, or the detail raised at the same
count, by merging neighbouring Gaussians that are nearly coplanar and of the
same colour?

### Method

`src/pointcloud/adaptive.ts` (`adaptiveGaussians`) starts from the occupied
voxels of a streaming accumulator. For each merge level (cells double,
`size · 2^k`) the occupied children of a parent cell are combined exactly
(parallel-axis moments) and replaced by one Gaussian when (a) the smallest
standard deviation of the merged points is at most `thickness` and (b) every
child's mean colour is within `colour` of the merged mean, per channel.
A parent that fails blocks all larger ancestors, so sizes never overlap. The
result is a flat list of mixed-size Gaussians in one level, not an LOD.
Aggregated zooms (z16) are unchanged. Counts: `npm run measure:adaptive`;
tiles: `DORAYAKI_ADAPTIVE_*` with `npm run build:tileset`. Data: the Kawazu
MMS mesh 08OF4060 (196.6 M points).

### Measurements (splats at the maxzoom, share of the base voxel count)

Base 49 cm (318,875 voxels), 4 levels (up to 7.8 m cells):

| thickness | colour 0.1 | colour 0.3 | colour off |
| ---: | ---: | ---: | ---: |
| 3 cm | 91 % | 88 % | 87 % |
| 5 cm | 89 % | 84 % | 83 % |
| 10 cm | 83 % | 75 % | 74 % |
| 20 cm | 68 % | 55 % | 52 % |

Base 24.5 cm (1,232,448 voxels), 5 levels (up to 7.8 m cells):

| thickness | colour 0.1 | colour 0.2 | colour 0.3 | colour off |
| ---: | ---: | ---: | ---: | ---: |
| 3 cm | 85 % | 82 % | 80 % | 79 % |
| 5 cm | 80 % | 76 % | 74 % | 72 % |
| 10 cm | 66 % | 59 % | 56 % | 53 % |
| 20 cm | 39 % | 25 % | 20 % | 15 % |

Tiles built and viewed (zoom 18.6, pitch 55, `?terrain=1`):

| set | base | thickness, colour | splats at z17 | all tiles |
| --- | --- | --- | ---: | ---: |
| `kawazu-50cm` | 49 cm uniform | – | 318,817 | 6.33 MB |
| `kawazu-ad-t20-c20` | 24.5 cm adaptive | 20 cm, 0.2 | 311,871 | 6.22 MB |
| `kawazu-ad-t10-c20` | 24.5 cm adaptive | 10 cm, 0.2 | 725,736 | 12.84 MB |

### Observations

- With strict limits (5 cm) merging removes only 11 to 20 % of the
  splats: on this scene most 50 cm and 25 cm voxels are not flat to 5 cm
  (trees, railings, walls, MMS noise).
- A uniform 49 cm cell has a thickness of up to 14 cm (cell / sqrt(12)),
  so 20 cm is no looser than the uniform grid already is.
  At 20 cm / 0.2 from the 25 cm base, the count equals the uniform 50 cm
  set (311,871 against 318,817), while the picture shows more detail: the
  lane markings on the loop road are visible, which the uniform 50 cm set
  blurs. Judged by eye in one browser view; no image metric.
- 10 cm / 0.2 at 726k splats looks like the 25 cm set (1.23 M).
- The thickness limit is the dominant parameter; the colour limit moves
  the count by 10 to 25 points of share, mostly at 20 cm.
- Browser load of these 6 MB sets was slow (tens of seconds) in this
  session; not measured or investigated.

### Oblique check, 20 cm / 0.2 (`kawazu-ad-t20-c20`) against `kawazu-50cm` and `kawazu-25cm`

Same views for each set, `?terrain=1`, in the browser pane; by eye, no image
metric. The camera cannot get closer to the ground than the terrain allows,
so the requested pitch 70 at zoom 20.4 was clamped to 64.

- Road, zoom 19.4, bearing -30, pitch 70: all three show the road and the
  yellow centre line. `kawazu-50cm` and the adaptive set both show a regular
  pattern of white gaps on the road (the quads' ellipses do not cover the
  cell corners); `kawazu-25cm` has fewer, smaller gaps. The adaptive set is
  not worse than the uniform 50 cm one here.
- Road close-up, zoom 20.5, bearing -30, pitch 60: the adaptive road is made
  of larger ellipses with diamond-shaped gaps and a centre line that reads
  as a nearly continuous line; the uniform 50 cm road is round discs with
  round gaps and a dotted centre line. The gaps in the adaptive set are
  larger and more angular.
- Under the loop and in the trees, zoom 19.8, bearing 120, pitch 72: the
  adaptive set shows large flat dark ellipses on shadowed ground and trunks
  in the foreground, where the uniform 50 cm set shows round discs and the
  25 cm set small ones. Shapes are recognisable in all three; the adaptive
  one looks smoother on trunks and blobbier on foliage.
- Not reached: a railing close-up and roof edges (no building in the views).
  The loop's deck edge was only seen from zoom 19.2 and farther.

Reading: at 20 cm, no failure that the uniform 50 cm set does not already
have was found in these four views, and the centre line improves. The gaps
between large ellipses are the visible cost. Whether it is a real regression
needs a metric or a larger set of views.

### Not yet shown

- Whether `thickness = 20 cm` creates visible errors on thin structures
  (railings, wires) or at roof edges: not reached by the views below.
- Behaviour on airborne laser data and on merged MMS + airborne data.
- Whether the renderer's overdraw at large merged splats costs frame time.
- A merge rule that adapts thickness to the cell size.
- Size effect of compressing the result (not tried).

## E006: Covering the gaps between splats (`?extent=`)

### Question

Oblique views of a road show a regular pattern of white gaps between splats
(E005). Does drawing every splat larger than its 2-sigma ellipse close them,
and at what factor?

### Method

The demo's shader scales every semi-axis by `u_extent` (`?extent=<factor>`;
round splats scale their radius). `dorayaki.holeFraction(rect)` reads the
canvas back inside a render event and returns the share of near-white pixels
(each of R, G, B above 235, the basemap's background) in a screen rectangle.
Sets: `kawazu-50cm` (uniform 49 cm) and `kawazu-ad-t20-c20` (E005). Views at
`?terrain=1`, centre of the loop road: `close` zoom 20.5, bearing -30,
pitch 60, rectangle (x 0.35 to 0.65, y 0.55 to 0.9 of the canvas); `close2`
zoom 20.3, bearing 150, pitch 50 and `close3` zoom 20.0, bearing 60, pitch 45,
both rectangle (0.3 to 0.7, 0.5 to 0.95). The pane was visible.

### Measurements (share of near-white pixels)

| view | extent | uniform 49 cm | adaptive |
| --- | ---: | ---: | ---: |
| close | 1.0 | 5.05 % | 5.42 % |
| close | 1.2 | 1.24 % | 1.67 % |
| close | 1.3 | 0.97 % | 1.37 % |
| close | 1.5 | 0.62 % | 0.88 % |
| close2 | 1.0 | 3.99 % | 4.44 % |
| close2 | 1.3 | 1.30 % | 1.49 % |
| close2 | 1.5 | 0.98 % | 1.11 % |
| close3 | 1.0 | 6.03 % | 4.20 % |
| close3 | 1.3 | 4.73 % | 2.07 % |
| close3 | 1.5 | 4.15 % | 1.65 % |

### Observations

- A factor of 1.2 removes about three quarters of the gaps in `close` and
  `close2`; 1.3 and 1.5 remove a little more. 1.22 is the factor at which a
  square lattice of 2-sigma ellipses of an evenly filled cell would just
  cover the cell's corners (adaptive-merging.md).
- In `close3` the rectangle contains foliage and sky, so a floor of real
  gaps remains; the direction is the same.
- In the screenshot at 1.3 the adaptive road is continuous and its centre
  line is one stripe. No view with thin structures (railings) was checked
  at 1.3; the factor also thickens them and widens overlaps at edges.
- The metric counts any near-white pixel, including real gaps and bright
  road paint; it is a relative measure between factors in one view, not a
  coverage measurement.

### Not yet shown

- The cost on thin structures and silhouettes.
- Whether the factor should depend on the splat (round discs, merged cells).
- A default: the flag is off (1.0).

## E007: Merging airborne (LP) and MMS data on the Kawazu mesh, and what a surface costs

### Question

The goal is areal data: mobile mapping (MMS) where the airborne survey is
shadowed, airborne laser elsewhere. Is the size of the merged tileset
realistic, and which points are worth keeping?

### Data and method

Mesh 08OF4060 (300 m x 400 m). MMS: 196,608,664 points. Airborne LP
("Ground" product, 2019): 14,551,545 points, 121 points/m2, of which
2,492,669 are class 2 (ground) and 12,058,876 class 1; z range per
1 m x 1 m cell has a median of 16 m. `npm run build:tileset` with several
LAS files merges them into the same voxels; `@c2` / `@first` filters choose
points. Uniform 49 cm cells, z16 + z17 (the 50 cm class); the adaptive rows
start from 24.5 cm cells with the E005 rule. Bytes per m2 use the 120,526
one-metre cells that hold airborne points.

Heights: on 1,119 cells where the LP surface is locally flat (z range under
0.5 m), LP minus MMS ground has median -0.175 m (quartiles -0.19, -0.14).

### Measurements

| set | z17 splats | all tiles | per m2 | largest z17 tile |
| --- | ---: | ---: | ---: | ---: |
| `kawazu-50cm` MMS only | 318,817 | 6.33 MB | 55.7 (box) | 3.51 MB |
| `kawazu-lp-c2-50cm` | 549,337 | 11.56 MB | 96 | 4.31 MB |
| `kawazu-lp-first-50cm` | 1,641,048 | 35.03 MB | 291 | 12.44 MB |
| `kawazu-lp-50cm` (all returns) | 3,367,215 | 70.10 MB | 582 | 25.92 MB |
| `kawazu-mix-c2-50cm` | 848,755 | 17.46 MB | 145 | 7.57 MB |
| `kawazu-mix-first-50cm` | 1,855,785 | 39.08 MB | 324 | 14.87 MB |
| `kawazu-mix-50cm` (all) | 3,546,675 | 73.42 MB | 609 | 27.94 MB |
| `kawazu-mix-c2-ad-t20` (24.5 cm base, 20 cm, 0.2) | 641,362 | 14.14 MB | 117 | 6.66 MB |
| `kawazu-mix-c2-ad-t10` (24.5 cm base, 10 cm, 0.2) | 1,134,654 | 22.03 MB | 183 | 12.25 MB |

Build times 7 s to 90 s on an Apple M1 (the adaptive builds 54 and 80 s);
the adaptive build of MMS + all returns was stopped after 13 minutes.

### Observations

- MMS plus airborne ground (`kawazu-mix-c2-50cm`) shows the hillside as a
  continuous surface around the road and the loop bridge (viewed once,
  zoom 17.3, pitch 50, `?extent=1.3`; no other check).
- The airborne "Ground" file is not ground only. Keeping every return makes a
  tile of 1.6 million splats (6.2 layers over the 262,144 columns) and 582
  bytes per m2, nine times the ground class. First returns halve that.
- Adding MMS to the airborne ground adds 5.9 MB, close to what MMS alone
  costs (6.3 MB): little overlap.
- Adaptive merging saves 19 % at a loose limit (14.14 against 17.46 MB) on
  this mixed set, and none at 10 cm in this encoding (22.03 MB, more than
  uniform 49 cm, because the base is 24.5 cm).
- Taking this mesh as a scale for a 7,800 km2 prefecture (it is a forested
  slope, which inflates counts): ground only about 0.75 TB, MMS + ground
  about 1.1 TB, first returns about 2.3 TB, all returns about 4.5 TB
  (size-and-scale.md).

### Not yet shown

- First returns plus ground as a canopy shell, or a column rule (keep the
  highest and the lowest point per column).
- Adaptive merging on the canopy sets (memory and time of the merge).
- Whether airborne colours (taken from imagery?) look right next to the
  MMS colours; they were not compared.
- Any area other than this mesh; airborne data of a city or a plain.

## E008: Encoding low-hanging fruit, and what to do with vegetation

### Question

Before publishing a PMTiles archive: is there an easy gain in the encoding,
and can vegetation be kept at a much smaller size instead of dropping it?

### Encoding: how the tile bytes compress

The largest z17 tiles of two Kawazu sets (49 cm uniform MMS + airborne ground
class: 473,211 splats, 7.57 MB; MMS + all airborne returns with the E008
rules below: 395,810 splats, 6.33 MB). Compressed size as a share of the
stored tile, Node zlib gzip level 9, brotli quality 11:

| layout | uniform tile | merged tile |
| --- | ---: | ---: |
| whole records (version 4), gzip | 84.6 % | 89.7 % |
| whole records, brotli | 75.9 % | 83.0 % |
| byte planes (version 5), gzip | 63.6 % | 68.7 % |
| byte planes, brotli | 59.0 % | 65.3 % |
| Morton-sorted, byte planes, gzip / brotli | 62.9 % / 59.0 % | 68.3 % / 65.0 % |
| Morton-sorted, delta of x, y, z, byte planes, brotli | 60.1 % | 65.5 % |

Brotli compressed bytes by field (merged tile, 395,810 splats): x 436 kB,
y 460 kB, z 565 kB, three scales 259 + 258 + 267 kB, rotation 925 kB, colour
and opacity 940 kB. Rotation and colour are 44 % of the compressed bytes;
positions are about one byte each, close to noise at 16 bits.

- Transposing the records into byte planes is the low-hanging fruit: gzip
  leaves 69 to 64 % instead of 90 to 85 %, a 23 to 25 % saving, with the same
  fields and quantization. Adopted as Surfel Block version 5; version 4 is
  still decoded.
- Morton ordering and delta coding of the positions gave nothing on top: the
  records already come in a coherent (z, y, x) order from the voxel grid.
- gint (a 64-bit integer of coordinate, Morton index and a rendering rank,
  for line vertices) was read; it does not carry over as an encoding. Its
  Morton order did not help here (above); its rank is a zoom-dependent
  culling order, which would be a second mandatory level-of-detail mechanism
  next to the tile hierarchy, ruled out in AGENTS.md; its reclaimed low bits
  have no counterpart, since the coordinates are kept at 16 bits. The
  spare-bits idea (a bit of the record carrying intent) stays an open option.
- Not tried: lowering the precision of rotation (24 bits) and positions
  (16 bits); both are the largest compressed fields.

### Vegetation: voxels supported by few points

On the airborne data at 49 cm cells (3,366,967 voxels, all returns), as shares of
all voxels: sparse (fewer than 5 points) 67 %, planar 15 %, linear 1 %, round
11 %, other 6 %. Class 1 alone: 70, 12, 1, 11, 6 %; ground class alone: 64, 28,
2, 4, 2 %. (Shape from the eigenvalues of each voxel's covariance for n >= 5:
round if the smallest/largest standard deviation exceeds 0.5.)
Classification codes do not separate vegetation from structures
(the MMS has classes 2 to 5, the airborne class 1 holds canopy and
structures), so a rule on shape and support was tried instead of one on class.

`adaptiveGaussians` got a sparse rule (`sparseSupport`, E005 code): a parent is
also merged when every child has fewer than that many points, whatever the
thickness and colour. Merging now applies to every zoom. LP = the airborne
data, all returns, 49 cm base, 3 merge levels (cells up to 3.9 m), thickness
20 cm, colour 0.2; z16 + z17 tiles (the uniform all-returns set is 70.1 MB):

| sparse support | LP all returns | MMS + LP all returns |
| ---: | ---: | ---: |
| off (thickness and colour rules only) | 36.0 MB | – |
| 6 | 29.9 MB | – |
| 12 | 23.3 MB | 26.8 MB |
| 24 | 16.5 MB | 20.0 MB |

(For reference: LP ground class only, uniform: 11.6 MB; MMS + LP ground,
uniform: 17.5 MB; MMS + LP all returns, uniform: 73.4 MB.)

### Observations

- MMS + LP all returns with support 24 is 20.0 MB, 27 % of the uniform
  all-returns set and 15 % more than ground-plus-MMS at uniform cells, so
  keeping the vegetation as coarse blobs costs about 2.5 MB on this mesh.
- Viewed at zoom 17.6 and 19 (`?extent=1.3`, terrain): the forest on the slope
  is a continuous canopy of blobs, the loop bridge, its piers and the road with
  its centre line are intact. Tree detail is gone; that is the intent.
- The z15 to z17 archive built with this recipe: 1,459,754 splats, 23.36 MB of
  tiles, 15.95 MB as a gzip-tile PMTiles archive.

### Decision

Keep vegetation, merged by the sparse rule (support 24), and gzip the tiles of
the archive. Dropping vegetation (ground only) would save a few MB more but the
canopy is what makes the scene read as a place.

### Not yet shown

- Whether support 24 is right elsewhere (a city, a plain, a dense forest at
  another density); the value is tied to 121 points/m2 and 49 cm cells.
- ~~Whether Martin serves gzip-compressed MLT tiles~~: it does not (Martin 1.14.0:
  `Format Mlt and compression Gzip are not yet supported`); the hosted archive has
  raw tiles (documents/kawazu-demo.md), so the gzip saving is not realised on stars yet.
- A measure of how much the canopy loses against the original points.

## E009: The Kawazu area widened to 3 x 3 meshes, and a sparse threshold that follows the zoom

### Question

Does the size per area stay put when the area grows, and what does a prefecture
cost at that rate? (hfu: if the size hits a wall, change the algorithm.)

### Data and method

Nine meshes of 300 m x 400 m, 08OF4050 to 08OF4072 (rows 5 to 7, columns 0 to 2,
900 m x 1,200 m = 1.08 km2). Airborne LP "Ground" (all returns) for all nine,
MMS for four (4050, 4060, 4070, 4071); 476,004,940 points in 13 files
(documents/large-point-clouds.md). Each mesh was built alone with the E008 recipe
(49 cm cells at z17, three merge levels, thickness 20 cm, colour 0.2, sparse
threshold 24; z15 to z17) and the tilesets were joined by `npm run merge:tilesets`
(8 GB of RAM do not hold the voxels of nine meshes at once). Peak memory per mesh
build 1.23 GB, 20 to 50 s each, 269 s in all. Mesh seams are not reconciled.

### Measurements

Same threshold at every zoom (24):

| zoom | tiles | size | per m2 | median tile | largest tile | splats |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| z15 | 4 | 31.9 MB | 29.5 B | 15.55 MB | 16.15 MB | 1,992,374 |
| z16 | 12 | 89.3 MB | 82.7 B | 4.55 MB | 22.57 MB | 5,582,386 |
| z17 | 30 | 98.8 MB | 91.4 B | 3.59 MB | 7.17 MB | 6,172,195 |
| all | 46 | **220.0 MB** | **203.7 B** | | | 13,746,955 |

The zoom levels below z17 held almost as many splats as z17 (z16: 0.9 times,
z15: 0.32 times), not a quarter each. The sparse rule keeps a Gaussian that has
at least 24 points; a coarser cell holds more points, so fewer voxels qualify
for merging. The threshold was therefore multiplied by 4 for each zoom below the
maxzoom (z16: 96, z15: 384; `DORAYAKI_ADAPTIVE_SPARSE_SCALE=4`), since a cell
there has 4 times the area. On mesh 08OF4060 alone: scale 1: 23.36 MB; scale 2:
18.83 MB; scale 4: 15.19 MB (z15 3.32 to 0.78 MB, z16 8.81 to 3.18 MB, z17 11.23 MB
unchanged). Rebuilt for all nine meshes with scale 4:

| zoom | tiles | size | per m2 | median tile | largest tile | splats |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| z15 | 4 | 6.3 MB | 5.8 B | 2.88 MB | 3.35 MB | 391,166 |
| z16 | 12 | 27.0 MB | 25.0 B | 1.35 MB | 6.47 MB | 1,688,254 |
| z17 | 30 | 98.8 MB | 91.4 B | 3.59 MB | 7.17 MB | 6,172,195 |
| all | 46 | **132.0 MB** | **122.2 B** | | | 8,251,615 |

Per mesh (scale 4): 12.0 to 16.7 MB (scale 1: 20.9 to 27.3 MB). The PMTiles archive
with raw tiles is 132,030,481 bytes.

### Observations

- The size follows the area: about 25 MB per mesh before, about 15 MB per mesh
  after, with a spread of a factor 1.4 between meshes (a forested slope, a road
  corridor, a village in the valley); one mesh (4060) was 195 B/m2 against
  204 B/m2 for nine.
- Scaling the threshold with the zoom cuts the total by 40 %, the pyramid cost
  from 1.2 times the z17 size to 0.34 times, and the largest tile from
  22.6 MB to 7.2 MB.
- Viewed at zoom 16.35 and 16.63 (`?terrain=1`, `?extent=1.3`): the widened area
  is a continuous forested valley, the loop bridge stays readable in the z16
  tiles of scale 4; no mesh seam was seen in these views.
- Taken as a scale for the prefecture (7,800 km2, this slope as the model, which
  it is not): 122 B/m2 is about 0.95 TB with all three zooms and 91 B/m2, about
  0.71 TB, for z17 alone.
- Loading everything at once costs: the 46-tile, 8.25 million-splat set took
  fetch 0.8 s, decode 3.2 s, upload 2.1 s on an Apple M1 (local server). Only
  the z16 tiles (1.69 million splats) were drawn at the view above. Loading
  tiles on demand is needed at this size.

### Decision

Keep the E008 recipe with the sparse threshold multiplied by 4 per zoom step.
At this rate a prefecture is near the 1 TB the owner named; there is no wall
yet, and the next lever is z17 (91 B/m2), not the pyramid.

### Not yet shown

- Anything outside this valley: a town, a plain, an airborne-only area.
- How the mesh seams look in close views.
- Whether a threshold of 384 at z15 and 96 at z16 loses anything the eye
  misses at those zooms (compared in two views only).
- Tile-on-demand loading in the demo.

## E010: The terrain hides splats: how far is the DEM from the point cloud's ground?

### Question

With `?terrain=1` the MapLibre terrain mesh (stars' `mapterhorn-japan-bridge`
DEM) hides splats of the ground and of the villages where it lies above them
(white patches in the Kawazu area). Is the fix a large shift (hfu suggested about
10 m, lowering the terrain or raising the data), or a small one?

### Method

360 airborne ground points (class 2) were sampled over the nine meshes (about 40
per mesh, a fixed pseudo-random seed), converted to longitude and latitude, and
compared with `map.queryTerrainElevation` on the page (`kawazu-area`, zoom 15.7,
pitch 0, terrain on): DEM minus LP z. Then the DEM was lowered by 0, 1, 2, 3, 4
and 10 m through the raster-dem source (`encoding: "custom"` with Terrarium
factors and `baseShift`; MapLibre decodes red x redFactor + green x greenFactor +
blue x blueFactor minus baseShift, so a lower terrain needs a larger baseShift,
found by trying) and the share of near-white (background) pixels was read back in
two screen rectangles of the village view (zoom 17.2, bearing -30, pitch 60), the
village on the left and the road.

### Measurements

DEM minus LP ground (m): 5 % -0.86, 25 % -0.37, median -0.12, 75 % +0.12, 95 % +0.74,
maximum +2.40, mean -0.12. Share of points where the DEM is above the ground by
more than 0.5 m: 8.1 %; 1 m: 2.8 %; 2 m: 0.3 %; 5 m: 0 %. Below the ground by more
than 2 m: 0.6 %; 5 m: 0 %.

Near-white pixel share in the village view:

| terrain lowered by | village | road |
| ---: | ---: | ---: |
| 0 m | 0.18 % | 0.38 % |
| 1 m | 0.03 % | 0.04 % |
| 2 m | 0.02 % | 0.01 % |
| 3 m | 0.02 % | 0.01 % |

### Observations

- The DEM agrees with the airborne ground within about one metre for 97 % of the
  samples; it is never more than 2.4 m above it. A 10 m shift is far larger than
  the discrepancy and would lift the splats 10 m off the basemap's roads and
  rivers; 1 to 2 m removes the white patches. Lowering the terrain by 3 m made
  the village view show no patches (screenshot).
- Lowering the terrain and raising the data (`?dz=`) give the same relative offset.
  The terrain was lowered because the data then keeps its true orthometric heights
  and the hack sits in the DEM, whose only job is to hang the basemap on.
- A 2 m offset leaves the basemap (draped on the lowered terrain) 2 m below the
  data: not visible at map scale; not examined in close views.

### Decision

The demo lowers the DEM by 2 m by default (`?terrainshift=<m>`; 0 keeps the DEM as
it is). The samples are from one valley; other areas and a finer DEM may need a
different value.

### Not yet shown

- Other areas (a plain, a town) and the DEM tiles at zoom 16 and above (the zoom
  15.7 view used coarser tiles for some of the area).
- Whether a 2 m offset is visible between draped basemap lines and the splats in
  close, low-pitch views.

## E011: Instability when zooming out: JS memory, a lost WebGL context, and the per-zoom threshold

### Question

Zooming out made the demo unstable (the page seemed to be reset). Hypothesis (hfu):
the zooms below z17 load too many points, so they need a much coarser
simplification, perhaps ten times coarser per zoom step (forest is more than
two-dimensional) instead of four.

### Method

The nine-mesh set served locally (`?fixture=kawazu`; pane visible; Chromium of the
Claude desktop app on an Apple M1, 8 GB). The page jumped through zoom 17.5, 16.5, 16,
15.5, 15, 14 at pitch 60, waited until no tile was loading, and recorded the tiles and
splats held, `performance.memory.usedJSHeapSize`, the median frame interval over 15 to
20 frames and the number of `webglcontextlost` events. The context was also lost on
purpose (`WEBGL_lose_context.loseContext()`, then `restoreContext()`), which is what a
browser does when it reclaims GPU memory. The per-zoom threshold factor was tried on mesh
08OF4060 (4, 10, 16) and, for 10, on all nine meshes.

### Measurements before the change

| zoom | z drawn | tiles | splats | JS heap |
| --- | --- | ---: | ---: | ---: |
| 17.5 | z17 | 9 | 2,653,724 | 739 MB |
| 16.5, 16 | z16 | 9 | 1,612,076 | 1,025, 1,058 MB |
| 15.5 to 14 | z15 | 4 | 391,166 | 498 to 538 MB |

The frame interval was 16 to 17 ms at every zoom (the display's rate) and no context was
lost in normal use. After the simulated loss and restore, the `surfels` layer was no
longer in the style (124 layers, no `surfels`), no splat was drawn again and the
basemap rendered black.

### Observations

- The sets below z17 are smaller, not larger: 1.6 million splats at z16 and 0.39
  million at z15 against 2.65 million at z17. The hypothesis that low zooms load too many
  points is not supported by these counts.
- The heap held 739 MB at z17 for 2.65 million splats: the decoded `Splat` objects
  (about 280 bytes each) stayed in memory after the data had been uploaded. The peak was
  1,058 MB right after switching from z17 to z16, when the old set, its garbage and the
  new set coexisted. A tab limit (WebKit reloads a page that uses much memory) or an
  8 GB machine under other load would explain a reset.
- Loss of the WebGL context is not handled by MapLibre for a custom layer; it is a
  second plausible reset.

### The change

- A tile is turned into instance data (56 bytes per splat) when it is loaded and the
  Splat objects are dropped; the layer uploads that data and keeps nothing. Fresh load at
  zoom 17.5: 739 to 420 MB; over the zoom sequence the heap stayed at 229 to 383 MB.
- On `webglcontextrestored` the demo adds a new layer and `TileStreamer.reset()` makes
  the next update load the tiles again. After the simulated loss, 9 tiles and 1,612,076
  splats were drawn again after 1.9 s, with the basemap intact.

### The per-zoom threshold factor

Occupied voxels of the airborne cloud (all returns), uniform cells (E007): z16
1,013,689 against z17 3,367,215, a ratio of 0.30 per zoom step: a dimension of about 1.7,
below two, not above, at these cell sizes (the points are too sparse to fill a volume at
49 cm).
The sparse threshold is nevertheless worth raising for size and for load time. Mesh
08OF4060, z15 / z16 / z17 splats and total size:

| factor | z15 | z16 | z17 | total | z16 / z17 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 48,452 | 198,878 | 702,139 | 15.19 MB | 0.28 |
| 10 | 15,854 | 102,341 | 702,139 | 13.13 MB | 0.15 |
| 16 | 10,405 | 76,969 | 702,139 | 12.63 MB | 0.11 |

Viewed at zoom 16.1 (pitch 67), factors 4 and 10 look the same (the loop bridge and
the forest). Nine meshes with factor 10 (`kawazu-v2`), against factor 4:

| zoom | factor 4 | factor 10 |
| --- | ---: | ---: |
| z15 | 6.3 MB, 391,166 splats | 1.4 MB, 84,477 |
| z16 | 27.0 MB, 1,688,254 | 10.9 MB, 678,826 |
| z17 | 98.8 MB, 6,172,195 | 98.8 MB, 6,172,195 |
| all | 132.0 MB (122 B/m2) | **111.0 MB (103 B/m2)** |

The largest z16 tile fell from 6.47 to 2.65 MB. At the showcase view
(`#map=16.63/34.790766/138.939214/128.7/67`) the page fetched 8 tiles, 26.9 MB before and
10.8 MB with factor 10 (676,201 splats drawn, 121 MB of JS heap).

### Decision

Keep the memory change and the context restore. Use factor 10 for the zooms below the
maxzoom (`DORAYAKI_ADAPTIVE_SPARSE_SCALE=10`). Prefecture scale at 103 B/m2: about
0.8 TB (an extrapolation from one valley).

### Not yet shown

- A crash was not reproduced: the instability itself is explained, not observed (no
  reload or context loss happened in normal use on this machine). hfu's browser and
  symptom were not examined.
- Zooms below 14: below z15 the demo draws the z15 tiles (four of them) at any zoom.
- GPU memory was estimated (56 bytes per splat, about 150 MB at z17), not measured.

## E012: a render-based measure of what coarser tiles lose

### Question
Every lossy choice (the per-zoom threshold factor, the sparse rule, a lower maxzoom) was
judged by eye. Can the difference between two tile sets, seen from a fixed camera, be
measured in Node without a browser?

### Method
`demo/src/cpu-render.ts` draws the splats of a set of tiles into an 800 x 600 image with a
depth buffer, from a map view (lng, lat, zoom, bearing, pitch) with MapLibre's camera model.
It is a proxy: flat colour, no lighting, no opacity. `demo/src/image-metrics.ts` compares a
reference image with a candidate: `holes` (reference pixels the candidate leaves empty),
`extra` (the opposite), colour error (`mae`, `psnr`) and depth difference over pixels both
cover. With `block` 4 both images are averaged over 4 x 4 pixels first, which ignores
pixel-level texture and compares the look at a coarser scale. `npm run measure:quality`
runs it. Tests: `test/cpu-render.test.ts` (a plane's colour and depth, identical images,
holes, colour and depth differences).

Here: mesh 08OF4060 built with threshold factors 4, 10 and 16 (`kawazu-s4`, `-s10`, `-s16`),
reference the z17 tiles (identical in the three builds), candidate their z16 or z15 tiles,
three views (the showcase view, z18.5 pitch 60, and a top view at z17.5). Time: about 3 s
per run.

### Measurements (view 1, the showcase view; block 4)

| candidate | splats | holes | mae (0-255) | psnr dB | depth median (m) |
| --- | ---: | ---: | ---: | ---: | ---: |
| factor 4, z16 | 198,878 | 0.35 % | 3.5 | 33.0 | 0.58 |
| factor 10, z16 | 102,341 | 0.62 % | 4.6 | 31.2 | 0.87 |
| factor 16, z16 | 76,969 | 0.81 % | 5.1 | 30.5 | 0.97 |
| factor 4, z15 | 48,452 | 0.80 % | 5.4 | 29.6 | 1.05 |
| factor 10, z15 | 15,854 | 2.39 % | 7.4 | 27.3 | 1.57 |
| factor 16, z15 | 10,405 | 4.18 % | 8.5 | 26.4 | 2.10 |

The other two views order the candidates the same way. At block 1 (pixel level) the
errors are larger (mae 7.6 to 13.5) and the order is the same.

### Observations
- The measure ranks the candidates as expected: more merging, higher error; z15 worse than
  z16. It separates what E011 judged "the same by eye": factor 10 at z16 costs about one
  grey level of mean error and 0.3 points of holes against factor 4, for half the splats.
- The reference is the finest tiles built (49 cm cells, merged), not the point cloud, so this
  measures the loss of going coarser in the pyramid, not the loss against the data.
- depthP95 (8 to 19 m) is dominated by canopy, where the two sets see different layers; use
  the median.
- Not yet checked: a threshold on these numbers that matches what a viewer calls
  "visibly different" (the images agree with the eye at factor 4 to 10, not tested beyond).

### Decision
Keep. It is the tool for B-2 to B-4 (sparse rule at z17, encoding changes that quantize more,
per-area maxzoom): change one thing, render, read the table.

## E013: 16-byte records on the GPU

### Question
The GPU held 56 bytes per splat (float attributes made from decoded Splat objects) although the
wire record is 16. Can the record go to the GPU as it is, with the vertex shader decoding it, and
look the same?

### Method
`packedSurfelBlock` (src/surfel-block.ts) returns a block's records as 16-byte records without
making Splat objects (version 5 planes are transposed; version 4 is copied). The layer uploads
them as one `uvec4` attribute per instance and a second program (`PACKED_VERTEX_SHADER` in
`demo/src/gpu-surfels.ts`) decodes position, scales, rotation (smallest three), axis order,
roundness and colour as `splat-instances.ts` does. `?gpu=legacy` keeps the old path. Compared in
the browser (Chromium of the Claude desktop app, Apple M1) on the Kawazu archive from stars: the
canvas of the same camera, averaged over 25 x 25 blocks, in both modes.

### Measurements
| view | splats | mean block difference (0-255) | largest block difference |
| --- | ---: | ---: | ---: |
| zoom 16.63, bearing 128.7, pitch 67 | 676,201 | 0.001 | 0.02 |
| zoom 18.5, bearing -30, pitch 60 | 1,591,264 | 0.006 | 0.37 |

Loading the z17 view (6 tiles, 1,591,264 splats): decode 666 ms before, 47 ms after (no Splat
objects, no instance arrays); GPU upload 32 ms before, 15 ms after; buffers 89 MB before
(56 bytes), 25.5 MB after (16 bytes). The JS heap read 75 MB right after the load against 26 MB
for the old path, and 25 MB 20 seconds later (transient arrays not yet collected).

### Observations
- A first z18.5 comparison showed a large difference (mean 24.8). The camera had moved: MapLibre
  ended at zoom 18.44 in one run (the user also clicked in the page). With the camera at exactly
  zoom 18.5 / bearing -30 / pitch 60 in both runs, the difference is the one above. Compare
  camera values with the images.
- Ties in scale code and the roundness threshold (largest code minus smallest code at most 5,
  the same as a ratio below 1.5 in `splat-instances.ts`) are decided on the integer codes, so
  both paths choose the same axes.
- Block means do not prove equal pixels; no per-pixel comparison was made.

### Decision
Keep; packed is the default. `?gpu=legacy` stays as a comparison path for now.

## E014: staged first display

### Question
At the default Kawazu view (zoom 18.5, pitch 60) the map was empty until all six z17 tiles
(25.8 MB) had arrived. Can the view show something sooner?

### Method
`TileStreamer` (demo/src/tile-streamer.ts) takes `staged`: when nothing has been handed over yet
(page start, or after `reset`), it also loads the next coarser zoom's tiles of the same view and
hands them over when they are complete, if the target set is not there yet; the target set then
replaces them as before. Later zoom changes do not stage (the layer already shows a set).
`?staged=0` switches it off. `dorayaki.deliveries` records each handed-over set. Network times
were taken with `fetch` and a fresh query string (no HTTP cache) from this Mac to stars, all tiles
of a set in parallel.

### Measurements
| set | tiles | bytes | time to fetch all |
| --- | ---: | ---: | ---: |
| z16 (shown first) | 4 | 6,035,801 | 0.82 s |
| z17 (target) | 6 | 25,840,074 | 2.75 s |

On the page: z16 delivered, then z17 (`deliveries`: z16 4 tiles 6.0 MB, then z17 6 tiles 25.5 MB).
With the browser's HTTP cache warm both arrived within 0.1 s of each other (454 and 538 ms), so
the page's own timing does not show the gain; the two fetch times above do.

### Observations
- The first picture needs about a quarter of the bytes and about a third of the time of the
  target set on this connection; a slower connection widens the gap.
- The z16 picture is coarser, so the view changes when z17 replaces it (no fade).
- Staging asks for both sets at once, so the z17 fetch is not delayed (bandwidth is shared).

### Decision
Keep, on by default.

## E015: tiles of several zooms by distance (`?mixed=1`)

### Question
The demo draws the tiles of one zoom, the nearest nine in view. In a tilted view the far ground is
then empty (nine tiles do not reach it), and the one zoom is a compromise between near and far.
Can tiles of several zooms be drawn at once, each where the camera is close enough to deserve it,
within a bounded number of tiles?

### Method
`demo/src/mixed-selection.ts`: walk the tile pyramid from the coarsest zoom; keep a tile when the
part of it nearest to the camera would be drawn at a map zoom below the next zoom (the existing
floor rule, per tile instead of per map; `effectiveZoom` in `demo/src/camera.ts` is the zoom at
which a point is seen), when no finer zoom exists, or when any of the finer tiles replacing it is
missing; otherwise replace it by the finer tiles. The result is a partition (no tile covers another),
cut to the 24 tiles nearest the view centre. `TileStreamer` takes a `select` function for it (the
staged first delivery calls it with a coarser cap), the layer draws every tile it is given
(`drawAllTiles`), and the demo wires it to `?mixed=1`. The camera model of the software renderer was
moved to `camera.ts` and shared, with `visibleBounds(view)` (the ground the camera sees, cut at
20 km), so that `npm run measure:quality -- <dir> 17 mixed` can compare, from fixed cameras and
against the z17 tiles everywhere, what the demo draws now (the nearest nine tiles of the zoom picked
from the map zoom, among those in view), the same with all tiles of that zoom, and the mixed set.
Tileset: the nine-mesh Kawazu archive (factor 10; z15, z16 and z17), 800 x 600 renderings, block 4.

### Measurements (block 4; MB are the tile files' sizes)
| view | candidate | tiles | MB | holes | colour error (0-255) |
| --- | --- | --- | ---: | ---: | ---: |
| zoom 16.63, pitch 67 (showcase) | mixed | z16:7 z17:2 | 20.3 | 0.4 % | 2.8 |
| | now (nearest 9) | z16:8 | 10.8 | 0.4 % | 3.7 |
| zoom 17.2, pitch 75 | mixed | z16:6 z17:8 | 44.3 | 0.3 % | 3.0 |
| | now (nearest 9) | z17:9 | 32.1 | **87 %** | 17.8 |
| zoom 16.2, pitch 80 | mixed | z15:1 z16:3 z17:4 | 18.8 | 0.07 % | 1.6 |
| | now (nearest 9) | z16:6 | 6.1 | 0.3 % | 4.0 |
| zoom 18.5, pitch 60 | mixed | z16:2 z17:3 | 17.8 | 0.06 % | 0.9 |
| | now (nearest 9) | z17:6 | 25.5 | 0 % | 0 |
| zoom 17.5, top-down | mixed | z16:2 z17:2 | 12.2 | 0.09 % | 1.2 |
| | now (nearest 9) | z17:4 | 16.2 | 0 % | 0 |

In the browser (`?fixture=kawazu-stars&mixed=1` at zoom 17.2, pitch 75, bearing 128.7): staged
delivery z16 8 tiles (10.8 MB), then 17 tiles (z17 12, z16 5; 65.7 MB, 4,103,361 splats, 66 MB
of GPU buffers at 16 bytes each); the far ridge and the loop bridge both drawn.

### Observations
- In a steeply tilted view at zoom 17.2 the nearest nine z17 tiles leave 87 % of the reference's
  pixels empty; the mixed set leaves 0.3 %, for 12 MB more. This is the case that motivated it.
- Near views (zoom 18.5, top-down) draw fewer bytes than now (17.8 vs 25.5 MB) because tiles at the
  edge of the view are taken from a coarser zoom, at 0.9 to 1.2 grey levels of colour error.
- Views at zoom 16 to 16.6 cost 2 to 3 times the bytes of the single zoom, for a colour error
  that is 25 to 60 % lower: the quality is bought with bytes.
- The simulated view 2 chose 14 tiles (44.3 MB); the browser chose 17 (65.7 MB): the real map's
  bounds are wider than `visibleBounds`, and the canvas is larger. The cost of a view depends on
  the screen; the cap is a tile count (24), not bytes, so the worst case is 24 z17 tiles, about
  85 MB on this archive.
- Not seen: seams between tiles of different zooms (no cracks noticed in one screenshot; not
  looked for), frame time with 4 million splats.

### Decision
Kept behind `?mixed=1`, not the default: the byte cost at ordinary views is higher than now, and
a byte budget (the selector knows tile counts, not sizes) is not designed. Next questions:
a byte-aware cap, and per-area maximum zoom (B-1), which this selector already handles
(a finer tile is used only where it exists).

## E016: where the bytes of a tile go, and which precision is free (in progress)

### Question
Tiles are 16 bytes per splat (98.8 MB for the 6.17 million z17 splats of the Kawazu archive). What can a better
encoding save, losslessly and with which precision reductions?

### Method
`npm run measure:encoding -- <dir> <zoom>`: per field, zero-order entropy (bits per splat, per tile; an adaptive entropy
coder would approach it) of the stored value and of simple transforms; gzip and brotli of the block as stored and with the
fields rearranged. `npm run measure:precision -- <dir> <zoom>`: requantize one field at a time, render original and
variant from three cameras with the software renderer (E012), compare (colour error, PSNR, holes; block 4; worst of the
views). The tiles are stored in raster order (99.5 % of neighbours in row-then-column order).

### Measurements: bits per splat (Kawazu factor-10 archive, z17, 6,172,195 splats)
| field | stored | ideal after a transform |
| --- | ---: | ---: |
| position x, y (32) | 32 | row delta 1.2 + column delta 6.5 + sub-cell 7.0 + 7.0 |
| height (16) | 16 | delta to previous 7.9 |
| scales (24) | 24 | x 5.3, y - x 5.8, z - x 6.1 |
| rotation (24) | 24 | 0.0 + 6.3 + 6.1 + 6.0 |
| colour (24) | 24 | r 6.8, g - r 4.8, b - r 5.8 |
| alpha (8) | 8 | 0 (always 242) |
| total | 128 (101.4 as stored bytes) | **82.3** |

gzip: 10.95 bytes per splat as stored (31 % less than 16), 10.50 rearranged (34 % less); brotli quality 9: 11.4 and 10.9.

Precision reductions (mesh 08OF4060, z17, 702,139 splats; colour error in 0-255, worst of three views):
| change | bits saved | colour error | PSNR dB |
| --- | ---: | ---: | ---: |
| position x, y 12 bits (from 16) | 8 | 1.0 | 41.4 |
| position 11 / 10 bits | 10 / 12 | 1.6 / 2.6 | 38.7 / 35.4 |
| height step 2 / 5 / 10 cm (from 4 mm) | 2.3 / 3.6 / 4.6 | 0.4 / 0.8 / 1.3 | 46.8 / 42.8 / 39.9 |
| scale 6 / 4 / 3 steps per octave (from 10) | 2.2 / 4.0 / 5.2 | 0.7 / 1.0 / 1.3 | 43.7 / 41.7 / 40.2 |
| rotation 5 / 4 / 3 bits per component (from 7) | 6 / 9 / 12 | 0.8 / 1.4 / 2.3 | 43.4 / 40.0 / 36.3 |
| colour 6 / 5 / 4 bits per channel (from 8) | 6 / 9 / 12 | 0.6 / 1.3 / 2.6 | 49.1 / 44.0 / 38.0 |
No change produced more than 0.23 % holes.

### Observations
- The data is mostly forest: scale, rotation and colour carry 5.3 to 6.3 bits each per field and are close to noise, so
  lossless modelling gains little (101 -> 82 bits at best, and gzip gets about the same).
- Raster order makes the cell gap small: the stored row and column cost 7.7 bits after deltas, and a single gap in raster
  order (not measured) should cost about 2.
- Together, position 12 bits (-8), height 2 cm (-2.3), scale 6 steps (-2.2), rotation 5 bits (-6), colour 6 bits (-6) save about
  24 bits (a 96-bit, 12-byte record), if the errors add up like the worst single ones (not measured together).
- gzip is the only general compressor the browser decodes natively (DecompressionStream), and stars' Martin cannot read gzip
  MLT tiles (kawazu-demo.md), so the 31 to 34 % of gzip is not available yet.
- The alpha byte is constant (242) and the renderer ignores it. Class and return data in the LAS files: airborne LP has
  class 1 (unclassified, 90 %) and 2 (ground, 10 %), return numbers 1 to 5; MMS has 2 (ground 14 %), 3, 4, 5 (vegetation 86 %).

### Decision
Open. Not yet: a combined run of the reductions, the format change itself, the alpha question (hfu's idea: vegetation more
transparent, which would use the alpha byte instead of dropping it).

## E017: vegetation more transparent (hfu's idea)

### Question
Can vegetation be told from ground, and drawn more transparent, so that the ground and structures under a canopy show
through?

### Method
Data: class and return histograms (sampled) of the Kawazu LAS files: airborne LP 08OF4060: class 1 (unclassified) 90 %,
class 2 (ground) 10 %, return numbers 1 to 5; MMS 08OF4060: class 2 14 %, 3 (low vegetation) 23 %, 4 13 %, 5 50 %.
`VoxelAccumulator` keeps a vegetation weight sum per voxel (14 doubles per voxel instead of 13); `adaptiveGaussians` merges
it exactly; the Gaussian's opacity goes from 0.95 to `vegetationOpacity` with the share. The builder marks vegetation per
file: `@v3+4+5` (class) or `@vr` (more than one return). The shader draws the alpha as screen-door transparency
(interleaved gradient noise on the pixel; discarded pixels write no depth, so nothing needs sorting), switched by `?veg=1`;
opacities from 0.94 up count as opaque, so the default 0.95 is unchanged. Built: mesh 08OF4060, MMS with `@v3+4+5` and
LP with `@vr`, the recipe of the Kawazu archive, vegetation opacity 0.5: `kawazu-veg` (dev tileset; `kawazu-s10` is the same
mesh without it).

### Measurements
- Size: 13,127,290 bytes against 13,127,262 for `kawazu-s10`: no change (the alpha byte was already there).
- Alpha of the z17 splats (702,139): 88.3 % in [0.5, 0.625), 6.0 % in [0.625, 0.75), 3.1 % in [0.75, 0.875), 2.6 % opaque.
  So about nine tenths of this mesh's splats are mostly vegetation by these rules.
- Build 53 s, 0.32 GB peak.
- Tests: the opacity follows the share (all, none, half), and merging keeps the share of all points.

### Observations
- With `?veg=1` the vegetation is drawn as a dither pattern, visible at close range (zoom 18 and above) and finer at a
  distance; the road and the loop bridge stand out more than with opaque forest.
- Not judged: whether 0.5 is the right opacity, whether the dither is acceptable, whether the ground under the canopy
  shows (the browser view was being moved by hand while I looked, so no side-by-side of the same camera was taken).
  The software renderer of E012 ignores opacity, so there is no number yet.
- Classes by return count mark any multi-return pulse, so tree-like edges of buildings are vegetation by this rule; no
  check was made against the structures in the mesh.
- The alpha byte is now used, so the idea of dropping it in a tighter encoding (E016) becomes one or two bits.

### Decision
Abandoned and reverted (hfu, after looking at `kawazu-veg` against `kawazu-s10`: the transparency did not work as
hoped; no further reason was recorded, and none was measured). The code (vegetation share in the accumulator and the
merge, the `@v`/`@vr` filters, the screen-door shader, `?veg=1`) was removed again; this entry and the class and return
histograms above stay. The local build `demo/tiles/kawazu-veg` was deleted. If the idea returns: the classes in the data
make the vegetation share cheap to compute (E017 method), and what to try differently is the way transparency is drawn
(sorted blending instead of screen-door noise) and the opacity, neither of which was explored.
- The alpha byte stays unused and constant, so the note in E016 about dropping it applies again.

### E016 result: version 6 (12-byte records), 2026-11-16

Combined reductions (software renderer, block 4, worst of three views; mesh 08OF4060, z17): position 13 bits
(from 16), height 2 cm, scale 6 steps per octave, rotation 5 bits per component, colour 6 bits per channel: colour error
1.59 of 255, PSNR 40.0 dB, 0.07 % holes (position 12 bits instead of 13: 1.76, 39.1 dB). The scales of a z17 tile span
11 to 11.6 octaves (smallest 2^-10 m, the builder's floor), so a 7-bit code at 6 steps per octave (21 octaves) from the
block's smallest scale covers them.

Version 6 (documents/surfel-block-format.md): 96-bit records, x 13, y 13, z 14, three scales 7 bits each, rotation 17,
colour 6 bits per channel; alpha moves to the header (one opacity per block); header 40 bytes. Opt-in
(`{ version: 6 }`, `DORAYAKI_BLOCK_VERSION=6`); reads 4, 5 and 6. The vertex shader decodes the record as uploaded
(a `uvec3` per instance), so the GPU holds 12 bytes per splat (it held 16, and 56 before E013).

| | version 5 | version 6 | ratio |
| --- | ---: | ---: | ---: |
| mesh 08OF4060 (11 tiles) | 13,127,262 B | 9,846,006 B | 0.750 |
| nine meshes (46 tiles, 6,935,498 splats): z15 | 1,351,910 | 1,014,034 | 0.750 |
| z16 | 10,862,055 | 8,146,845 | 0.750 |
| z17 | 98,757,239 | 74,068,696 | 0.750 |
| archive | 110,972,600 | 83,230,961 | 0.750 |
| per square metre (1.08 km2) | 103 B | 77 B | |
| largest tile | 7.17 MB | 5.38 MB | |

In the browser (Apple M1; mesh 08OF4060, zoom 18.5, bearing -30, pitch 60, 682,792 splats, same camera in both): the
25 x 25 block means of version 6 and version 5 differ by 0.63 of 255 on average (largest block 6.3; 81 of 1,875 blocks
by more than 2, scattered, with no brightness bias: -0.05), so the shader decoding agrees with the codec to within
the quantization.

### Observations
- Exactly 0.750: the record is 12/16 bytes and the header and level table are negligible; the saving does not depend
  on the data.
- Whole 12-byte records are less compressible than the version 5 planes: the 31 to 34 % of gzip measured above is
  not expected on top of this (not measured on version 6).
- Per-block `alpha` closes the door on per-splat opacity in this layout (E017 was abandoned, so nothing uses it).
- The entropy-coding route (about 82 bits at best, E016 table) was not taken: it needs a decoder with state per field and
  would not be uploaded to the GPU as it is.
- The nine-mesh build was run through `merge:tilesets`, which decodes and re-encodes the tiles it merges (the
  pyramid keeps one tile per address except at mesh seams), so tiles at seams were quantized twice.

### Decision
Version 6 is kept opt-in. The hosted Kawazu archive stays version 5 until hfu decides to replace it (a build
and upload as before; the TileJSON version parameter must change).

## E018: a softer, more Gaussian-splat-like look (`?look=soft`)

### Question
Splats are drawn as flat, opaque, hard-edged ellipses. Can they be drawn so that they look like Gaussian splats (soft
overlapping blobs), without sorting millions of splats per frame?

### Method
Two passes per frame over the same tiles (demo/src/surfel-layer.ts, gpu-surfels.ts): first an opaque pass of splats shrunk
by `coreScale` (default 0.8) that writes depth, then a pass of splats grown by `softScale` (default 1.4) with a Gaussian
falloff, `0.95 * exp(-falloff * r2)` over the quad (r2 = 1 at its edge), premultiplied alpha blending, depth test against
the cores, no depth write. Splats overlap their neighbours with soft edges, and nothing is sorted: the order dependence is
confined to the feathered rims. `?softcore=`, `?softscale=`, `?softfalloff=` change the three numbers. The default look is
unchanged (one opaque pass).

### Observations (looked at, one browser, Kawazu archive)
- First defaults (core 0.8, feathered 1.4, falloff 3.5): edges between splats melt into each other; the picture is slightly
  softer than the flat one and otherwise the same.
- A stronger setting (core 0.5, feathered 2, falloff 7) gave a soft, painterly foliage while the bridge and the road stayed
  legible, **but hfu saw a regular pattern of dark circles on flat ground** (a screenshot of fields and houses): the shrunken
  opaque cores left gaps between them, so only the semi-transparent feathered splats covered the gaps (the basemap shows
  through as a pale haze) and each core showed as a dot. Flat ground is where splats sit on a grid.
- Fix: the cores always cover the surface. The core is now the full extent (`coreScale` 1, as the flat look draws it, with the
  `?extent=` that covers gaps), and only the feathered splat is larger (1.8, falloff 6.5, a Gaussian over 3.6 sigma across).
  The same camera that showed the dots (zoom 17.67, bearing -30, pitch 60, lower-left ground below the bridge) shows none; a
  close forest view (zoom 19.4) and a mountain-side view (zoom 18.3) show none either. Not checked: hfu's exact view of the
  fields and houses (its coordinates were not given, and a search for it in the nine meshes did not find it).
- `?shade=<0..1>` scales the fixed Lambert shading (uniform `u_shade`, in all three vertex shaders): at 0 the colours are drawn as
  stored, lighter and closer to a photograph (the forest greener), as 3D Gaussian splatting does (it has no shading).
- Cost not measured (two draw calls per tile instead of one).
- Not done: a sorted, depth-correct blend (true splat compositing), which would need sorting per frame.

### Decision
Open: hfu to judge by eye (`?fixture=kawazu-stars&look=soft`, with `&shade=0`).

## E019: a button to take vegetation away; what bare ground looks like

### Question
hfu asked for a button that removes vegetation, to see what the ground looks like in the soft look (E018).

### Method
1. A guess from the splats alone (`demo/src/vegetation.ts`, a "hide vegetation (guess)" checkbox, `?hideveg=1`): the tile is cut
   into cells of 4 m; the ground of a cell is the lowest splat in it and its eight neighbours; a splat is vegetation when it is
   more than 2 m above that and round (largest scale below 1.5 times the smallest, as the shader's disc rule). Computed when a
   tile loads, one flag byte per splat, uploaded as an instanced attribute (`a_veg`), skipped in the vertex shader
   (`u_hide_veg`). Works with versions 5 and 6.
2. The real classification: the tileset builder already filters by LAS class. Mesh 08OF4060 built with `@c2` on both the MMS and
   the airborne file (class 2 is ground in both): `kawazu-ground`, version 6, same recipe.

### Measurements
- The guess flags 11.0 % of the z17 splats of the nine-mesh archive (10.8 % at z16). Without the shape test it would flag
  98.8 %: **the height test does not work on this terrain**: the lowest splat of a 12 m window on a 45 degree slope is 10 m below
  the others, so nearly everything is "above ground". Heights 1, 3 m and cells of 8 m change the share by 0.2 points: the shape
  test decides. Time: about 0.2 s per 1.2 million splats in Node.
- Bare ground (`@c2`): 52,570 z17 splats (7.5 % of 702,139), 806,679 bytes for the mesh against 13.1 MB.
- Seen in the browser (soft look, no shading, zoom 17.67, pitch 60): with the guess on, the forest loses its speckle but the
  canopy surface stays: it is round blobs that go, not the canopy. With `kawazu-ground` the trees are gone: the slopes, the
  road bed, the bridge piers and the stream bed show as bare earth, with white gaps where the ground splats are too sparse to
  cover (laser returns on the ground under dense canopy are few).

### Observations
- The splats alone do not tell vegetation from ground here; the classification of the point cloud does. The checkbox is kept as
  an honest, weak guess; for ground use the class.
- A ground-only archive of the whole 1.08 km2 would be about 7 to 10 MB (the mesh is 0.8 MB), small enough to host beside the
  full one. Not built.
- A real button needs the class in the tiles (a class code per splat: the alpha byte of version 5 is free for it; version 6
  has one opacity per block and no spare bits). It would serve the vivid-colour and the false-colour ideas as well (colour by
  class). Not done.

### Decision
Open. The checkbox and the guess stay in the branch as an experiment; the next step, if hfu wants it, is the class per splat.

## E020: what would a class per splat cost in the tiles? (analysis)

### Question
A class for every splat (ground, vegetation, ...) would give a real "hide vegetation" button (E019), vivid colours by class and
false-colour classification. How much of the size work (E016) would it cost?

### Method
No format change. The class goes through the existing pipeline in the opacity byte of version 5 (analysis only, behind
`DORAYAKI_CLASS_ALPHA=1`): the voxel accumulator takes optional class slots (point counts by class per voxel), the adaptive merge
sums them exactly, and a splat's opacity byte becomes `slot * 32 + round(share * 31)`: its dominant class and the share of its
points in it (purity). Slots: LAS class 0 to 5; 6 = class 1 on a pulse with several returns (the airborne files have only
classes 1 and 2, so canopy is told by multiple returns); 7 = other. Built with the Kawazu recipe: meshes 08OF4060 (MMS and
airborne), 08OF4062 and 08OF4050 (the latter two airborne; 4050 also has MMS). The tile sizes equal those without classes (13,127,264
bytes for 4060). `npm run measure:class -- <zoom> <dir>...` reads the tiles and reports the class mix, purity, entropies and coded
sizes. The price of freeing bits inside the 96-bit record comes from `npm run measure:precision` (software renderer, E012).

### Measurements
Class mix at z17 (2,127,206 splats): ground (2) 8.5 %; vegetation (3 to 5 from MMS 11.3 %, and 75.1 % unclassified airborne points
with several returns) 86.4 %; other 5.1 %. At z16 (257,565 splats): ground 13.5 %, vegetation 82.4 %; at z15 (34,545): 15.3 %, 82.6 %.
Purity (share of a splat's points in its dominant class): at least 0.9 for 76.9 % of the z17 splats, 63.0 % at z16, 47.4 % at z15
(merged splats mix classes).

Bits per splat to store the class (z17; z16 and z15 are within 0.1 of these except where noted):
| form | bits per splat |
| --- | ---: |
| ideal, 8 slots, no context (zero-order entropy) | 1.15 (z16 1.53, z15 1.84) |
| ideal, 8 slots, given the previous splat's class (raster order) | 0.82 (0.89, 1.12) |
| ideal, 3 groups (ground, vegetation, other), given the previous | 0.62 (0.58, 0.59) |
| ideal, ground or not, given the previous | 0.37 (0.38, 0.46) |
| 1 byte per splat, gzip per tile | 0.99 (1.04, 1.34) |
| 2 bits per splat (3 groups), gzip per tile | 0.71 (0.67, 0.72) |
| run lengths (varint), gzip per tile | 0.77 |
| 1 bit per splat (ground or not), gzip per tile | 0.39 (0.42, 0.56) |
| 2 bits packed, not compressed | 2 |
| 1 byte, not compressed | 8 |

Cost for the nine-mesh archive (6,935,498 splats; 83,230,962 bytes as version 6):
| way of storing the class | extra bytes | share of the archive |
| --- | ---: | ---: |
| nothing extra: take it from the version 5 opacity byte (keeps 16-byte records) | 0, but version 5 is 33 % larger than 6 | +33 % against version 6 |
| 1 byte per splat next to the 12-byte records | 6.94 MB | +8.3 % |
| 2 bits per splat packed | 1.73 MB | +2.1 % |
| fine class, byte plane, gzip per tile | 0.86 MB | +1.0 % |
| 3 groups, 2-bit plane, gzip per tile | 0.61 MB | +0.74 % |
| ground or not, 1-bit plane, gzip per tile | 0.34 MB | +0.41 % |
| 3 groups, ideal with context | 0.53 MB | +0.64 % |
| class bits inside the 96-bit record (no extra bytes) | 0 | 0; colour error 1.59 -> 1.76 for 2 bits (position 12 bits), 1.82 for 3 bits (position 12 bits and height 4 cm), 1.93 (rotation 4 bits), 2.03 (colour 5 bits); PSNR 40.0 -> 38.3 to 39.1 dB; holes 0.07 -> 0.07 to 0.10 % |

### Observations
- A class plane compresses very well because classes come in runs along the raster order (the previous splat's class cuts the
  entropy by about 30 %): about 0.4 to 1.0 bit per splat, 0.4 to 1.0 % of the archive. The expensive ways are the uncompressed
  ones (2 % for two bits, 8 % for a byte).
- Inside the record the class is free in bytes but costs picture quality: two bits cost 0.17 of 255 (11 % more colour error),
  three bits 0.23 to 0.44, and the record is then fixed to 3 or 4 classes.
- The class plane has to be a separate unit to be cheap: the browser decodes gzip natively (`DecompressionStream`), so a gzip-ed plane
  inside the tile (a second MLT frame) is possible even though stars' Martin cannot read gzip tiles. A separate sidecar archive
  would cost the plain tiles nothing.
- How good the class is limits what a button can do: 75 % of the airborne splats are "several returns", which is vegetation but
  also the edges of structures; MMS classes 3 to 5 are a different (finer) vegetation scale from the airborne rule; only 5 % are
  "other", so bridges and buildings are not separated; at z15 only 47 % of the splats are 90 % pure. These matter more than the bytes.
- In the ground class the data is thin (8.5 % of the z17 splats, 7.5 % of the mesh's splats for `@c2`): the bare-ground picture
  has gaps under dense canopy (E019).

### Decision
Not a format change yet. The analysis says that the size penalty is small (about 0.4 to 1 % of the archive) if the class is a
gzip-ed plane beside the 12-byte records, and 2 to 8 % if it is stored plainly. The open design question is where the plane lives (a
second frame in the tile, or a sidecar archive) and what classes the build can really provide.
