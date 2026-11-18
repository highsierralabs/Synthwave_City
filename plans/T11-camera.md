---
id: T11-camera
title: Camera: tour, free flight, viewpoints, input
status: done
depends_on: [T00, T01]
owns: [src/camera/**, tests/unit/camera/**, plans/T11-camera.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**]
updated: 2026-11-17
---

# T11: camera

## 1. Purpose

Decide where the viewer looks. By default a cinematic drone tour glides through the city on its own:
down avenues between towers, banking through intersections, climbing past megatowers, skimming the
street. At any moment the viewer can take over and fly freely, sliding along walls rather than
passing through them, jump to one of six viewpoints, or hand control back to the tour.

## 2. Context and orientation

`architecture.md` §4.1, §4.4, §7. The camera never touches three objects. It implements `CameraDriver`
from `src/contracts/camera.ts`: each frame the engine calls `update(frame, pose)` and the driver
writes a `CameraPose` (position in tile coordinates, yaw, pitch, roll, field of view). The engine
wraps the position and builds matrices. Positions may leave `0..TILE`; only differences matter, and
the driver should itself wrap its stored position occasionally so numbers stay small.

The air above every road is free of buildings at every height (§4.4), so a path that stays inside
road corridors cannot hit anything. Buildings are queried through `plan.collide(pos, radius)` and
`plan.heightAt(x, z)`.

Tour, flight physics, viewpoints and input mapping are pure logic with unit tests. Only one small
file attaches DOM listeners.

Files, as built:

| File | What it holds |
|---|---|
| `src/camera/index.ts` | The public surface: `createCameraRig` and the types round it |
| `src/camera/rig.ts` | The rig: five phases (tour, free, join, blend, ease) and the moves between them |
| `src/camera/tour.ts` | The tour: route generator and the smoothed pose as a function of time |
| `src/camera/flight.ts` | Free-flight physics, collision sliding, the springs the return uses |
| `src/camera/input.ts` | `InputMapper`: events in, plain `InputState` out. No DOM |
| `src/camera/dom.ts` | The only DOM code: listeners, pointer lock, gamepad polling |
| `src/camera/viewpoints.ts` | The six viewpoints from `plan.landmarks` |
| `src/camera/tile.ts` | `wrapTile`, a wrap into `[0, TILE)` that cannot return `TILE` (see section 9) |

## 3. Scope

Owns `src/camera/**`. Non-goals: menus and on-screen hints (T12), the harness's own simple camera
(T00), camera shake or other post effects.

## 4. Interfaces

Consumes `CityPlan` (`src/contracts/city.ts`: `landmarks`, `cells`, `heightAt`, `collide`),
`CameraPose` and `CameraDriver` (`src/contracts/camera.ts`), `FrameState` (`src/contracts/layer.ts`),
the grid constants (`src/contracts/constants.ts`) and `src/core`. It imports nothing else: no three,
no `src/city`.

Provides, from `src/camera/index.ts`:

- `createCameraRig(plan, options?)` returning a `CameraRig`, which is a `CameraDriver` with:
  `mode` (`'tour' | 'free'`), `setMode(mode)`, `goToViewpoint(index)` (index from 0),
  `viewpoints` (`readonly { name, pose }[]`, six of them), `attachInput(element)` returning its detach
  function, `setReducedMotion(on)`, and `speed` (metres per second).
- `options`: `seed` (default `plan.seed`), `mode` (default `'tour'`; in `'free'` the rig starts from
  the pose the engine already has), `reducedMotion`, and `onAction(action: string)`.
- `onAction` receives `'menu'` (Esc), `'mute'` (M), `'stats'` (H), `'mood'` (T), `'photo'` (P),
  `'mode'` after every change of `mode`, and `'viewpoint:<index>'` after a viewpoint is chosen.
  `Space` and the digits `1` to `6` are handled by the rig and are not passed on.
- Additions beyond what T12 was told to expect, all read-only or optional: `reducedMotion`,
  `resumeSuggested` (true once free flight has had no input for 30 s; the app decides what to do),
  `input` (the `InputMapper`, so on-screen controls can feed it), and `handleKey(action)` (what
  `attachInput` calls for a key action).

The exact declarations are in `src/camera/rig.ts` (`CameraRig`, `CameraRigOptions`); they are not
copied here.

## 5. Plan of work

**M1. Free flight.** State: position, velocity, yaw, pitch. Acceleration from input axes in the
camera's frame, exponential damping, boost multiplier, speed scaling gently with altitude. Collision:
after integrating, call `plan.collide` with a small radius and remove the velocity component into the
wall; clamp altitude between about 1.5 m and 1,500 m. Frame-rate independent (test at 30, 60 and
144 Hz step sizes: same path within tolerance). Proof: unit tests, including "fly at a wall and slide".

**M2. Input.** Keyboard (`W A S D`, arrows, `Q`/`E`, `Shift`), pointer-lock mouse look with sensible
sensitivity and pitch clamp, touch (one finger drag looks and flies forward while held, a second
finger boosts), and gamepad if it is cheap. Input produces a plain `InputState` object; the mapping
from events to that state is unit-tested with synthetic events. Keys used by the app (`Space`,
digits, `M`, `H`, `T`, `Esc`) are reported as actions, not handled here beyond `Space` and digits.

**M3. Viewpoints.** Six poses computed from `plan.landmarks`: street level on an avenue looking at
the sun; mid-height in the densest downtown canyon; a rooftop edge looking across the skyline; high
panorama; beside the tallest megatower; over a plaza. Moving to one is a smooth one-second ease.
Proof: unit test that every viewpoint lies outside all boxes (use `collide`).

**M4. The tour.** A path generator over the road grid: a sequence of legs, each along one avenue or
street line, with a target altitude and speed; at an intersection it may turn onto the crossing road
with a rounded, banked corner. Altitude follows a smooth curve between street level (about 6 m) and
well above the roofs, with holds: a low run, a climb beside a megatower (the tour may orbit one by
going round its block), a high cruise. The look direction leads the velocity slightly and drifts
towards nearby landmarks. Everything derives from a seed and the tour's own elapsed time, so it is
reproducible; it stays inside road corridors with a margin and is verified against `collide` by
sampling a long run in a unit test (no collision in 30 simulated minutes). Speed about 25 to 60 m/s;
roll limited; with reduced motion, slower and without roll.

**M5. Handover.** Any movement or look input during the tour switches to free flight from the current
pose with the current velocity; `Space` (or `setMode('tour')`) eases from the current pose back onto
the tour path by joining the nearest road corridor first. After about 30 s without input in free
flight, the rig offers to resume (reports a flag; the app decides).

Revision note, 2026-11-14: executed as written, with the choices recorded in section 10. The one
departure in the numbers: the tour slows below 25 m/s inside corners (19 m/s on the straights each
side of a street corner, about 13.5 m/s at its apex), because a smoothed corner that keeps 3.5 m
from the building line of a 24 m street cannot be taken faster. See the Decision log.

**M6. Free look on the tour (operator request, 2026-11-17).** This replaces part of M5: a drag or
pinch no longer takes over from the tour. While the mode is `'tour'` (the tour, the return to it and
the blend):

- One finger dragging, or the left mouse button dragging, turns the view away from the tour's own
  direction (same sense as free flight: drag right to look right). The tour keeps flying. The offset
  holds for `LOOK_HOLD` (5 s) after the last drag, then a critically damped spring eases it back to
  zero, so a corner never leaves the viewer staring at a wall. Pitch is kept inside the free-flight
  limit.
- Two fingers pinching, the mouse wheel, or a trackpad pinch (which browsers send as a wheel event
  with `ctrlKey`) zoom the lens: field of view between `MIN_TOUR_FOV` and `MAX_TOUR_FOV`, scaled in
  `tan(fov / 2)` so the picture follows the fingers. The zoom stays for the rest of the tour and
  eases back to `CAMERA_FOV` once the tour is left.
- A double tap, or a double click, leaves the tour for free flight from the panned view (a mouse
  also gets pointer lock). Two taps count as a double tap when each is short and still, and the
  second starts soon after and near the first. Nothing in free flight changes: double taps there do
  nothing new, and Back to tour and `Space` remain the way back.
- Keys and the gamepad still take over at once, as before. A mouse click on the tour no longer asks
  for pointer lock.

Work: `input.ts` gets a `tourLook` switch that the rig keeps equal to `mode === 'tour'`, separate
pan and zoom accumulators (so the rig's `input.active` take-over test does not see them), per-touch
positions for the pinch, tap timing, and `wheel()`. `dom.ts` forwards `wheel`, skips pointer lock on
the tour, and reports a double tap as the new key action `'takeover'`. `rig.ts` applies the offset
and lens, carries the panned view into free flight, and eases the lens back. The app's hints and
help text (T12's paths) describe the new controls, and architecture.md section 7 is amended to
match; both under the operator's instruction.

Proof: unit tests for the mapper (pan, pinch, wheel, taps that are and are not double taps), the DOM
binding (no lock on the tour, wheel cancelled on the tour only, double click takes over and locks)
and the rig (pan does not take over, drifts back, the zoom stays and resets, double tap leaves with
the view kept); and a live check in Chromium with dispatched pointer and wheel events.

## 6. Validation and acceptance

- `npm run check:task -- T11` exits 0, including the 30-minute tour collision test and the
  frame-rate independence test.
- In the harness with the rig mounted (`/dev/?layers=...&rig=1`, a flag T00's harness passes through
  to this module when it exists): a sequence of 8 frames 1.5 s apart along the tour, viewed, showing
  a smooth path with banking and no clipping through geometry.
- Pose values never contain `NaN` after 10 minutes of random input (fuzz test).

- M6: the camera tests above pass with the new cases; in the shipped page (`?autostart=1`), a
  dispatched drag turns the view and leaves `Tour` showing, a dispatched pinch and wheel change the
  field of view, and a dispatched double tap switches to `Free flight` without a jump in view.

Human checks: H-T11-1, the tour is pleasant to watch and never nauseating; H-T11-2, flight feels
responsive with a real mouse; H-T11-3, touch control on a real phone.

Evidence for each is in section 12.

## 7. Idempotence and recovery

Stateless apart from the rig's own state. `attachInput` returns its own cleanup, and calling it again
detaches the previous binding first. Tests are pure and safe to re-run. Screenshots go to `shots/T11/`
(git-ignored) and may be deleted at any time.

## 8. Progress

- [x] 2026-11-14 M4 tour, done first as the riskiest part: `tour.ts`, 30 simulated minutes with no
  `collide` hit on first run; then tuned from screenshots (see sections 9 and 10).
- [x] 2026-11-14 M1 free flight: `flight.ts`, exact exponential integration, sub-stepped collision.
- [x] 2026-11-14 M2 input: `input.ts` (pure) and `dom.ts` (listeners, pointer lock, gamepad).
- [x] 2026-11-14 M3 viewpoints: `viewpoints.ts`, six poses, the rooftop found with `heightAt`.
- [x] 2026-11-14 M5 handover: `rig.ts`, take-over with velocity kept, two-part return to the tour.
- [x] 2026-11-14 Tests: 93 in `tests/unit/camera`, 13 mutations each shown to fail a test.
- [x] 2026-11-14 Looked: 8-frame sequence, megatower orbit, high cruise, dive, street level, all six
  viewpoints, and two frames with every layer mounted.
- [x] 2026-11-14 Live check in real Chromium with real key and mouse events and synthetic touch.
- [x] 2026-11-14 `npm run check:task -- T11` PASS; `npm run plans:check` OK.

- [x] 2026-11-15 Small fix for the radio (T10 M6, T12 M10): `KeyR` maps to a new action
  `'station'` in `src/camera/input.ts`, which the rig passes to the app like `mood`. One assertion
  added to `tests/unit/camera/input.test.ts`; `npm run check:task -- T11` PASS, camera tests pass.

- [x] 2026-11-17 M6 retune after the operator's tailnet test: `LOOK_HOLD` 2 to 5 s, return spring
  omega 2.4 to 1.6 (33% slower). The drift-back test now also checks the return is unhurried (a
  second in, more than 45% of the look remains); at omega 2.4 it failed (0.139 rad left, needs
  0.202), at 1.6 it passes. `npm run check:task -- T11` PASS, 113 tests.
- [x] 2026-11-17 M6 free look on the tour: plan revised first, then `input.ts` (tour-look switch,
  pan and zoom accumulators, per-touch positions, pinch, wheel, tap timing), `dom.ts` (wheel, no
  lock on the tour, double click locks, `pointercancel` is never a tap), `rig.ts` (offset, hold,
  spring return, lens, the view carried into free flight), `index.ts` exports. Tests: 93 to 113 in
  `tests/unit/camera`; six mutations each failed a test. Live check in Chromium on the GPU. The
  app hints, the help panel and the README (T12 paths) and architecture.md section 7 were changed
  under the operator's instruction; see T12 Progress.

The three human checks remain for the operator, and M6 adds H-T11-4: free look, pinch and double
tap on the operator's phone and tablet.

## 9. Surprises and discoveries

- **A triangle kernel makes the whole path.** Convolving the raw route (straight segments, constant
  speed each) with a triangle kernel in time gives rounded corners, eased speed changes and a
  continuous acceleration in one step, and each piece of the integral is a quadratic, so Simpson's
  rule evaluates it exactly. No turn geometry is stored. A corner then cuts inside the two centre
  lines by `speed * SMOOTH / 6`, which turns "stay in the corridor" into a speed limit per corner
  (`cornerLimit`): 19.0 m/s street to street, 24.6 mixed, 31.3 avenue to avenue with `SMOOTH = 2.6 s`.
  Evidence: `tests/unit/camera/tour.test.ts`, "a street corner cuts in by speed * SMOOTH / 6".
- **Looks towards a landmark can add to a turn.** A look offset that fades out as the target passes
  behind has a falling slope, and through a corner that slope added to the turn rate: 74 deg/s peak
  yaw rate in the first version. Averaging the view direction over 1.5 s each side (five taps,
  position untouched) brought the peak to 38 to 46 deg/s over five city and seed pairs.
- **The pose was not bit-identical for the same time.** Stored coordinates are moved by whole tiles
  now and then, and whether that had happened before a given evaluation depended on what had been
  asked earlier, which changed the last bits (1141.255604170523 against 1141.2556041705238). The
  evaluator now works relative to the start of the current segment, so the tile shift cancels
  exactly. Evidence: the test "gives the same pose for the same time, whatever was asked before"
  failed, and passes now; mutation J re-breaks it.
- **`wrap()` in `src/core/math.ts` can return the period itself.** `wrap(-1e-13, 6400) === 6400`,
  because the negative remainder plus the period rounds up [O, run in this session]. The 30-minute
  test caught a pose with `x === TILE`. Worked round locally in `src/camera/tile.ts`; reported to the
  T00 owner (section 12). It is harmless to the shaders, which wrap relative to the camera.
- **Hugging a megatower's own block shows a wall, not a tower.** Seen in `shots/T11/orbit_*.png` of
  the first version: 16 to 24 m from a 120 m wide face, the frame was all windows. The orbit now
  usually goes round the nine blocks centred on the tower, 240 m out, where the whole tower reads as
  an object with the city behind it. The tight orbit is kept as a one-in-three variant.
- **The shared dev server reloads the page under the screenshot tool.** While siblings were editing,
  `shot.mjs` failed four times: once with "Execution context was destroyed, most likely because of a
  navigation" and three times with `window.__sc` undefined part-way through. A retry passed each
  time. Not a defect in anything; a note for whoever sees it next.
- **Vitest 5 hides `console.log` of passing tests** unless run with `--silent=false` [O].

## 10. Decision log

All dated 2026-11-14.

- **The tour is a pure function of time, generated on demand.** Segments are generated into a fixed
  buffer as time advances; asking for an earlier time regenerates from the start (about 1,500 legs
  for the far end of the loop, well under a millisecond). Reason: the harness freezes time for
  screenshots, so the pose must follow `frame.time` with `dt = 0`, and a closed precomputed loop
  would have needed path closure on a torus for no visible gain.
- **When the tour takes its time from `frame.time`.** Only on a frame with `dt === 0` whose
  `frame.time` differs from the previous frame's: the clock was set by hand. A zero step with an
  unchanged clock (a resync after a hidden tab, a paused app) leaves the camera where it is. Reason:
  taking `frame.time` on every zero step would teleport the camera after any resync once tour time
  and the clock had drifted apart (reduced motion, or any time spent in free flight).
- **Corner margins: 3.5 m on streets, 6 m on avenues.** 3.5 m is the least that keeps the 1.8 m
  sphere and the near plane clear with room to spare; on an avenue the first screenshots showed the
  inside corner filling the edge of the frame at 3.5 m, so avenues keep more. Cost: avenue corners
  are taken at 31 m/s instead of 37.
- **Speed in corners is below the plan's 25 m/s.** With a 12 m street corridor, a 3.5 m margin and a
  2.6 s kernel, 19 m/s is the limit; a shorter kernel would allow more speed but turn the view faster
  (peak yaw rate is `2 / SMOOTH`). A slower, gentler corner was preferred to a nauseating one. The
  plan said "about 25 to 60 m/s"; straights run 27 to 61.
- **Bank limit 0.24 rad (13.8 degrees), reached only in theory;** measured peak is 10.3 degrees.
- **Free flight is integrated in steps of at most 1/120 s,** with top speed taken at mid-step
  altitude. Reason: 30 Hz and 60 Hz then take identical physics steps, and a 100 ms frame lands where
  six 60 Hz frames do (tested to 1e-6 m).
- **Collision radius 1.8 m,** which is also the lowest eye height. Reason: the near plane's corner is
  1.58 m from the eye at 16:9 and 62 degrees, so a smaller sphere would let walls clip.
- **Arrow keys: up and down fly, left and right turn.** The plan listed the arrows without a mapping.
  Turning makes the keyboard alone enough to steer, which matters when pointer lock is unavailable.
- **Touch looks like a mouse:** drag right to look right. The other convention (drag the scene) was
  considered; with "hold to fly" a finger acts as a stick, and stick convention matches. H-T11-3.
- **Returning to the tour starts a new tour where the camera is.** The old tour may be kilometres
  away, so the rig picks the nearest of the four roads round the camera's cell that a sphere can
  reach in a straight line, starts a new tour there in the direction the camera is already moving,
  flies to it with the flight physics and collision on, then cross-fades onto the moving tour over
  2.5 s. If no road can be reached in a straight line it first climbs above the cell's roofs.
- **A glide to a viewpoint may pass through buildings.** The plan asks for a one-second ease, and a
  viewpoint can be kilometres away. Under reduced motion it is a cut instead.
- **Keys aimed at a focused control are left alone,** except Escape, which is always reported as
  `'menu'` and never cancelled. Reason: Space must still press a focused menu button.
- **Losing pointer lock is reported as `'menu'`.** Browsers keep the Escape press that leaves pointer
  lock to themselves, so without this the first Escape would do nothing. Two reports within 350 ms
  count as one press. Returning to the tour gives the lock back without reporting it.
- **`resumeSuggested` is a property, not an action.** The plan says "reports a flag; the app decides",
  and T12 was told the exact list of action strings; an extra one could surprise its handler.
- **`handleKey`, `input`, `reducedMotion` and `resumeSuggested` were added to the rig.** Additive;
  they let T12 build on-screen controls and let the tests drive the rig without a DOM.

- **`R` is the station key (2026-11-15).** Free, next to `T` for mood, and not used for flight. The
  action list T12 handles grows by one; T12 changed its handler in the same revision.

- **Free look on the tour (M6), all 2026-11-17, operator request.** The operator chose: the view
  drifts back after a drag, a pinch zooms the lens and the zoom stays for the tour, the mouse gets
  drag and wheel too, and a double tap only leaves the tour (it does nothing new in free flight).
  The rest is recorded here:
  - **A drag on the tour turns the view the same way as in free flight** (drag right to look
    right), so the sense does not flip when the viewer double taps. Many touch viewers use the
    other sense (drag the scene). Flipping it is one sign in `pointerMove`, if the phone check
    (H-T11-4) asks for it.
  - **A double tap is its own action, `'takeover'`, not `'toggle'`.** It can only leave the tour,
    so a stale or repeated report can never send the camera back.
  - **Tap thresholds:** a tap is at most 300 ms and 12 px; the second goes down within 350 ms of
    the first lifting and within 40 px of it. A second finger, a cancel or a change of pointer
    kind breaks the pair. Usual platform values, from memory [M]; not measured on a phone.
  - **Zoom works on `tan(fov / 2)`,** so the picture scales with the spread of the fingers. The lens
    runs from 25 to 85 degrees. The wheel gives a factor of e every 667 px, and a trackpad pinch
    (a wheel event with `ctrlKey`) every 100 px. One wheel event can move it by at most e. The
    wheel is cancelled only on the tour, so browser page zoom is untouched in free flight.
  - **The look holds 5 s (`LOOK_HOLD`), then a critically damped spring (omega 1.6) brings it back**
    from rest, in about 3 s. First built with 2 s and omega 2.4. After trying it over the tailnet,
    the operator asked for a 5 s hold and a return 33% slower (2026-11-17): omega 2.4 x 0.67 = 1.6,
    which stretches the whole return in time by 1.5x. The operator said drag and pan "feel right". Pitch offset is clamped against the tour pitch so the sum stays inside
    `MAX_PITCH`, and a drag back responds at once.
  - **Leaving the tour keeps the view the viewer chose.** `takeOver` copies the panned pose. During
    the join, where the rig flies `free` itself and the look is only added on output, the offset is
    folded into `free`. A viewpoint glide starts from the panned view.
  - **On the tour a mouse click asks for no pointer lock;** a double click asks for it from the
    `pointerup` that completes it. That relies on the browser's transient user activation from the
    press [I]; headless Chromium granted it [O]. Keys and the gamepad still take over at once.

## 11. Contract change requests

None. `src/contracts/camera.ts` was sufficient as frozen.

## 12. Outcomes and retrospective

**Result against Purpose.** The rig starts on a tour that opens down the avenue beside downtown
towards the sun, turns with a bank, routes to megatowers and circles them while climbing, cruises
above the roofs, dives, and runs at street level. Any movement or look input takes over without a
jump; `Space` returns; `1` to `6` glide to six viewpoints. All of that is in `src/camera`, which
imports only `src/contracts` and `src/core`.

**Acceptance evidence, all from runs made in this session.**

`npm run check:task -- T11`:

```
typecheck tsconfig.json: 0 error(s) in T11-camera, 0 elsewhere
typecheck tsconfig.node.json: 0 error(s) in T11-camera, 0 elsewhere
lint: ok (src/camera, tests/unit/camera)
tests: ok (tests/unit/camera)
   Test Files  6 passed (6)
        Tests  93 passed (93)
PASS T11-camera
```

The tour, 30 simulated minutes at 60 Hz, measured by a throwaway script on the final code:

```
corner limits m/s 19.0 / 24.6 / 31.3   (street-street / mixed / avenue-avenue)
city 1984 seed 1984: 108001 poses, 6.8 us each; hits 0; margin 3.76 m; alt 6.3..671 m; speed 13.5..58.5 m/s; roll 10.3 deg; yaw max 41.0 deg/s, 0.0 s over 45; alt bands 25% / 39% / 19% / 17%
city 7 seed 7:       108001 poses, 6.1 us each; hits 0; margin 3.76 m; alt 6.6..793 m; speed 13.5..61.2 m/s; roll 10.3 deg; yaw max 45.6 deg/s, 0.4 s over 45; alt bands 24% / 35% / 15% / 25%
city 42 seed 42:     108001 poses, 6.2 us each; hits 0; margin 3.77 m; alt 6.0..716 m; speed 13.5..59.4 m/s; roll 10.3 deg; yaw max 41.3 deg/s, 0.0 s over 45; alt bands 27% / 27% / 18% / 28%
city 1984 seed 99:   108001 poses, 6.2 us each; hits 0; margin 3.76 m; alt 7.0..760 m; speed 13.6..61.6 m/s; roll 10.3 deg; yaw max 41.4 deg/s, 0.0 s over 45; alt bands 31% / 37% / 16% / 17%
city 3 seed 5:       108001 poses, 6.6 us each; hits 0; margin 3.76 m; alt 6.1..745 m; speed 13.5..61.9 m/s; roll 10.3 deg; yaw max 37.7 deg/s, 0.0 s over 45; alt bands 19% / 32% / 18% / 31%
```

`hits` is `plan.collide` with a 2 m sphere; `margin` is the least distance to a building line; the
altitude bands are below 30 m, 30 to 250, 250 to 480 and above 480 m.

What the unit tests hold the code to (`tests/unit/camera`):

- Tour: no `collide` hit and at least 3.4 m to the building line for 30 minutes on two cities and
  three seeds and from four arbitrary starts; finite, wrapped poses; yaw rate under 50 deg/s; velocity
  continuous (under 0.4 m/s change per 60 Hz frame) and equal to the derivative of position; the
  same pose for the same time to the last bit, whatever was asked before; still valid after six hours.
- Flight: 30 and 60 Hz within 1 cm after 6 s and over a kilometre, 144 Hz within 0.1%; a 100 ms
  frame equal to six short ones; flying at a megatower's wall stops a radius short, loses the speed
  into the wall and keeps the speed along it; no tunnelling at 900 m/s with a 100 ms frame; floor and
  ceiling; wrap without a jump.
- Input: keys, arrows, modifiers, auto-repeat, mouse with and without lock, one and two fingers,
  finger hand-off, gamepad dead zone.
- Viewpoints: six, outside every box on four cities, five over a road and one on a roof within
  2.4 m of its surface, each where the plan says.
- Rig: frozen clock gives a pose that depends on `frame.time` alone; a zero step with an unchanged
  clock does not move; take-over keeps position, yaw and velocity; the return never enters a box from
  40 random free-flight end states, from each viewpoint, and from a walled courtyard (it climbs out);
  ten minutes of random input, mode switches and frame times from 0 to 100 ms never give a `NaN`, a
  position out of bounds or a position inside a box.
- `dom.ts`, against hand-made stand-ins built on Node's `EventTarget`: wiring, focused controls,
  pointer lock, the Escape de-duplication, touch capture, detach.

Each gate was shown able to fail: 13 mutations of the source (corner limit times 1.5, collision
radius 0, clock scrub ignored, velocity dropped at take-over, no physics sub-step, no view smoothing,
obstacle check inverted, no rewind, absolute-coordinate evaluation, orbit corner off the grid, look
ignored, blend cut short, a viewpoint moved into a building) each failed at least one test, and the
source was restored byte for byte afterwards.

**What I looked at** (`shots/T11/`, 960 x 540, layers `sky,ground,buildings`, NVIDIA RTX 4070 SUPER
through ANGLE D3D11, no console errors or page errors in any run that completed):

- `seq_0.png` to `seq_7.png`, from
  `node scripts/shot.mjs --url "/dev/?layers=sky,ground,buildings&rig=1" --out shots/T11/seq.png --frames 8 --dt 1.5 --t0 28.5`:
  frames 0 to 2 fly straight down the avenue at the sun between towers; 2 begins to bank right; 3 is
  mid-turn, banked about 10 degrees, the inside corner's building at the right edge of the frame and
  not cut by the near plane; 4 to 7 come out level onto the crossing avenue and tilt up towards a
  megatower. No frame shows the inside of a building.
- `orbit_a.png` to `orbit_d.png` (t = 99, 114, 129, 144): the wide orbit of the tallest megatower,
  the tower on the left third of the frame rising out of the top, the city and two other megatowers
  beyond, climbing from about 250 m to 480 m.
- `high.png` (t = 186, 671 m): above the roofs looking slightly down across the city (the view from
  above). `dive.png` (t = 252): descending along an avenue, the whole grid ahead.
- `skim.png`, `skim_look.png` (t = 321, 342, 9 m): street level over the median, shop fronts and
  lamps passing; the second looks aside at a megatower (the near view).
- `vp1_sunset_avenue.png` to `vp6_plaza.png`: the six viewpoints, taken at their poses with the
  harness camera. Each shows what its name says; the rooftop has the roof's edge at the bottom left.
- `all_33.png`, `all_129.png`: the same tour with all seven layers mounted. Not looked at closely
  for the other layers' sake; `all_129.png` shows beams and tickers round the orbit with no error.

**Live check in real Chromium** (a throwaway Playwright script outside the repository, against the
shared dev server): the tour runs at 144 fps with 0.22 to 0.38 ms of engine CPU per frame; real `W`
takes over and flies, and released it coasts to a stop; `ArrowLeft` turns; `3` lands exactly on the
rooftop viewpoint; a click takes pointer lock and mouse movement looks; `Space` returns to the tour
and gives the lock back; synthetic touch pointer events fly, steer and boost. With the script in its
final form, all 13 checks passed in three of four runs, the last of them on the final code. In the
other run, "coasts to a stop" read 38 m/s, the tour's opening speed, which fits the dev server
having reloaded the page mid-run (it did that to the screenshot tool four times); that cause is
inferred, not confirmed, because that run did not yet count page loads. An earlier form of the
script failed "second finger boosts" because it flew the camera into buildings first; that was the
script, and the check was moved to the panorama viewpoint.

**Not verified.**

- H-T11-1: I have seen stills, not motion. Smoothness rests on the measured bounds above, not on
  watching it. Whether 40 deg/s corners and a 10 degree bank are pleasant is for a person to judge.
- H-T11-2: feel with a real mouse (sensitivity 0.0022 rad per pixel is a guess from common practice).
- H-T11-3: touch on a real phone. Only synthetic pointer events were sent; no real touchscreen.
- A real gamepad. The mapping and the polling were tested with numbers and a fake pad only.
- The Escape path out of pointer lock in a real browser. Taking and giving back the lock were seen in
  Chromium; the browser swallowing Escape was only modelled.
- Firefox and Safari. Chromium only.
- "No allocation in `update`" is by reading the code, not by measurement. Known exceptions, none per
  frame: a rewind of the tour (a backwards scrub) makes one generator object; returning to the tour
  makes one; `navigator.getGamepads()` allocates inside the browser while a pad is connected.

**Defects and notes in other tasks' paths** (not edited; reported to the T00 owner):

- `src/core/math.ts`, `wrap()`: documented as `[0, period)`, returns `period` for tiny negative
  input (`wrap(-1e-13, 6400) === 6400`). The engine wraps the pose with it, so `uCam.x` can be
  exactly `TILE`. Probably harmless; a one-line guard would make the contract true.
- `eslint.config.js`: the block for `src/audio` and `src/camera` forbids `engine`, `post`, `layers`
  and `app`, but not `city` (nor each other). The brief for this task says camera may not import
  `src/city`; lint would not catch it. `src/camera` does not import it (checked with grep).

**M6, free look on the tour (2026-11-17).** Result against the request: on the tour a finger or
mouse drag turns the view while the tour flies on, and it drifts back 5 s after the drag ends (2 s when first measured below). A pinch
or the wheel zooms the lens, which stays until the tour is left. A double tap or double click leaves
for free flight from the chosen view. Evidence, all from runs in this session:

- `npm run check:task -- T11`: PASS, `Test Files 6 passed (6)`, `Tests 113 passed (113)`.
  `npm run check:task -- T12`: PASS. `npm run plans:check`: OK.
- Mutations, each restored afterwards. Each one failed the camera tests: dropping the look when
  taking over from the join; the spring return; the "a finger on the tour does not fly" guard; the
  double-tap gap check; the "no lock on the tour" check in `dom.ts`; dropping the look on a viewpoint
  glide.
- Live, `shots/T11/live-freelook.mjs`, shipped page with `?autostart=1`, ANGLE D3D11 on the RTX 4070
  SUPER. CDP touch: a 200 px drag gave yaw +0.900 (expected 200 x 0.0045) with the HUD still on
  Tour, held through 1.2 s, and back to the tour's yaw 4 s later. A 2x pinch gave fov 33.45
  (expected 33.4), still 33.45 four seconds later. A 0.8 s hold did not take over. A double tap
  switched to Free flight with a yaw change of 0.000, and the lens returned towards 62 (61.70 after
  1.5 s). Mouse: a 200 px drag gave yaw -0.440 without pointer lock; a 400 px wheel gave fov 36.50;
  a double click gave Free flight with pointer lock and no yaw change. No console errors or warnings.
- Looked at `shots/T11/fl-1` to `fl-5`: the new hint on the tour, the view turned left down a
  side street, the zoomed lens, and free flight with the toast and Back to tour. Also the menu help
  on desktop and on a 412 px phone viewport: both readable, and the desktop label "Look / zoom on
  the tour" wraps to two lines.

Not verified: a real phone or tablet (H-T11-4: feel of the pan speed, pinch, tap thresholds, and
whether Android Chrome ever turns a fast double tap into something else despite `touch-action:
none`); a real trackpad pinch; pointer lock on double click in a headed browser other than
Chromium.

**Retrospective.** Doing the tour first was right: it was the only part whose design could have
failed, and the kernel idea removed most of the geometry. The screenshots changed two decisions the
numbers could not (the avenue margin and the wide orbit). The fuzz tests passed on their first run,
which is why the mutation round was worth doing: it showed they could fail.
