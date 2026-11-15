---
id: T11-camera
title: Camera: tour, free flight, viewpoints, input
status: ready
depends_on: [T00, T01]
owns: [src/camera/**, tests/unit/camera/**, plans/T11-camera.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**]
updated: 2026-11-14
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

## 3. Scope

Owns `src/camera/**`. Non-goals: menus and on-screen hints (T12), the harness's own simple camera
(T00), camera shake or other post effects.

## 4. Interfaces

Provides from `src/camera/index.ts`: `createCameraRig(plan, options)` returning a `CameraDriver` with
`setMode('tour' | 'free')`, `mode`, `goToViewpoint(index)`, `viewpoints` (name and pose),
`attachInput(element)` returning a detach function, `setReducedMotion(boolean)`, and `speed` for the
HUD. Consumes `CityPlan`, constants, `src/core`.

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

## 6. Validation and acceptance

- `npm run check:task -- T11` exits 0, including the 30-minute tour collision test and the
  frame-rate independence test.
- In the harness with the rig mounted (`/dev/?layers=...&rig=1`, a flag T00's harness passes through
  to this module when it exists): a sequence of 8 frames 1.5 s apart along the tour, viewed, showing
  a smooth path with banking and no clipping through geometry.
- Pose values never contain `NaN` after 10 minutes of random input (fuzz test).

Human checks: H-T11-1, the tour is pleasant to watch and never nauseating; H-T11-2, flight feels
responsive with a real mouse; H-T11-3, touch control on a real phone.

## 7. Idempotence and recovery

Stateless apart from the rig's own state. `attachInput` returns its own cleanup.

## 8. Progress

- [ ] M1 free flight
- [ ] M2 input
- [ ] M3 viewpoints
- [ ] M4 tour
- [ ] M5 handover

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
