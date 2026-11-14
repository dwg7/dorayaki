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

Host `medium` as `dorayaki-numazu.pmtiles` (2,204,268 B): the best balance
of size and look here, and it matches the request for slightly coarser
surfels. `fine` stays as a profile for reference and for datasets dense
enough to need progressive levels. `coarse` is the floor if size matters
more than close-up quality. The final choice is the repository owner's.
