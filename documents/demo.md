# Demo, site and camerawork

The browser demo (`demo/`), the GitHub Pages site (`docs/`, built by `npm run site`), the dark basemap and the camera direction (shot player and tours). The sections below were separate documents until 2026-11-27.

Commands named in the older sections below that are no longer in package.json (`build:tileset`, `merge:tilesets`, `demo:numazu`, `measure:*` other than `measure:codec` and `measure:quality`, `prototype:tile-scatter`, `compare:tile-build`) and `DORAYAKI_BLOCK_VERSION` were removed on 2026-11-27 (compaction, [decisions.md](decisions.md)); they are in Git at the tag `pre-compaction-2026-11-27`. Their results are in EXPERIMENTS.md.

Contents: demo and site, dark basemap, camera direction.

## Browser demo and GitHub Pages site

Status: implemented. This page holds the developer details of the demo that
the README only summarises.

### Run locally

```sh
npm install
npm run demo
```

Open <http://127.0.0.1:8000/demo/> in a browser with WebGL2. The server is
esbuild's dev server with the repository root as document root, so the page
can load MapLibre GL JS from `node_modules/` through an import map. It
listens on 127.0.0.1 only. Stop it with Ctrl-C.

The camera is kept in the URL fragment (`#map=zoom/lat/lng/bearing/pitch`).
Other fixtures: append `?fixture=overhang`, `?fixture=boundary` or
`?fixture=toy-gs`.

The page loads the fixture's tiles over plain HTTP:
`demo/tiles/{fixture}/18/234000/96256.mlt` (at Sapporo Station, 111.7 m
wide) for `bridge` and `overhang`, and that tile plus its east, south and
south-east neighbours for `boundary`. Each tile holds a synthetic unknown
frame followed by the fixture as an experimental surfel frame. The red
dashed lines are tile boundaries. The "depth test" checkbox turns depth
testing off. The basemap is the dark `bvmap-nightsky` style from
[hfu/stars](https://github.com/hfu/stars) (`?basemap=starlight` for the light one; documents/demo.md), so the page needs network access
for the background map (not for the surfels).

Each splat is drawn as its 2-sigma ellipse in the plane of its two longer
axes; splats with no preferred orientation are drawn as camera-facing
discs. Mercator projection only.

### URL flags

All optional; the camera is in the fragment, the rest in the query.

| flag | effect |
| --- | --- |
| `?fixture=<name>` | tileset: `bridge`, `overhang`, `boundary`, `toy-gs`, or a real-data set listed in `EXTERNAL_TILESETS` of `demo/src/main.ts` (`numazu*`, `kawazu-*`; those under `demo/tiles/` exist only after building them) |
| `?lod=<zoom>` | choose tiles and levels as if the map were at this zoom |
| `?terrainshift=<metres>` | lower the terrain by this much (default 2): the DEM lies up to 2.4 m above the point cloud's ground and would hide splats there (E010) |
| `?terrain=<exaggeration>` | add MapLibre terrain from stars' `mapterhorn-japan-bridge` Terrarium DEM. Needed for data far above sea level: without terrain the camera is relative to 0 m and high data vanishes or is magnified (NOTES.md) |
| `?look=soft` | the soft look (E018): every splat is drawn twice, an opaque core of the full extent that carries the depth, then a larger Gaussian-feathered, alpha-blended splat on top; `?softcore=` (default 1; below about 0.75 the cores leave gaps and the feathered splats show as a pattern of dots), `?softscale=` (1.8) and `?softfalloff=` (6.5) tune it |
| `?hideveg=1`, the "hide vegetation" checkbox; `?hide=3,4,...` | hide the splats of the vegetation classes (3, 4, 5 and 64) or of the listed class codes, from the tile's class plane ([format.md](format.md), E021). A tile without a plane gets a weak guess from the splats alone (E019: well above the local ground and round, about 11 % of the Kawazu splats; `?vegh=`, `?vegcell=`, `?vegshape=0` tune it) |
| `?color=class`, the "color" select | draw by class in a vivid palette, with a legend (E021); needs a class plane to be meaningful |
| `?measure=1` (with `?mixed=1`) | E028: every 250 ms, the share of the wanted tiles' ground the layer holds (`cTarget`) or covers with an ancestor or descendants (`cAny`), and every fetch's start, end and bytes, in `dorayaki.e028` |
| `?route=0` | E029 off: a tour only prefetches the tiles 1.5 and 3 s ahead. By default (with `?mixed=1`) a tour plans its tiles before playing (`demo/src/tour-plan.ts`), fetches them in deadline order, waits until the measured rate can deliver them in time (at most 30 s; the control shows a red lamp, "Loading tiles before the tour", the seconds waited and an estimate of the rest, and Stop; a green lamp while the tour plays), and keeps them from being evicted while it plays |
| `?cold=1` | E028: a query on every tile URL that no cache has seen, so the tiles come from the server as on a first visit |
| `?color=slope`, `?color=aspect` | draw by the tilt of each splat's normal (hfu's idea, 2026-11-28), keeping the stored brightness: `slope` blue flat, green 45°, red vertical; `aspect` hue by the facing direction (axial: a direction and its opposite share a hue, because the normal's sign means nothing), saturation by slope from white (flat) to full at 45°. Round splats (no normal) are grey. In Sasebo, walls take one hue per face while vegetation scatters into confetti |
| `?shade=<0..1>` | strength of the shading: 1 (default) is the fixed two-sided Lambert light, 0 draws the colors as stored (no shading, as 3D Gaussian splats do) |
| `?mixed=1` | draw tiles of several zooms at once, chosen by distance from the camera (`mixed-selection.ts`; E015). `1`: under a budget that always covers the view with the coarsest tiles, then refines the nearest first (E024; `?budget=` megabytes, default 40, `?splats=` default 4000000; sizes of loaded tiles, else a guess by zoom); `2`: the older cap of the 24 nearest tiles, instead of the nearest nine tiles of one zoom (the default for `sasebo`; `?mixed=0` switches it off) |
| `?shots=<name or path>` | play a shot script once the first tiles are drawn (`shot-player.ts`; a bare name is `shots/<name>.json` next to the page, e.g. `?shots=sasebo`; the site build copies `demo/shots/` to `docs/shots/`). Without it, a tileset with a tour (`TOURS` in main.ts: `sasebo`) shows the control with a Play tour button and does not start by itself. The control (`shot-control.ts`, top right) shows playing / finished / stopped, the time and a progress bar, with Stop or Replay; any other pointer, wheel, touch or key input on the map stops the tour |
| `?staged=0` | switch off the staged first display: the next coarser zoom is shown while the first set of tiles loads (E014) |
| `?dz=<metres>` | raise every tile, to test high-elevation behaviour |
| `?keepzoom=0` | with terrain on, leave the zoom as MapLibre sets it when a pan drag ends. By default the demo puts the zoom back to what it was when the drag started (`pan-zoom-keeper.ts`; with an ease of `?zoomease=` ms, default 1500, 0 jumps): MapLibre GL JS 6.16.0 keeps the camera's height above sea level across a pan drag, so panning toward higher ground brought the camera down onto the slope and the zoom up to 22 (NOTES.md, 2026-11-17) |
| `?fade=0` | keep the basemap at full opacity. By default its layers fade from zoom 15.5 to 20 % at zoom 19, so the splats stand out. Only layers whose opacity is a plain number are changed (92 of 135 opacity properties of the bvmap-starlight style, including 59 of 99 line properties); layers with their own zoom expressions are not |
| `?extent=<factor>` | scale every splat's semi-axes (default 1); about 1.3 closes the gaps between neighbours ([build.md](build.md)) |

The panel at the top left has a minimize button (the title stays).

In the page, `window.dorayaki` exposes `map`, `layer`, `loaded`, `timings`,
`report()`, `measureFrames()` and `holeFraction(rect)` for measurements.

**Measuring in a hidden pane is misleading.** A page in a hidden browser pane
runs as a background page; MapLibre's `load` waits for a rendered frame and was
delayed by about 60 s (NOTES.md, 2026-11-15). Show the pane before timing
anything.

### Demo modules (`demo/src/`)

Kept separate as AGENTS.md requires.

| module | responsibility |
| --- | --- |
| `load-tile.ts` | fetch tile bytes over HTTP |
| `tilejson.ts` | read TileJSON of external tilesets |
| `decode-tile.ts` | MLT frame extraction + Surfel Block decoding |
| `tile-selection.ts` | choose zoom and level prefix |
| `tile-matrix.ts` | tile-local to Web Mercator placement (float64) |
| `camera.ts` | the map view's camera (as MapLibre's), effective zoom of a point, visible ground |
| `pan-zoom-keeper.ts` | keep the zoom across a pan drag over terrain (workaround; `?keepzoom=0` switches it off) |
| `mixed-selection.ts` | tiles of several zooms by distance (`?mixed=1`) |
| `shot-player.ts` | shot scripts played as a camera (`?shots=`), step 1 of documents/demo.md |
| `shot-control.ts` | the tour's status control: playing / finished / stopped, progress, Play tour / Stop / Replay |
| `status-format.ts` | the panel's status figures in bounded widths (MB with one decimal, splats in k or M): the panel shows a loaded and a drawn row in fixed columns and a loading bar, so it keeps its size while a tour plays (2026-11-28) |
| `splat-instances.ts` | camera axes for the shader, and per-splat instance math kept as the reference for the packed shader's decoding (tests) |
| `gpu-surfels.ts` | shader decoding the 12-byte version 6 records, buffer upload, instanced draw |
| `surfel-layer.ts` | MapLibre `CustomLayerInterface` lifecycle; `setTiles` swaps the tile set |
| `tile-view.ts` | which tiles of a zoom intersect the view (nearest first, at most 9) |
| `tile-streamer.ts` | loads the in-view tiles of the selected zoom and hands the whole set over when complete |
| `main.ts` | map setup and wiring |
| `demo-tile.ts` | demo tile address and deterministic tile bytes |

### Tile streaming

The demo does not fetch every tile of a tileset. On load and after every map move
(`moveend`) it picks the zoom (`selectZoom`), takes the tiles of that zoom that
intersect the view, nearest to the centre first and at most nine, and fetches,
decodes and uploads only those. The previous set keeps being drawn until every
tile of the new set has arrived, then the whole set is swapped (no holes; the status
bar under the status fills as the set arrives). A tile's 12-byte records are taken from the block as they are (no Splat objects) and uploaded to the GPU, where the vertex shader decodes them (E013, then version 6; the float-instance path `?gpu=legacy` was removed on 2026-11-27); the layer drops its copy after the upload, so the JS heap stays near 230 to 420 MB at the Kawazu views (E011). If the WebGL context is lost and restored, MapLibre does not bring the custom layer back: the demo adds a new layer and loads the tiles again. A tile already in flight or held is reused;
tiles outside the new set are freed (a tile seen again is fetched again, usually
from the browser's HTTP cache). Kawazu's nine-mesh set (46 tiles, 83 MB) has 12 tiles at z17; before the cap of nine,
zoom 17.6 requested 12 (59 MB). At the showcase view (zoom 16.6) the page fetches 10.8 MB (E011).

### Terrain at low zoom

With terrain on (Kawazu's default) MapLibre's terrain follows the DEM tile of about the map's zoom, so at low
zoom it is a smoothed ground that lies above the splats in places and hides them. The demo raises the layer by
`terrainLift(zoom)` (`demo/src/terrain-lift.ts`): 0 at zoom 15 and above, 9 m per zoom level below, at most
40 m. Measurements and what was tried: NOTES.md (2026-11-16, white holes at zoom 12.7).

### GitHub Pages site

Published from `main:docs/` at <https://dwg7.unopengis.org/dorayaki/>.
`docs/` holds only the built site; design documents live in `documents/`.

```sh
npm run site    # rebuild docs/ (wiped and rewritten); commit the result
```

GitHub Pages does not build anything. The page is a single file:
`docs/index.html` carries all JavaScript (the demo and MapLibre GL JS,
bundled by esbuild) and all CSS inline, with no content hashes in file
names. Besides the page, only MapLibre's Web Worker
(`docs/maplibre-gl-worker.mjs`, which cannot be inlined), the synthetic
tiles and `.nojekyll` are separate files. MapLibre derives its worker URL
from its own `import.meta.url`, which bundling turns into the page URL, so
the build defines the worker's page-relative path and the demo passes it to
`setWorkerUrl`. The build fails if the worker is not self-contained.

The Numazu tileset is not copied into `docs/`; it is listed only when the
build is given its TileJSON:

```sh
DORAYAKI_NUMAZU_TILEJSON=https://stars.optgeo.org/dorayaki-numazu npm run site
```

In the page's console, `dorayaki.report()` and `await
dorayaki.measureFrames()` give load, upload and frame timings.

## Dark basemap for the splat demo (proposal)

Status: **in use.** The style `bvmap-nightsky` is served by hfu/stars (`https://stars.optgeo.org/style/bvmap-nightsky`, checked 2026-11-27) and is the demo's default basemap
(`?basemap=nightsky|starlight` or a style URL; `demo/src/main.ts`). Whether it is the mechanical night version below or a palette made in bvmap is for the bvmap repository
to record; this page keeps the reasons and the first prototype. The sections below were written as a proposal on 2026-11-22.

### Why

The demo draws splats over the bvmap-starlight basemap, which is light (white background, white `AdmArea` fill, silver
grays). Where the splats are missing (camera close to a slope, the edge of the data, tiles still loading) the screen
shows white, which reads as a broken page (NOTES.md, 2026-11-22). The mean color of the splats on screen in Kawazu was
rgb(68, 71, 67) (z18.5, pitch 60), an almost neutral dark olive gray. A basemap close to it makes gaps look like more
ground.

### What was tried (demo only, nothing committed upstream)

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

### Where a real dark style belongs

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

### Name

Starlight names the palette (low saturation, bright, silver gray). The general-purpose dark style that is kept beside it
is named **`bvmap-nightsky`** (chosen by the owner on 2026-11-22; the other candidates were `bvmap-midnight` and
`bvmap-moonlight`). The tea names stay with koicha (the tile set), so a koicha style from it would follow koicha's own
naming rule (D20), which is for that repository to settle.

### Next steps (as proposed on 2026-11-22; steps 1 and 2 are for the bvmap and koicha sessions, step 3 is done: hosted and the demo's default)

1. Send this note to the bvmap session (palette, halo, sprite) and the koicha session (generated style); neither session was running on 2026-11-22.
2. Prototype as a second palette in `starlight-input.yaml`; compare with the mechanical version above.
3. Then publish through hfu/stars, with the owner's approval, and point the demo at it.

## Camera direction: language-driven camerawork for 3D surfel maps (idea note)

Status: an **idea note**, written 2026-11-26 at Fujimura's request. Nothing here is
implemented, and nothing here is a specification. It records a direction to explore,
in the spirit of the house rules: the naive thing first, optimization and wire
decisions only after a real problem shows itself.

### The problem

Dorayaki puts real 3D geometry on a map, and the moment the map is 3D the camera
becomes the hard part. A 2D map asks for three degrees of freedom (pan x, pan y,
zoom), which a drag and a wheel cover almost exactly. A 3D view adds pitch, bearing,
camera height and a look-at point that is no longer the map center. A 2D pointing
device cannot express that, and the failure modes are familiar to anyone who has
flown the demo by hand: the subject leaves the frame, the camera clips into a
building, the user ends up looking at the underside of the terrain, or simply gets
lost and resets the view.

The claim of this note: **direct manipulation is the wrong abstraction for a 3D
map camera.** In film, the director does not carry the camera; the director states
intent and the camera operator executes. A 3D map should work the same way: the
human says what they want to see, the computer does the camerawork.

### The proposal

A *director* that turns intent into camerawork on MapLibre GL JS, in two forms that
share one shot representation. The forms are not equal in priority: **the
agent-operated form comes first** (decided by Fujimura, 2026-11-26); the in-browser
control is a later host for the same director, not the starting point.

1. **An agent-operated map.** The shot script is the contract by which an external
   agent (an LLM agent such as the ones already working in dwg7) operates the map
   on the user's behalf: the agent reads the scene, writes shots, and the map
   executes them.
2. **A MapLibre control inside dorayaki.** A `DirectorControl` (working name) next
   to the existing controls: the user types or picks an intent ("show me Sasebo bay
   from the sea, then move in on the shipyard"), the control compiles it to a shot
   script, previews it, and plays it by driving the map's camera. The control is
   the in-browser host of the director; the agent interface is the out-of-browser
   host. One shot model, two hosts.

The deliverable of the director is not a video file. It is a *live* camera
performance on the real renderer, over the real tiles, which the user can interrupt
at any moment (any manual input hands control straight back).

### The shot model

A shot is the unit of camerawork. Each shot carries two paths, not one:

- the **camera path** (where the camera is, in space, over time), and
- the **look-at path** (what it is pointed at, over time),

plus a duration and an easing. This is the drone operator's model — airframe path
plus gimbal target — and it is what `flyTo`/`easeTo` cannot express, since those
animate a single map state (centre, zoom, pitch, bearing) from A to B.

A small set of primitives covers most intents; they are the vocabulary the
director compiles into:

| Primitive | Meaning |
|---|---|
| `hold` | Static camera; the subject or the light changes, not the camera |
| `orbit` | Circle a subject at a fixed radius and height |
| `dolly` | Move toward (or away from) a subject along the view axis |
| `crane` | Rise (or descend) while holding the subject: the reveal |
| `track` | Follow a linear feature — a river, a coast, a road — at a stand-off |
| `traverse` | Pull back from A, travel, and settle on B (the establishing move) |

Sketch of the representation (a sketch, not a format; no wire decision is made
here):

```json
{
  "shots": [
    { "type": "crane",  "subject": "sasebo-bay",  "from": { "alt_m": 60 },  "to": { "alt_m": 900 }, "duration_s": 8, "easing": "easeInOut" },
    { "type": "dolly",  "subject": "shipyard",    "to": { "range_m": 250 }, "duration_s": 6, "easing": "easeOut" }
  ]
}
```

Subjects are named places or features, resolved against a scene index (below),
not raw coordinates: the user and the agent both speak in subjects.

### Executing shots on MapLibre

- `flyTo` and `easeTo` interpolate map state, not a camera. For directed work the
  player drives the camera per frame (`requestAnimationFrame`), interpolating the
  camera path and the look-at path separately (spline through keyframes, easing
  applied to shot progress).
- The `center`/`zoom`/`pitch`/`bearing` state is an approximation of a camera: it
  cannot set camera position, field of view and attitude independently. Where a
  shot needs the real thing, `FreeCameraOptions` (camera position as a
  `MercatorCoordinate` with altitude in metres, plus orientation) is the honest
  interface. Which shots can live with the approximation is an experiment to run,
  not a decision to make here.
- MapLibre itself is not modified (house rule). The director is a control plus a
  player; the surfel layer does not need to know it exists.
- **Camera speed is a streaming problem.** A shot that outruns tile loading shows
  holes. The player should know the tile budget along the path — prefetch ahead of
  the camera, and cap shot speed by what the archive can stream, the way the
  covering-view budget already caps tile selection in the demo.

### Scene awareness: the surfels are the set

A directed camera needs to know the scene, and dorayaki is unusual here: the tiles
*are* measured 3D geometry. That gives the director facts a flat map cannot offer:

- **Subject geometry.** Height and extent of a subject from surfel statistics in
  its tiles: the stand-off distance and framing of an `orbit` or `dolly` can be
  derived from the data, not guessed.
- **Collision and clearance.** Keep the camera path above the maximum surfel
  height along its corridor (plus a margin), so a `track` along a valley does not
  clip the slope. The demo already concedes this point for manual control: it
  keeps the camera a minimum height above the ground under it
  (`demo/src/camera-clearance.ts`, `?clearance=`, default 15 m) and works to stop
  the view sinking onto slopes during a pan (`demo/src/pan-zoom-keeper.ts`). Even
  hand navigation already needs machine assistance; direction is that assistance
  taken seriously.
- **Data range.** A shot must stay inside the range where real data exists; a
  pull-back that reveals missing or placeholder geometry is a failed shot. (The same
  rule appears in geo-video-factory's camera review: never adopt a framing where
  the buildings disappear.)
- **A scene index.** Subjects need names and footprints: place names, notable
  features, per-area summaries. This is the grounding an LLM compiler needs so
  that "the shipyard" resolves to coordinates and a height. Where that index lives
  (tile metadata, a sidecar, the cafebabe/miso knowledge work) is an open question.

### The real-world link: drones speak the same language

This is where dwg7's position is unusual, and worth stating plainly: **the group
works across web, embedded and the physical world, and the shot abstraction is the
same in all three.**

- yuiseki's drone work (UNopenGIS/7 issues #1021 and #1036; `yuiseki/dji-waypoints`)
  plans physical camera flights for 3DGS capture: waypoint path, gimbal angle,
  speed, and hard-won lessons (sub-metre waypoint spacing breaks heading/gimbal
  compliance; the planner must respect what the aircraft will actually do).
- A shot designed against dorayaki's surfels could be *flown* by a drone to capture
  the very point cloud the next build consumes, and a flown mission could be
  *rehearsed* in dorayaki before anyone travels to the site. Design in the virtual
  camera, verify in the real one, feed the capture back into the tiles.
- The constraints differ (a drone has battery, wind and regulation; a virtual
  camera has tile streaming and render load) but the intent layer — subject,
  primitive, path, look-at, duration — is shared. One vocabulary, three hosts:
  agent, browser control, aircraft.

### Prior art in the group

`yuiseki/geo-video-factory` (2026-11) is the closest existing work and should be
read before building anything: an AI agent writes shot JSON, and a renderer
(TypeScript, headless Chromium via Playwright) drives a MapLibre camera over GSI
photo/elevation terrain and PLATEAU buildings to produce narrated explainer
videos. Its `geo-video-camera` skill codifies shot recipes (dolly, tracking,
orbit, reveal, overhead — a standard set of ten), easing conventions, focus
fixing in 2.5D/3D, and a review checklist (speed, chapter boundaries, label
collisions, data range). Two differences from this note:

1. geo-video-factory renders **offline to video**; dorayaki's director performs
   **live and interruptible** on the interactive map. Latency, interruption and
   mid-shot redirection are new problems; shot vocabulary and review discipline
   are reusable.
2. Its camera note matches the execution concern above: MapLibre's
   `center`/`zoom`/`pitch`/`bearing` are treated explicitly as an approximation
   of a real camera's independent position, framing and attitude.

### The interaction loop

1. The user states an intent (text, or a picked subject plus a primitive).
2. The director compiles a shot script and renders **storyboard stills** (a frame
   every couple of seconds) before playing anything.
3. The user corrects in language ("lower", "slower", "from the other side"); the
   script is revised, not the camera.
4. Play. Any manual input interrupts and returns control to the user; the
   director can be asked to resume or to re-frame from the current position.

### Open questions

- How are shots evaluated? "Good camerawork" needs the review discipline
  geo-video-factory started (framing, speed limits, label collisions) adapted to
  an interactive setting where the user, not a render, is the judge.
- How much scene index is enough for an LLM to ground subjects reliably, and how
  does the director behave when a subject cannot be resolved (ask, approximate,
  refuse)?
- Does the approximation (`center`/`zoom`/`pitch`/`bearing`) suffice for the six
  primitives, or does the player need `FreeCameraOptions` throughout?
- Accessibility: a directed camera is also an accessibility feature — 3D maps
  become usable by people who cannot perform multi-axis pointer control at all.
  Worth designing for, not bolting on.

### First steps (small, in house style)

1. A player only: hand-written shot JSON for the six primitives, per-frame camera
   driver, on the existing Sasebo demo. No language input yet.
2. Storyboard stills from a shot script (cheap: seek the player, capture frames).
3. The agent-facing interface (the same shot JSON in and out), with LLM
   compilation of free-text intent: the priority form, per the proposal above.
4. Later, if it earns its place: a `DirectorControl` shell with typed intent
   compiled by a small, inspectable rule set.

Each step is independently reviewable, and none of them changes the tile format,
the surfel layer, or MapLibre.

Step 1 is implemented as `demo/src/shot-player.ts` (2026-11-26), playing the worked example
`demo/shots/sasebo.json` with `?shots=sasebo` on the demo (five of the six primitives). What it assumes and where it differs
from the example: NOTES.md, 2026-11-26.

`track` is played since 2026-11-28, asked for by hfu/ax (which bundles shot-player.ts unchanged, to fly along a railway with
measured heights): `{"type": "track", "path": [[lng, lat, alt?], ...], "offset_m": 40, "alt_m": 30, "lead_m": 80,
"duration_s": 20, "easing": "linear"}`. The look-at point runs along `path` at an even arc-length rate, `lead_m` ahead of the
point the camera stands beside; the camera stands `offset_m` to the side (positive: right of the direction of travel, taken
from the path smoothed over 25 m either way) and `alt_m` above the path there. The look-at height is the path's `alt` when
every point has one, else the ground at the vertices. `PlayOptions.groundAt` lets a map without terrain own the look-at
height as with terrain (the map's clamping is switched off while playing). `sasebo.json` has one track (shot 5, 20 s): national
route 35 toward the town, 1.73 km and 66 points from GSI's optimized vector tiles (layer `RdCL`, 国道; chained at junctions by the
smallest turn), 60 m to the right, 80 m above, looking 120 m ahead; heights from the terrain. Seen playing on `?fixture=sasebo&shots=sasebo`
(2026-11-28): the look-at point follows the road and the camera faces the town; at 80 m it flies among the taller blocks.
