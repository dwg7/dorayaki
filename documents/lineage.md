# Lineage: where surfels and splats come from, and what Dorayaki can take from it

Status: a reading note (2026-11-28, asked for by hfu), not a decision. Each entry gives the source; what the sources say is separated from what it suggests for
Dorayaki. Facts about QSplat are from the paper's text; the others from the papers' abstracts and project pages.

## The line

| year | work | what it brought |
| ---: | --- | --- |
| 1985 | Levoy and Whitted, *The Use of Points as a Display Primitive*, UNC Chapel Hill TR 85-022 ([Stanford page](https://graphics.stanford.edu/papers/points)) | Points as a general rendering primitive that separates modelling from rendering; a dense grid of displaced points can form a continuous surface. |
| 1989 | Heckbert, the elliptical weighted average (EWA) texture filter | The resampling filter that surface splatting later turned into a splat kernel (cited by Zwicker et al. 2001). |
| 2000 | Pfister, Zwicker, van Baar, Gross, *Surfels: Surface Elements as Rendering Primitives*, SIGGRAPH 2000, pp. 335-342 ([project page](https://cs.umd.edu/~zwicker/projectpages/Surfels-SIG00.html), [MERL TR2000-10](https://merl.com/publications/TR2000-10)) | The word *surfel* (surface element): point samples without connectivity as an alternative to triangles; *visibility splatting* finds visible surfels and holes in the z-buffer; simple enough for hardware. |
| 2000 | Rusinkiewicz and Levoy, *QSplat: A Multiresolution Point Rendering System for Large Meshes*, SIGGRAPH 2000, pp. 343-352 ([paper page](https://www.cs.princeton.edu/~smr/papers/qsplat)) | A bounding-sphere hierarchy used for culling, level of detail and drawing at once; quantized nodes; screen-size level of detail with frame-rate feedback; progressive loading from disk. Details below. |
| 2001 | Zwicker, Pfister, van Baar, Gross, *Surface Splatting*, SIGGRAPH 2001, pp. 371-378 ([Harvard VCG](https://vcg.seas.harvard.edu/publications/20010101-surface-splatting)); *EWA Splatting*, IEEE TVCG 8(3), 2002, pp. 223-238 ([Harvard VCG](https://vcg.seas.harvard.edu/publications/20020101-ewa-splatting)) | A screen-space EWA filter for irregular point samples: anisotropic filtering, hidden-surface removal, edge anti-aliasing, order-independent transparency. The same kernel renders surfaces and volumes. |
| 2015 to 2018 | Whelan et al., *ElasticFusion*, RSS 2015 ([Imperial page](https://www.imperial.ac.uk/dyson-robotics-lab/projects/elasticfusion/)); Behley and Stachniss, *SuMa*, RSS 2018 | Surfels as a *map*: dense SLAM that fuses RGB-D frames into a globally consistent surfel map (room scale), then the same idea outdoors with spinning lidar (SuMa; read from a secondary summary only). |
| 2016 | Schütz, *Potree: Rendering Large Point Clouds in Web Browsers*, TU Wien ([thesis page](https://www.cg.tuwien.ac.at/research/publications/2016/SCHUETZ-2016-POT/)) | Point clouds streamed into a browser through a multi-resolution octree (coarse points in the root, finer with each level); up to 597 billion points, about 1.6 TB compressed. The closest web relative of Dorayaki. |
| 2023 | Kerbl, Kopanas, Leimkühler, Drettakis, *3D Gaussian Splatting for Real-Time Radiance Field Rendering*, ACM TOG 42(4) ([arXiv 2308.04079](https://arxiv.org/abs/2308.04079)) | Anisotropic 3D Gaussians optimized from photographs, drawn by a fast visibility-aware rasterizer: EWA-style splatting revived with learning. |
| 2024 | Huang, Yu, Chen, Geiger, Gao, *2D Gaussian Splatting for Geometrically Accurate Radiance Fields*, SIGGRAPH 2024 ([arXiv 2403.17888](https://arxiv.org/abs/2403.17888)) | Back to flat, oriented discs (surfels) for consistent geometry, with depth-distortion and normal-consistency terms; unlike earlier surfel methods, recovered without known geometry. |

Dorayaki sits on this line twice: its first record (position, normal, radius, color in 32 bytes) was the surfel of 2000; version 6 is a flat anisotropic Gaussian
(three scales and a rotation, the shortest axis taken as the normal), which is closer to 2D Gaussian splatting. What it adds is the map: z/x/y tiles, an MLT frame, and
heights above the geoid.

## QSplat in more detail (from the paper's text)

- **Node size**: a quantized node is 48 bits, 32 without color (position and radius 13 bits through a lookup table, normal 14 bits, normal-cone width 2 bits, color
  5-6-5 in 16 bits, plus tree bits); with pointers, about 9 bytes per leaf, 6 without color. Positions are relative to the parent sphere, so precision is spread over the
  levels.
- **Level of detail**: a node is subdivided while its projected area exceeds a threshold; the threshold follows the previous frame's time to hold a user-chosen frame
  rate; when the mouse stops, the scene is redrawn with smaller thresholds down to one pixel. No smoothing between levels: the authors did not find it visually
  significant for their use, and note that other applications might.
- **Kernel**: squares, circles and Gaussians were compared; at the same threshold circles took about twice and Gaussians four times as long as squares, and Gaussians
  aliased much less; at equal rendering time, squares looked best.
- **Loading**: the file is breadth-first, so its first part is the coarse model; data is memory-mapped and read when looked at, with a frame-rate glitch the first
  time an area is zoomed into.
- **Its own limit**: "If the model has large, flat or subtly curved surfaces, polygonal models can be more compact" and look better when zoomed in near sharp edges.

## What it suggests for Dorayaki (proposals, not decisions)

1. **Level of detail by screen size is the main line** (QSplat, Potree). hfu's idea of pruning splats whose long axis is too short for the zoom is this rule applied
   at build time, per zoom. QSplat also suggests where to keep more: silhouettes (normals), high curvature (normal-cone width), the centre of the screen.
2. **Hold the frame rate, not the detail** (QSplat's feedback threshold). D22 puts smoothness first; the viewer's budget (D15) is fixed today. A budget that follows
   the measured frame time would be the QSplat answer.
3. **Coarse first, refine when idle** (QSplat). Dorayaki's staged loading does the first half; drawing finer only when the camera rests is not done.
4. **The kernel is a trade between cost and aliasing** (QSplat's measurement, EWA). hfu's "Gaussian-like look" idea should be measured as QSplat did: same time budget,
   not same detail. Distant zooms are where aliasing shows, so the EWA low-pass filter belongs to the smoothness work, not only to looks.
5. **Flat regions favour polygons** (QSplat's own limit). This is hfu's TIN observation from the other side: Dorayaki's merge already makes large flat splats; an error
   bound in the TIN sense is the merge rule (E026).
6. **The normal is a first-class attribute** (2D Gaussian splatting). Coloring by tilt (hfu) uses exactly the quantity 2DGS regularizes; its axis-sign ambiguity is
   the open item of format.md.
7. **Surfels as a map that is updated** (ElasticFusion, SuMa). Robotics fuses new observations into an existing surfel map; Dorayaki rebuilds tiles. Fusing a new survey
   into existing tiles is a possible later direction.

Bytes, for scale: QSplat about 6 to 9 bytes per leaf (isotropic sphere, normal, color, tree); Dorayaki 12 bytes per splat (anisotropic scales, full rotation, color,
height in metres, no tree, because the tile pyramid is the hierarchy).
