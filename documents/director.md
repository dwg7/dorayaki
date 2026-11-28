# Director: from human intent to camerawork (design memo)

Status: a design memo of 2026-11-28, **proposed, not implemented** except where marked. It merges four answers to one prompt
("how should human intent be translated into Dorayaki's camerawork, and how can tile loading keep up with it"): Gemini, Muse
(the "mochi" agent), ChatGPT and this session; hfu collected them. It extends the camera-direction note in [demo.md](demo.md)
(the shot model and the six primitives, implemented in `demo/src/shot-player.ts`). The measurements it relies on are E028.

## What all four agreed on

1. **The language model designs the camerawork; deterministic code makes it real.** The model turns words into structure
   (purpose, subjects, relations, pace). Coordinates, distances, safety and tile budgets are computed and checked by code. The model
   never makes the final safety call.
2. **Layers between words and shots**: purpose, subject, composition, motion, timing. The shot JSON the player reads is a compiled
   output, not what people edit.
3. **Composition in screen terms, metres from the data**: "the shipyard fills half the frame, seen from the sea at 20 degrees" is
   solved into a distance and a height from the subject's footprint and its splat statistics (the splats are what is drawn, so they
   are the final word on extent and height). The same words then work at every zoom and place, as the pruning of D24 does for data.
4. **Validation before playing, reported as compiler diagnostics** with machine-applicable fixes, generalizing what ax already does
   (every frame sampled at 0.1 s, clearance and data edge checked).
5. **A tour's route is known before it plays**, so which tile is needed when can be computed in advance: loading is a deadline
   problem.
6. **Measure first** (a baseline); bring in the language model last.

## Where they differed, and the choice

| Question | Views | Choice |
| --- | --- | --- |
| One document or one per layer | Muse: one document with the layers as fields; ChatGPT: separate layers, the plan kept apart from the shot JSON | **One director plan** (beats, each with purpose, subject, framing, motion, timing fields) **plus the compiled shot JSON**. People and agents edit the plan only; every diagnostic names the layer it belongs to |
| First remedy when tiles are late | Gemini: slow the camera; Muse and ChatGPT: prefetch along the known route | **Route-aware prefetch with a wait before playing and before cuts** first (costs no shot), then adapting the look-ahead, then slowing down, then coarser tiles while moving, then reordering |
| A horizon line in the composition | Gemini and Muse use one; ChatGPT: a map often has no horizon | Optional, only where a real boundary (a coastline, a ridge) exists |
| "From the sea side" | | Not bearing + 180: candidate viewpoints from the coastline and water areas, each checked for visibility and clearance |

## Ideas kept from each answer

- Never substitute another subject silently; ambiguous references come back as a list of candidates, missing ones with the nearest
  resolvable alternative as a suggestion (Muse, ChatGPT).
- After each recompile, show what changed in real values ("range 800 m to 620 m, tour 58 s to 63 s") (Muse).
- Metrics only catch failures; whether camerawork is good stays the human's call (Muse). Initial comfort limits to calibrate: bearing
  change at most 15 degrees per second, ground flow (speed over height) at most 0.5 per second (Muse).
- One tool: a **tour linter** (command line) that reads a plan or a shot JSON and prints diagnostics, a compile report and the frames
  for a storyboard (Muse). Storyboard stills come from the real renderer, at shot start, middle and end plus the riskiest moments
  (lowest, fastest, nearest the data edge) (ChatGPT).
- Hard and soft constraints apart; unknown ground is not safe ground (ChatGPT).
- The view budget (40 MB, 4 million splats) is not the network's rate; and a late tile because the request started late differs
  from a late tile because the link is too slow (ChatGPT).
- Two coverage measures: `C_any` (something is drawn there) and `C_target` (the wanted zoom is drawn there) (ChatGPT); waste: bytes
  prefetched and never shown (Muse).
- A scene index that keeps relations, not only features (the shipyard is next to the harbour, the station is served by the railway),
  built offline: MapLibre's `querySourceFeatures` sees only loaded tiles (ChatGPT).
- Limit how many times and on which fields an agent may revise a plan, so its repair loop ends (Gemini).
- This session: cuts are the riskiest moments (the whole view becomes new tiles at once), so a cut gets its own wait; exact tile
  sizes are known at build time and should replace guesses in every estimate.

## The plan (small steps; each is measured before the next)

Loading (first, because D22 puts smoothness first):

1. **E028 baseline**: instrument the demo (`?measure=1`, coverage every 250 ms, every fetch logged; `?cold=1` for a first visit) and
   write the tour linter's tile-demand part (`npm run measure:tour-demand`). Done on 2026-11-28; see EXPERIMENTS.md.
2. **E029 route-aware prefetch**: request every tile of the tour in deadline order, wait before playing until the measured rate can
   deliver the rest in time, and keep the tour's tiles while it plays. Done on 2026-11-28 (cold `C_target` 0.49 to 0.998 for a 13.6 s
   wait; EXPERIMENTS.md). Waits before cuts were not needed for this tour.
3. Then, if needed: adapt the look-ahead to the measured rate, slow down where the linter says the link cannot keep up, and draw
   coarser tiles while moving.

Translation:

1. **Director plan v0**: the plan's shape, a compiler for `hold` and `dolly` from screen-space framing, and the linter's checks
   (clearance, data edge, tile demand). First case: "show Sasebo harbour from the sea", with the harbour's footprint given by hand.
2. **Scene index v0**: three to five subjects (harbour, shipyard, station, national route 35) from GSI's optimized vector tiles
   (annotations, buildings, road centre lines, coastline) joined with splat statistics, built offline.
3. **Revisions in words** ("lower", "slower", "from the other side") as changes to plan fields, recompiled and re-checked.
4. **The language model last**, for words into a plan only.

## Sources

The four answers (2026-11-28, pasted into the session by hfu; not stored in the repository). References they gave that this memo
leans on: He, Cohen and Salesin, *The Virtual Cinematographer* (SIGGRAPH 1996); Lino and Christie, *Intuitive and Efficient Camera
Control with the Toric Space* (SIGGRAPH 2015); Joubert et al., *An Interactive Tool for Designing Quadrotor Camera Shots* (SIGGRAPH Asia
2015); Huang et al., *A Buffer-based Approach to Rate Adaptation* (SIGCOMM 2014); QSplat and Streaming QSplat ([lineage.md](lineage.md));
`yuiseki/geo-video-factory` and its camera review rules. Not checked by this session beyond QSplat.

## Flight planning (2026-11-28, proposed; first measurements in E031)

A further brief (another agent's, collected by hfu) asked what planning real flights (DJI Fly waypoints, Dronelink, Litchi's curve size
and point of interest, UgCS terrain following and corridors) can teach the Director. The principles kept, as proposals:

- **Route, camera trajectory and look-at are three things**: the road followed, the path the camera flies (offset, raised, its corners
  rounded) and the point it looks at, which need not lie ahead. Terms: the *bearing* is MapLibre's (the direction the camera looks); the
  direction of travel is the route's; they differ when the camera looks at a point of interest.
- **Speed is planned, not written**: a cruise speed on straights, slower where the path turns (sideways acceleration and heading rate
  limited), speed changes limited; durations come out of the plan. Limits are experimental parameters judged by eye, not aircraft data.
- **Preview before flying**: the flight log (`npm run measure:flight`) joins the tile linter (E028) as pre-play checks.
- Rejected: aerodynamics, batteries, wind, gimbal hardware limits, regulation; a general drone simulator.

What E031 showed: the planned speed and rounded corners cut the track's turn rate from 50 to 7 degrees per second, and the slower track
gives the tiles time; a point of interest without a framing rule tilted the camera almost level (a 12 m camera, half the view without
its tiles), so a point of interest needs framing limits (pitch, distance) before it is useful.

