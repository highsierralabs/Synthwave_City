---
id: T07-air-traffic
title: Flying vehicles
status: done
depends_on: [T00, T01, T02]
owns: [src/layers/airtraffic/**, tests/unit/airtraffic/**, plans/T07-air-traffic.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-14
---

# T07: air traffic

## 1. Purpose

Fill the air between the towers with traffic. Streams of flying cars run in stacked lanes above the
avenues, each one a small dark hull with a hot engine, blinking running lights and a long trail of
light behind it. A few huge slow ships drift over the city. Looking down an avenue the viewer should
see several levels of traffic receding into the haze; flying in a lane, craft should pass close on
both sides.

## 2. Context and orientation

`architecture.md` §4.3, §4.5, §5.2, §5.5. Sky lanes are the entries of `ctx.plan.lanes` with
`kind === 'sky'`: `axis`, `fixed`, `y` (altitude) and `dir`, above the avenues only. Lanes along x and
along z have different altitudes, so crossing streams never meet, and the air above a road is always
clear of buildings.

Craft are instances animated entirely in the vertex shader, exactly like ground traffic:
`s = fract(laps * uLoop + phase) * TILE` along the lane, then `sc_place`. Same no-overlap rule: one
`laps` per lane, evenly spread phases with small jitter. Trails are quads stretched backwards along
the lane and turned to face the camera with `sc_axisBillboard`.

## 3. Scope

Owns `src/layers/airtraffic/**`. Non-goals: ground traffic (T06), searchlights (T08), anything the
camera does.

## 4. Interfaces

Provides `createLayer()` with id `airtraffic`. Hulls are reflected (layer 0); trails and glows are
additive and also reflected, since trails in wet streets are a large part of the look. Consumes sky
lanes, landmarks (for hero ship routes), `uLoop`, `uTime`, `uBeat`, `uPalette`, fog, `quality.density`.

## 5. Plan of work

**M1. Craft in lanes.** Two or three hull shapes built in code (a sleek wedge car, a boxy hauler, a
small drone), each an instanced mesh sharing one material. Spacing about 70 to 140 m at full density.
Speeds 25 to 70 m/s by altitude (higher is faster). A slow vertical bob and a few metres of lateral
weave from hashed sines, small enough that streams stay clear of each other. Hulls L0 with thin
palette accent lines. Proof: unit test of the packer and spacing; `canyon` and `high` screenshots at
two times.

**M2. Engines and running lights.** Additive glow sprites: engine at the rear (L3 core in the craft's
palette colour), white or cyan lamps at the front, a strobe that blinks on a hashed phase. Minimum
pixel size so a far craft remains a point of light.

**M3. Trails.** Each craft drags a tapered ribbon 30 to 120 m long in its engine colour, bright at the
head and fading to nothing, with a faint flicker. From a distance the lanes become continuous
streaks; trails must look right both side-on and head-on (when head-on the ribbon collapses, so keep
the head glow). Proof: `high` view shows layered streams over avenues; `canyon` shows individual
trails.

**M4. Hero ships.** Three to six large vessels (60 to 200 m) on slow fixed routes above the skyline
or along wide avenues at high altitude: a freighter with rows of lights, an airship with a glowing
belly and side panels of animated colour, a patrol craft with red and blue strobes and a searchlight
cone pointing down. Their positions come from a closed-form function of `uLoop` (loop-periodic), so
they may be placed in the shader or by a tiny allocation-free `update`.

**M5. Near passes.** Check the experience from inside a lane: craft passing the camera within a few
metres should have enough shape and light to be exciting, not a flat quad. Add simple detail where
needed.

## 6. Validation and acceptance

- `npm run check:task -- T07` exits 0.
- Screenshots in `shots/T07/` with `layers=sky,ground,buildings,airtraffic` where available: `canyon`,
  `high`, `mega`, one from inside a sky lane (use `cam=` on an avenue line at a sky-lane altitude),
  and two times 1 s apart from the same camera.
- No craft passes through a building: verify by unit test that every lane's `fixed` coordinate plus
  the maximum weave stays inside the avenue corridor.
- A frame just before and just after the loop seam shows continuous positions.
- At most 8 draw calls in the main pass.

Human checks: H-T07-1, the sky feels busy and layered rather than like a swarm.

## 7. Idempotence and recovery

Stateless.

## 8. Progress

- [x] 2026-11-14 M1 craft in lanes. `pack.ts` (packer and a TypeScript mirror of the motion),
  `shapes.ts` (three hulls built as lofts: wedge car 44 triangles, hauler 54, drone 30), `shaders.ts`,
  `index.ts`. About 8,600 craft at full density, sorted by shape, three instanced meshes sharing one
  material. Unit tests in `tests/unit/airtraffic/pack.test.ts` and `shapes.test.ts`.
- [x] 2026-11-14 M2 engines and running lights. Five glow sprites per craft (two engines, a headlamp
  with an anamorphic streak, a white strobe, a red belly beacon), directional, held at a minimum
  pixel size with the core widened and dimmed so far craft stay points of light without aliasing.
- [x] 2026-11-14 M3 trails. One ribbon per craft in the same draw call as the sprites; it follows the
  craft's own past weave and bob, shows two exhaust lines when the engines are seen side by side,
  and fades out when seen end-on.
- [x] 2026-11-14 M4 hero ships. Two freighters, two airships, two patrol craft, one merged hull mesh
  and one merged light mesh, placed in the vertex shader from `uLoop`. Routes from `planHeroes`.
- [x] 2026-11-14 M5 near passes. Looked at a car from behind, ahead and below, a hauler side-on and a
  drone, at 5 to 12 m; reworked canopy, fins, hover pads, sprite halos and trail width after looking.
- [x] 2026-11-14 Acceptance run, evidence in section 12.

## 9. Surprises and discoveries

- **A black block over most of the frame, from one NaN.** First `canyon` shot with the pipeline on:
  `black 83.6%`, a hard-edged black rectangle from x = 133 to 1467; with `post=0` the frame was fine
  (`black 1.9%`). Bisected by hiding meshes: only the craft light mesh caused it, and only the trail
  branch of its fragment shader. Cause: on the multisampled target a plain varying is evaluated at
  the pixel centre even when that lies outside the triangle; a trail seen end-on is a sliver, the
  extrapolated `along` coordinate ran far negative, `exp(-a * 30.0)` overflowed to infinity, and
  infinity times a zero fade is NaN, which the bloom's mip chain spread into a block. `isnan()` in
  the shader did not catch it (the D3D compiler appears to fold it away); `max(col, 0.0)` did.
  Fix: `centroid varying` on the light shaders' varyings, clamps on the coordinates, and
  `max(col, vec3(0.0))` on output. Worth a line in Agents.md, "Custom GLSL" (reported to T00).
- **Opaque shaders can write NaN too.** `pow(1.0 - abs(dot(n, view)), 3.0)` has a negative base when
  the dot product rounds above 1, and `normalize(cross(dFdx, dFdy))` divides by zero on a degenerate
  face. Both are now guarded (`at_normal`, `at_fresnel`). Not observed as the cause of a visible
  defect; fixed while hunting the one above.
- **Ribbons need `DoubleSide`.** `sc_axisBillboard` ribbons face either way depending on the side
  the camera is on, so with the default `FrontSide` about half the trails were culled (first lane
  shot: no trails at all on the receding side).
- **The seed a layer got depended on which layers were mounted.** The engine handed out
  `hashInts(seed, index of the layer among those mounted)`, so `?layers=airtraffic` and
  `?layers=sky,ground,buildings,airtraffic` showed different traffic and hero positions. T00 changed
  it to seed by layer id during this task (commit e58f306, 20:28), which moved every craft and hero
  ship between two of my shots; the evidence in section 12 was all retaken after that.
- **Megatowers are up to 1,025 m tall** (architecture.md says 600 to 900), and the cell height byte
  caps at 1,020 m. The hero route planner takes the tallest cell beside an avenue and keeps 28 m
  clear, so the 5 m of rounding is covered; the unit test sweeps `plan.heightAt` under each wide
  ship's whole route as a second check.
- **The tests found two real slips before they passed:** a lane at 70.3 m/s (45 laps) above the
  plan's 70 m/s, now clamped to 16..44 laps; and a float32 extent of 1.7000000477 against a limit
  of 1.7 (a tolerance in the test, not a defect).
- **Triangles.** With every layer mounted the frame was 3.07 M triangles against the 3 M budget
  (architecture.md 9), 1.11 M of them air traffic over the two passes. See the decision below.

## 10. Decision log

- 2026-11-14. **One craft = hull instance + light instance, six draw calls in all** (three hull
  shapes, craft lights and trails, hero hulls, hero lights). Sprites and the trail of a craft share
  one geometry and one additive material, so trails cost no extra draw call. Budget is eight.
- 2026-11-14. **Face normals from screen-space derivatives, no stored normals.** Hulls are lofts with
  shared vertices; the fragment shader takes `cross(dFdx(p), dFdy(p))` and turns it towards the
  viewer, which also holds in the mirrored reflection pass. Each loft piece carries one part id on
  all its vertices, so the `flat` part id cannot pick up a neighbour's value.
- 2026-11-14. **Fog only dims additive light** (`colour * (1 - sc_fogAmount)`), rather than
  `sc_fog`, which would add fog-coloured rectangles around every sprite. Same rule T08 arrived at.
- 2026-11-14. **Lanes are tubes.** A craft holds a constant place up to 6 m sideways and 6.5 m
  vertically off its lane line and sways about it; constant offset + sway + hull stays within
  11 m sideways (the corridor edge) and 10 m vertically, and never reaches the avenue centre line.
  Crossing lane levels are at least 40 m apart, so tubes never touch. Enforced by unit test.
- 2026-11-14. **Engine colour by lane level** (orange, magenta, cyan, violet from the lowest level
  up, 68% of craft; the rest any neon), so the stack reads as coloured layers from above.
- 2026-11-14. **Hero routes.** The two wide types fly above an avenue with their underside above
  both every sky lane (432 m) and the tallest roof beside that avenue plus 28 m, all four along one
  axis on different avenues, so they cannot meet; avenues with a megatower beside them are used
  last. The patrol craft is 25 m wide, narrower than the 40 m corridor, so it flies inside the
  canyon at 190 m and 235 m, the two altitudes that clear the lane tubes of both axes; one passes
  the downtown landmark and one the tallest megatower. Hero motion is closed-form in the shader,
  not a CPU `update`.
- 2026-11-14. **Everything that moves is loop-periodic, including sway, bob and the searchlight
  swing** (whole cycles per loop); `uTime` is used only for flicker, strobes and the screen
  animation. `at_laps` splits `uLoop` into 12 high bits and the rest so `laps * uLoop` keeps its
  low bits in float32.
- 2026-11-14. **Spacing 86 to 158 m (mean about 122 m), not the plan's 70 to 140 m, and four trail
  cross-sections instead of five,** to bring the whole frame back under 3 M triangles: 8,613
  craft with the harness seed, 0.51 M triangles per pass for this layer. The count stays inside the 8,000 to
  12,000 the task asked for. Hulls further than 2,000 m are not drawn (they are under 4 pixels and
  dark); their lights still are.
- 2026-11-14. **Sprite halos kept tight** (halo weight 0.45, engine sprite 1.9 m) after the near
  shots: larger halos washed the hull out to a flat blob at 10 m. Far visibility comes from the
  minimum pixel size instead.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

**Result against Purpose.** The air between the towers is full of traffic. Above every avenue, in
both directions and at four levels, streams of wedge cars, boxy haulers and small drones fly with
engine glow, a headlamp, a strobe, a belly beacon and a trail; the levels are colour-coded, so from
above the stack reads as layers. Six hero ships cross the city: two container freighters with rows
of gunwale and keel lights, two airships with a glowing belly and a flank screen showing a striped
sun over a grid beside a beat-driven equaliser, and two patrol craft with red and blue strobes and
a searchlight cone that sweeps the avenue and leaves a pool of light on the road.

**Evidence** (all from this session, 2026-11-14, RTX 4070 SUPER through ANGLE D3D11, 1600 x 900,
`layers=sky,ground,buildings,airtraffic` unless stated, after the engine's seeding change):

- `npm run check:task -- T07`: `typecheck tsconfig.json: 0 error(s) in T07-air-traffic`, `lint: ok`,
  `Tests 24 passed (24)`, `PASS T07-air-traffic`.
- Tests bite: five deliberate mutations each failed one or two tests (weave amplitude too large,
  phase jitter doubled, non-integer weave cycles, wide ships at 300 m, a flipped triangle), and two
  tests failed on real slips before the fixes noted in section 9.
- No craft through a building: `pack.test.ts`, "by construction" (every craft: offset + sway + hull
  inside the 11 m tube and off the centre line) and "in motion" (sampled positions inside the
  corridor, `plan.heightAt` zero under both flanks). Wide hero ships: `plan.heightAt` swept under
  the full width of each route, underside more than 10 m above the tallest box.
- Loop seam: unit test "is continuous across the loop seam", and `shots/T07/seam_0..3.png`
  (t = 4095.7, 4095.9, 0.1, 0.3 from `roof`): the craft and their trails advance by the same step
  across the seam as before and after it.
- Draw calls: `layers=airtraffic&post=0` reports 7, of which one is the fallback pipeline's blit:
  **6 in the main pass** (budget 8). 510,642 triangles in that pass (8,613 craft). All six meshes
  are on three layer 0, so the reflection pass draws them too.
- Whole frame with every layer present (`layers=all`, `view=high`): 59 draw calls, 2.98 M triangles,
  144 fps (the headless browser's cap, so only a sign that nothing is slow).
- Shots viewed, in `shots/T07/`: `canyon.png` (craft and dashes of trail receding up the slot of sky
  towards the sun, a hauler's underside overhead), `high.png` (coloured streaks along the avenues
  over the low-rise districts; over downtown they are hard to pick out against the facades),
  `mega.png` (streams climbing past the megatower in perspective, long trails across the sky to
  the right), `lane.png` and `lane_t6.png` (inside the 130 m lane, 1 s apart: an oncoming car with
  its headlamp streak on the left, a receding car with twin exhaust lines on the right, both
  moved), `seq_0..3.png` (0.5 s steps from `canyon`), `above.png` (from 520 m looking down 43
  degrees), `street.png` (traffic streaking through the slot of sky seen from the road, with its
  light in the wet street), `roof.png`, `sun.png`, `roof_low.png` and `roof_medium.png` (lower
  tiers: fewer craft, no errors), `sun_midnight.png`, `roof_miami.png`, `only.png` (air traffic alone:
  the lane grid as layers of orange, magenta, cyan and violet streaks).
- Near passes: `near_car_rear.png`, `near_car_front.png`, `near_car_below.png` (hover pads with
  moving stripes, red beacon), `near_hauler_side.png`, `near_drone.png`.
- Hero ships: `freighter.png`, `freighter_below.png`, `airship.png`, `airship_below.png`,
  `patrol.png` (head-on, searchlight cone down to the avenue), `patrol_rear.png`.
- Fourteen of these were looked at full size and the rest as half-size contact sheets
  (`sheet_a.png` to `sheet_d.png`, `seq_sheet.png`, `seam_sheet.png`, `shimonly_sheet.png`).
  `dbg_3.png` keeps the black block of section 9 for the record.
- No console errors and no shader warnings in any shot after the NaN fix.

**Gaps and what was not verified.**

- H-T07-1 (busy and layered rather than a swarm) is a human check. My own reading of `only.png`,
  `mega.png` and `near_hauler_side.png` is that it reads as layered streams; from `high`, over the
  downtown core, the traffic is lost among the building lights. Whether to lift the trails or calm
  the facades is T13's call.
- Frame time is not measured: the headless browser is capped at 144 fps. Triangle count is the
  only cost evidence. This layer is 1.02 M of the frame's 2.98 M triangles over the two passes,
  the largest single share, and the first place T13 should look if the budget tightens (fewer
  craft, or no hulls in the reflection pass).
- Only the `high` tier with MSAA was looked at closely; `medium` and `low` got one shot each. No
  phone or integrated GPU was tried. `mediump` precision bugs would not show on this GPU.
- Shimmer was checked on a four-frame sequence with the camera moving (`shimonly_*.png`), not in
  real-time motion.
- Reduced motion (`uMotion` below 1) holds strobes steady in the shader; not exercised.
- The hero ships' far fade (sinking with distance like everything else) was not looked at.
- Hero ships and craft are not lit by each other or by the searchlight; the cone is only light.
- A background batch of screenshots hung once and was stopped; a headless Chromium from it may
  have been left behind.
