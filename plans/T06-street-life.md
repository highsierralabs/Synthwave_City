---
id: T06-street-life
title: Ground traffic and crowds
status: done
depends_on: [T00, T01, T02]
owns: [src/layers/streetlife/**, tests/unit/streetlife/**, plans/T06-street-life.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-16
---

# T06: street life

## 1. Purpose

Make the streets busy. Every road carries a stream of cars: white-gold headlights coming towards you,
red and magenta tail lights going away, pools of light sliding over the wet asphalt. From the air the
avenues become rivers of light; at street level cars pass close by and people fill the sidewalks.

## 2. Context and orientation

`architecture.md` §4.3, §4.4, §5.2, §5.5. Lanes come from `ctx.plan.lanes` (`Lane` in
`src/contracts/city.ts`): `kind` (`street` or `avenue` for ground lanes), `axis` (0 runs along x, 1
along z), `fixed` (the constant coordinate), `y`, `dir`, `line`, `slot`. A lane runs the full tile and
wraps.

**How it is built** (this replaced the per-car instances the first draft of this plan described; see
the Decision log). Nothing is stored per car. A lane holds `count` car slots at even spacing, each
nudged by a hashed jitter that is always smaller than the gap, all sharing one integer `laps`:

```
coordinate(i) = fract(dir * laps * uLoop + phase + (i + jitter(i)) / count) * TILE
```

So a lane's cars are a pure function of (lane, index, loop phase), and three things evaluate it:

- **Near cars** (within 880 m, 3D distance). The GPU draws a fixed grid of instances, each meaning
  "the k-th car from the camera, in lane row r, of the j-th road from the camera". The vertex shader
  finds the road nearest the camera, reads that lane from a 40 x 12 float texture (`uLaneTex`, one
  texel per lane: offset from the centre line, `dir * laps`, `count`, `phase`), works out which car
  index the slot is this frame, hashes that index for jitter, class and colours, and places the car
  with `sc_place`. 9,828 instances stand for the 53,745 cars of the tile at full density.
- **Far traffic** (beyond 620 m, cross-faded to 880 m). One quad per road, 80 in all, lying on the
  carriageway out to the far fade. Its fragment shader runs the same function per pixel for the two
  cars either side of the pixel and draws each as soft spots: head lamps, tail lamps, pool, smear,
  underglow. Same lanes, same indices, same hashes, so a far dot is exactly where the car is.
- **The unit tests**, through the TypeScript mirror in `pack.ts`.

People use the same trick per block face: an instance is "person p on side s of the b-th block along
the j-th road from the camera", and walks that face of the block there and back for ever.

Files: `pack.ts` (pure: lane table, car model, instance grids, crowd model, the GLSL hash mirrored bit
for bit), `mesh.ts` (pure: the one vehicle mesh), `shaders.ts` (GLSL), `index.ts` (the layer).

## 3. Scope

Owns `src/layers/streetlife/**`. Non-goals: the road surface and lamps (T04), flying vehicles (T07),
stopping at intersections (cross traffic simply passes through; at city scale it reads fine).

## 4. Interfaces

Provides `createLayer()` with id `streetlife`. Car bodies and lamp sprites are reflected (three layer
0); the light on the road, the far traffic and the crowds are on `SC_LAYER_NO_REFLECT`. Consumes
`ctx.plan.lanes`, `uLoop`, `uTime` (strobes only), `uMotion`, `uCam`, `uFar`, `uPalette`, `uCellTex`
(the same bytes as `ctx.plan.cells`: district for crowd density, palette index for tints), fog,
`uResolution`, `uGlow`, `quality.density`, `quality.crowds`, `quality.fadeStart`. Imports only
`src/contracts`, `src/core` and three.

## 5. Plan of work

**M1. Cars on lanes.** One low-poly vehicle mesh built in code, 42 triangles and 34 vertices: a wedge
body, a cabin and two axles. Every vertex carries a second shape (a van), which the vertex shader also
stretches into a bus. Lanes are packed to 30 to 46 m per car at full density, the inner lane fastest
(avenues 10 to 21 laps, streets 6 to 11; one lap is 1.56 m/s), 12% of slots left empty so the streams
clump. Proof: unit tests of the packer and the model, and screenshots at two times.

**M2. Lights.** Two more meshes on the same instance buffer, both additive: five camera-facing lamp
sprites per car (two head, two tail, one roof beacon), held at a minimum pixel size; and three quads on
the road (headlight pool, tail smear, underglow in the car's palette colour). The bodies carry the lamps
themselves as emissive faces: tail bars in three styles, headlamps or a light bar, lit skirts.

**M3. Far traffic.** As described in section 2. Lamps far away never fall under about a pixel, exactly
as the sprites never do, and the pools keep the energy of the near quads, so the handover does not show.

**M4. Crowds.** Upright impostors turned about the vertical to face the camera, a figure from a signed
distance function (head, neck, shoulders, torso, legs that scissor with the distance walked, arms that
counter-swing, optional long coat or umbrella), dark, with the block's neon on the outline and one lit
detail each (jacket seam, visor, soles, a screen in the hand, piping, umbrella rim). Within 330 m, on
`medium` and up, fullest in `lowrise` and `plaza` cells.

**M5. Variety.** Emergency cars (0.6%) with a red and blue roof bar, a strobing beacon and a strobe
thrown across the carriageway; taxis (6%) with a lit roof sign; a few cars with over-bright underglow
and lit wheel rings; vans; buses with lit saloon windows, a route stripe and a destination sign.

**M6. People between the buildings (revision, 2026-11-16).** The operator: "The pedestrians only stay
next to the road. There are areas between the buildings that have shops and open plazas that have no
pedestrian traffic." Two new places to walk, one more draw call, the same figure (`WALKER_FRAG`):

- **Alleys.** The gaps T01 leaves between lots run the full depth of a block, lined with podium shop
  fronts. At init the layer finds them from `plan.boxes` (contract data; no change to `src/city`): per
  cell, the street-level boxes' extents along each axis are merged, and every free band between two
  of them at least 3 m wide is an alley, up to three per axis. Plaza and mega cells have none. They go
  into a small float texture, `uAlleyTex` (4 texels per cell: centres and half widths per axis).
- **Plazas.** Open squares, with kiosks in some corners, and a light pillar and searchlights within
  18 m of the centre. People stroll round rings 24 to 50 m from the centre, cross on straight lines
  22 m or more from the centre and 24 m or more from the side they run along, or stand about. Both
  shapes stay clear of every corner kiosk (a kiosk lies 3 to 23 m in from both edges) and of the
  centre by construction.
- **The instance grid:** "slot p of the cell (dx, dz) from the camera's cell", 5 x 5 cells. In a plaza
  every slot is a person; elsewhere slot p belongs to alley p mod 6 and is hidden if the cell has no
  such alley. Density per district as on the sidewalks, and off where the tier has no crowds. Each
  person walks there and back (or round) a whole number of times per loop, so the loop stays seamless.

Proof: a TypeScript mirror of the placement in `pack.ts`, with unit tests on a real city plan: nobody
inside or within a body's width of any box, at many cameras and loop phases; nobody in a road; plaza
walkers clear of the pillar and searchlights; whole laps; walking pace. Screenshots from inside an
alley and over a plaza.

**M7. Motorcycles (revision, 2026-11-16).** The operator: "the street traffic needs some motorcycles."
A fourth vehicle class, 10% of slots (taken from plain cars; vans, buses, taxis and emergency cars are
unchanged), in any lane. The vehicle mesh gains a third shape per vertex, `aBike`, on the same 34
vertices: the body prism becomes a slim tank, seat and fairing, the cabin frustum a rider leaning
forward, the two axle boxes become the wheels (the fragment shader already cuts an axle's outer faces
to round wheels). One head lamp and one tail lamp (the second sprite of each pair is hidden), a
helmet visor in the accent colour, a lit flank line and the usual underglow; the far dashes draw a
motorcycle's lamps at about half the power of a car's pair. A bike is 2.2 m long, so lane spacing and
`MIN_GAP` hold.

Proof: unit tests on the mesh (third shape well formed, wound outwards, standing on the road, narrower
than a car) and on the class mix (about 10% motorcycles, never a taxi or emergency vehicle);
screenshots near and far, from the street and from above.

## 6. Validation and acceptance

- `npm run check:task -- T06` exits 0.
- Screenshots in `shots/T06/` with `layers=sky,ground,buildings,streetlife`: `street`, `canyon`, `high`,
  `top`; two times 2 s apart from the same camera to show motion.
- Traffic keeps right: from a camera looking along a road, oncoming headlights are on the left of the
  frame and tail lights on the right. Check a road on each axis and write down what was seen.
- At most 5 draw calls in the main pass; `update` does no work.
- A frame at time `LOOP_SECONDS - 0.01` and one at `0.01` show cars in continuous positions (the loop
  seam).

Human checks: H-T06-1, the streets feel busy rather than sparse or jammed.

**M6 and M7 acceptance.** `npm run check:task -- T06` exits 0; the unit tests above pass and one is
shown failing once; screenshots in `shots/T06/m6/` from inside an alley, over a plaza, and of
motorcycles near and far, looked at and described; no console errors; `npm run smoke` stays within its
budget. Human check H-T06-3: on the operator's devices, the alleys and plazas read as busy and the
motorcycles read as motorcycles.

## 7. Idempotence and recovery

Stateless. Everything is built in `init` from the plan, the quality tier and the seed; `dispose`
removes the five meshes and frees their geometries, materials and the lane texture.

## 8. Progress

- [x] 2026-11-14 M1 cars on lanes: `pack.ts`, `mesh.ts`, body shader.
- [x] 2026-11-14 M2 lights: lamp sprites and road quads.
- [x] 2026-11-14 M3 far traffic: one quad per road, cross-faded with the near cars.
- [x] 2026-11-14 M4 crowds.
- [x] 2026-11-14 M5 variety: emergency cars, taxis, vans, buses, wheel rings.
- [x] 2026-11-14 Art pass against screenshots, first with the probe, then with the real `sky`, `ground`
  and `buildings` layers once they landed: pools made view-dependent, far dashes turned into filtered
  soft spots, lamp visibility shared between sprites and far traffic, figure redrawn, wheels cut round,
  gentler density curve for the lower tiers.
- [x] 2026-11-14 Acceptance list run; evidence in section 12. Nothing is left open.

- [x] 2026-11-16 M6 people between the buildings: `buildAlleyTable`, `buildBlockField` and the mirror
  `blockWalkerAt` in `pack.ts`; `BLOCK_VERT` and the shared figure `sl_figure` in `shaders.ts` (the
  sidewalk crowd now calls it too, with the same arithmetic); `uAlleyTex` and a sixth draw call in
  `index.ts`. M7 motorcycles: the `bike` shape in `mesh.ts`; class 3 in `sl_car`, bodies, lamps,
  pools and far dashes in `shaders.ts`; `carClass` in `pack.ts`; `aBike` in `index.ts`. Tests:
  `tests/unit/streetlife/between.test.ts` (9) and the mesh tests in `pack.test.ts` now cover three
  shapes. Evidence below.
  - Seeds 1 and 2049: more than 1,000 alleys per city (the test's floor; seed 1984 has 5,163), more
    than 60% of built blocks have one, none in a plaza or megatower block, and no street-level box
    reaches into any alley.
  - People in alleys and on plazas, 12 cameras x 3 loop phases x 25 cells x 240 slots per city:
    none outside their block, none closer than 0.5 m to a building, none within 22 m of a plaza
    centre or closer than 0.5 m to a light pillar or 1.5 m to a searchlight. Whole laps; at loop 1
    everyone is where they were at loop 0; walking pace 0.5 to 1.8 m/s.
  - Shown failing once: with the shop-window margin at 0.2 m the wall test failed ("expected
    0.19999 to be greater than or equal to 0.5"); restored to 0.7 m, passes.
  - Motorcycles: within one point of the expected 9.3% (10% x (1 - 0.066)) of all car slots of
    seed 1, never a taxi or an emergency vehicle; the shape stands on its wheels, is 1.62 m tall and
    0.4 m wide at most, at the rider's hips (a car is 1.9 m wide), every face wound outwards.
  - Looked at, all with `layers=sky,ground,buildings,streetlife`, seed 1984, t = 20 s, no console
    errors or shader warnings: `shots/T06/m6/alley-street.png` (eye height in a lowrise alley: people
    walking both ways, others standing at the shop windows, the alley continuing into the next
    block), `alley-high.png` (from 22 m: figures spread along the whole alley, a few umbrellas),
    `plaza-view.png` and `plaza-top.png` (people round the rings and crossing the square, the corner
    kiosks and the centre clear), `bike-near.png` and `bike-above.png` (a motorcycle in the inner
    lane: two wheels, slim body, a hunched rider with a helmet, one magenta tail lamp and its
    reflection).
  - `npm run check:task -- T06` PASS; `npm run check` 373 of 373; `npm run plans:check` OK;
    `npm run smoke` SMOKE OK, 60 draw calls (59 before), median 8.0 ms, p99 8.1 ms, none over 50 ms.
    The committed code measured the same day gave median 8.0 ms, p99 8.1 ms: the display ran at about
    125 Hz that day (765 frames in 6 s), so the 6.9 ms of earlier runs is not comparable.

## 9. Surprises and discoveries

- **A quad lying on the road faces up for one direction of travel only.** The first far-traffic pass
  showed traffic on avenues running along z and none on roads along x; the headlight pools did not show
  at all. In the car frame, forward x right points down. Fixed with `DoubleSide` on the two road
  materials. Evidence: the first `high` shot lit one avenue only; `shots/T06/solo_high.png`, taken after
  the fix, shows both axes. (The earlier image was overwritten.)
- **A backtick in a GLSL comment ends the template string.** The module then fails to parse, Vite
  answers 500 and the harness reports `layer "streetlife" failed to load`. `tsc` did not see it first
  because the screenshot ran first.
- **A diffuse pool at L 1.5 floods the street.** Seen from 1.8 m, one car's 26 m pool behind the camera
  covered the lower half of the frame in grey (`shots/T06/hud_street.png`). From 45 m the same pool
  looked right. Pools are now 0.7 at most and dimmer from the street than from the air, which is also
  what wet asphalt does: it throws headlight forward, not up.
- **Hard-edged far dashes read as dithering.** Box-filtered rectangles gave every road a braided, blocky
  look from the air (the first `solo_high.png`, since overwritten). Gaussian spots whose variance has the
  pixel footprint added are smooth at every distance.
- **A sprite held at a minimum size needs a wider core.** With the near-range core (`exp(-14 r^2)`) a
  lamp held at 2.4 px had a core under half a pixel wide, which would flicker as it crossed pixel centres. The core
  now widens to a sigma of about 0.9 px when the sprite is held, and the far spots use the same floor.
- **The triangle budget decides the design.** Per-car instances across the tile would have been about
  53,745 cars x (52 triangles in each of two passes + 6 on the road) = 5.9 million, against a budget
  of 3 million for the whole frame (§9). The camera-relative grid measures 1.10 million for this layer at `high`, reflection pass
  included (`layers=streetlife`: 1,096,615 triangles, of which 15 are the pipeline's own).
- **0.35 of the traffic is not busy.** With the lane packing scaled straight by `quality.density` the
  `low` tier had a car every 85 to 130 m and the avenue looked empty (the first `tier_low.png`, since
  overwritten). See the Decision log.
- **The layer's seed depends on what else is mounted.** The engine gives the i-th mounted layer
  `hashInts(seed, i + 1)`, so `layers=streetlife` and `layers=sky,ground,buildings,streetlife` show
  different traffic. Not a defect, but worth knowing when comparing screenshots.
- **One combined page hung for over two minutes** (`layers=sky,ground,buildings,streetlife`, about
  20:26 local) while `layers=streetlife` alone rendered at once and each sibling layer loaded alone
  minutes later. A sibling was mid-edit; nothing to fix here.

- **The display's refresh rate moved between sessions (2026-11-16).** Smoke read a median of 6.9 ms
  on 2026-11-15 and 8.0 ms on 2026-11-16 with or without this change, every frame alike: the
  browser paced at about 125 Hz instead of 144 Hz. A vsync-on frame time is only comparable with
  one taken the same day.
- **Uncapped layer timings were noise (2026-11-16).** `scripts/perf.mjs` on the unchanged code reported
  0.23 ms frames with 36 ms of CPU while the dev server was reloading the stashed files; those runs
  are not evidence either way. What is measured: one more draw call and 12,000 more triangles
  (6,000 quads) at the high tier.

## 10. Decision log

- 2026-11-14 **Camera-relative instance grid instead of one instance per car.** Reason: the triangle
  budget above, and the reflection pass doubling whatever the layer draws. The lane model, the laps
  rule, the no-overlap guarantee and "no per-frame CPU work" are unchanged; only what an instance
  stores changed (a slot, not a car).
- 2026-11-14 **Handover at 620 to 880 m, not "about 1,200 m".** At 880 m a car body is under 6 pixels
  long and dark; every 100 m of radius costs about 1,000 instances. The distance is 3D, so from high
  altitude no bodies are drawn at all and the top view has no ring.
- 2026-11-14 **Traffic follows `sqrt(quality.density)`, crowds follow it directly.** Reason: only near
  cars cost anything here, and "busy streets" was asked for by name. `low` goes from 3,900 to 6,084
  car instances (`trafficDensity` in `pack.ts`, tested). T13 may retune it; it is one function.
- 2026-11-14 **Additive light is attenuated by fog, `colour * (1 - sc_fogAmount)`, not mixed with
  `sc_fog`.** Mixing would add the fog colour a second time on top of what the surface behind already
  carries. Opaque surfaces (bodies, people) go through `sc_fog` as the rule says.
- 2026-11-14 **People walk one block face there and back** (`abs(2 fract(laps * uLoop + phase) - 1)`)
  rather than along the whole road. They never step into a cross street, the figure is symmetric so
  the turn does not show, and it is still loop-periodic with integer laps.
- 2026-11-14 **Crowds are opaque with `discard`, no alpha-to-coverage.** It would write partial alpha
  into the frame, and nothing here knows who reads that. Far figures are fattened by 0.35 px instead so
  they never drop out.
- 2026-11-14 **Road quads use polygon offset (-2, -8) as well as a 4 cm lift.** At 3 km the depth
  buffer cannot resolve 4 cm.
- 2026-11-14 **Lamps show a little from above** (`sl_headShow`, `sl_tailShow`: 0.2 and 0.24 of full),
  and fully only from the end they point at. That keeps white on one side of a road and red on the
  other from the street and from a low flight, and still dots the roads from straight overhead.
- 2026-11-14 **Districts are read from `uCellTex` in the vertex shader**, which is `ctx.plan.cells`
  as uploaded by the engine, instead of a second texture of the same bytes.
- 2026-11-14 **Wheel faces are cut to discs with a `discard` placed after every derivative**, rather
  than spending triangles on round wheels.
- 2026-11-14 **Emergency strobes use `uTime`** (cosmetic, §4.3) and are scaled by `uMotion`.

- **Alleys are found from the boxes, not handed over by T01 (2026-11-16).** `plan.boxes` is contract
  data; T01's lot grid makes every free band across a block run its full depth, so merging the
  street-level extents per cell finds them exactly. No change to `src/city` or the contracts.
- **One grid of "slot p of the cell (dx, dz)" serves alleys and plazas (2026-11-16).** A plaza uses
  every slot, a block hands slot p to alley place p mod 6, and the vertex shader decides from the
  district byte which it is. One draw call, 25 cells x 240 slots at full density. 240 rather than
  the first 162: from 95 m up a plaza with 162 people looked thin.
- **Plaza paths are rings and straight crossings, not free wandering (2026-11-16).** Both stay clear
  of the corner kiosks (3 to 23 m in from both edges), the light pillar and the searchlights by
  construction, so nothing has to be avoided at run time; the rings also echo the ground's pulsing
  rings.
- **Motorcycles are a third shape on the vehicle mesh (2026-11-16).** Same 34 vertices, same instance
  buffer and draw calls: the body prism becomes the tank and fairing, the cabin the rider, the axle
  boxes the tyres, which the fragment shader already cut to round wheels. A separate mesh would have
  meant another draw call over all 9,828 car slots.
- **10% motorcycles, taken from plain cars only (2026-11-16).** Vans, buses, taxis and emergency
  vehicles keep their shares, so nothing the operator has already seen changes kind except some
  plain cars.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

**Result against Purpose.** Every road carries traffic in both directions, keeping right, in every
lane the plan provides (360 ground lanes, 53,745 cars at `high`). Headlights are white-gold, tail
lights red with some magenta, each car throws a pool ahead and a smear behind and carries underglow
in a palette colour. From the air the avenue below the camera and the grid beyond read as streams of
white and red dots. At street level cars pass within metres, buses show lit windows, an emergency car
strobes the street red and blue, and the sidewalks are populated.

**Evidence** (all on 2026-11-14, RTX 4070 SUPER through ANGLE D3D11, 1600 x 900, `sunset` unless said):

```
npm run check:task -- T06
typecheck tsconfig.json: 0 error(s) in T06-street-life, 0 elsewhere
typecheck tsconfig.node.json: 0 error(s) in T06-street-life, 0 elsewhere
lint: ok (src/layers/streetlife, tests/unit/streetlife)
tests: ok (tests/unit/streetlife)   Tests  24 passed (24)
PASS T06-street-life
```

- Tests were shown failing first, by four temporary mutations, each reverted: jitter not bounded by
  the gap (2 tests fail), walkers allowed 3 m into the carriageway (1), the instance grid two cars
  short (2), one mesh face wound inwards (1).
- Draw calls: `layers=streetlife&post=0` reports 6, an empty scene reports 1, so 5 in the main pass.
  With the pipeline 22 against 15: the 5, plus bodies and lamps again in the reflection pass.
  `update` is an empty function.
- Loop seam, `shots/T06/seam_0..3.png` at t = 4095.97, 4095.99, 0.01, 0.03 from one camera: mean
  absolute difference between neighbours 2.390, 2.393 (across the seam), 2.413. Control against
  t = 2000: 19.7.
- Sizes, counted from the real plan with the final code: `high` 53,745 cars in the tile, 9,828 car
  instances, 7,680 walker instances; `medium` 41,651, 7,644 and 4,560; `low` 31,790, 6,084 and none.
- No console errors and no shader warnings in any shot of the final code.

**Screenshots looked at, and what was seen** (`shots/T06/`):

- `final_street_0/1.png` (t = 5 and 7, avenue along z): oncoming headlights left of the median, tail
  lights right; a car with a segmented tail bar fills the foreground at t = 5 and is gone at t = 7,
  where a car with yellow underglow passes on the left. People walk the right sidewalk in front of
  the shop fronts.
- `final_side_0.png` (street along x): a van with headlights left of the centre line, two cars with
  tail lights right of it. Keeps right on both axes.
- `final_canyon_0.png`, `shim_crop_0/1.png` (3x crops, camera moved 1.5 m between frames): the avenue
  is a stream of white dots on the left and red on the right to the horizon; the same dots in both
  frames, no sparkle, no visible ring where cars become dots.
- `final_high_0.png` and `final_high_crop_0.png`: the avenue below reads as a river of light between
  the towers, white left and red right. Other avenues are hidden by buildings from this camera.
- `final_top_0.png` and its crop: every road is dotted with white and red from 2,400 m.
- `rclose.png`, `bus.png`, `emergency_0/2.png`, `walk_crop_0/1.png`: wedge cars with round wheels,
  underglow, lit skirts and wheel rings; a bus with lit windows and a violet stripe; an emergency car
  throwing blue in one frame and red in the next; figures whose legs change between frames.
- `seam_1.png`, `solo_ring.png`, `solo_ring2.png` (this layer alone): pools ahead of cars and smears
  behind them, and the far grid of traffic with no ring at the handover.
- `tier_low.png`, `tier_medium.png` (both with the final density curve), `mood_midnight.png`: the low
  tier has a reasonably full avenue and no crowds, the medium tier a full one with crowds; midnight
  works.

**Gaps and what was not verified.**

- H-T06-1 is a human check. In my judgement of the stills the avenues are busy and not jammed; a person
  should watch it move.
- Seen only on this GPU, at 1600 x 900, through D3D11. Not seen on a phone, on Linux, under SwiftShader
  or with a real `mediump`. No frame time was measured; the harness's 144 fps is not a measurement.
- The GLSL hash and its TypeScript mirror are assumed equal because both are integer hashes of the
  same bits; that was not checked on the GPU. The no-overlap guarantee does not depend on it (the test
  that feeds worst-case jitter proves that), only the tests' knowledge of which car is where does.
- Whole-repo `npm run check` and `npm run smoke` were not run (siblings were mid-flight);
  `npm run plans:check` printed OK. Context loss and restore were not exercised.
- `discard` edges on people and wheels are not smoothed by MSAA. They are dark on dark and I saw no
  crawl in stills; a moving camera could show some.
- Cross traffic passes through itself at intersections, as the plan accepts.
- Reduced motion (`uMotion` at 0.25) is wired into the strobes but was not looked at.

**Retrospective.** The useful move was to stop thinking of cars as things that are stored. Once a lane
is a function, the near cars, the far dashes and the tests are three readers of it and cannot drift
apart. The real layers changed every brightness judgement made against the probe; the last third of
the art pass should have waited for them.

**M6 and M7 outcome (2026-11-16).** People now walk the alleys between the buildings, stand at their
shop windows, and stroll and cross the plazas; one car slot in about eleven is a motorcycle with a
rider, one lamp at each end and its own light on the road. Everything is placed in the vertex shader
from the loop phase, as before, so the loop stays seamless and nothing is updated per frame.
Not verified: how it looks in motion and on the operator's devices (H-T06-3); a closer, oncoming
motorcycle at night and the far dashes of motorcycles were not inspected one by one; the medium and
low tiers were not photographed (the unit tests cover the thinning); frame cost on a phone.

**H-T06-3 result (2026-11-16, operator, over the tailnet preview).** "Pedestrians look much better. The
city feels busier now. The motorcycles ok. They are a bit blocky up close but read as motorcycles."
Passed. Noted for a later pass, not requested: the motorcycle's rider and body are blocky up close.
