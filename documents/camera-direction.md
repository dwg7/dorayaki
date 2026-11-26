# Camera direction: language-driven camerawork for 3D surfel maps (idea note)

Status: an **idea note**, written 2026-11-26 at Fujimura's request. Nothing here is
implemented, and nothing here is a specification. It records a direction to explore,
in the spirit of the house rules: the naive thing first, optimization and wire
decisions only after a real problem shows itself.

## The problem

Dorayaki puts real 3D geometry on a map, and the moment the map is 3D the camera
becomes the hard part. A 2D map asks for three degrees of freedom (pan x, pan y,
zoom), which a drag and a wheel cover almost exactly. A 3D view adds pitch, bearing,
camera height and a look-at point that is no longer the map centre. A 2D pointing
device cannot express that, and the failure modes are familiar to anyone who has
flown the demo by hand: the subject leaves the frame, the camera clips into a
building, the user ends up looking at the underside of the terrain, or simply gets
lost and resets the view.

The claim of this note: **direct manipulation is the wrong abstraction for a 3D
map camera.** In film, the director does not carry the camera; the director states
intent and the camera operator executes. A 3D map should work the same way: the
human says what they want to see, the computer does the camerawork.

## The proposal

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

## The shot model

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

## Executing shots on MapLibre

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

## Scene awareness: the surfels are the set

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

## The real-world link: drones speak the same language

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

## Prior art in the group

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

## The interaction loop

1. The user states an intent (text, or a picked subject plus a primitive).
2. The director compiles a shot script and renders **storyboard stills** (a frame
   every couple of seconds) before playing anything.
3. The user corrects in language ("lower", "slower", "from the other side"); the
   script is revised, not the camera.
4. Play. Any manual input interrupts and returns control to the user; the
   director can be asked to resume or to re-frame from the current position.

## Open questions

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

## First steps (small, in house style)

1. A player only: hand-written shot JSON for the six primitives, per-frame camera
   driver, on the existing Sasebo demo. No language input yet.
2. Storyboard stills from a shot script (cheap: seek the player, capture frames).
3. The agent-facing interface (the same shot JSON in and out), with LLM
   compilation of free-text intent: the priority form, per the proposal above.
4. Later, if it earns its place: a `DirectorControl` shell with typed intent
   compiled by a small, inspectable rule set.

Each step is independently reviewable, and none of them changes the tile format,
the surfel layer, or MapLibre.
