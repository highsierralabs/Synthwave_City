---
id: T06-street-life
title: Ground traffic and crowds
status: ready
depends_on: [T00, T01, T02]
owns: [src/layers/streetlife/**, tests/unit/streetlife/**, plans/T06-street-life.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-14
---

# T06: street life

## 1. Purpose

Make the streets busy. Every road carries a stream of cars: white-gold headlights coming towards you,
red and magenta tail lights going away, pools of light sliding over the wet asphalt. From the air the
avenues become rivers of light; at street level cars pass close by and people fill the sidewalks.

## 2. Context and orientation

`architecture.md` §4.3, §4.4, §5.2, §5.5. Lanes come from `ctx.plan.lanes` (`Lane` in
`src/contracts/city.ts`): `kind` (`street` or `avenue` for ground lanes), `axis` (0 runs along x, 1
along z), `fixed` (the constant coordinate), `y`, `dir`. A lane runs the full tile and wraps.

Vehicles are instances. Each stores its lane's axis, fixed coordinate and direction, a phase in
`0..1` and an integer `laps`; the vertex shader computes
`s = fract(laps * uLoop + phase) * TILE`, turns that into a tile position along the lane, and places
the car with `sc_place`. There is no per-frame CPU work at all. Cars in one lane must not overlap:
give every car in a lane the same `laps` and evenly spread phases with jitter smaller than the gap,
and vary `laps` between lanes (faster inner lanes).

## 3. Scope

Owns `src/layers/streetlife/**`. Non-goals: the road surface and lamps (T04), flying vehicles (T07),
stopping at intersections (cross traffic simply passes through; at city scale it reads fine).

## 4. Interfaces

Provides `createLayer()` with id `streetlife`. Cars are reflected (three layer 0); crowds and light
pools are on `SC_LAYER_NO_REFLECT`. Consumes lanes, `uLoop`, `uTime`, `uPalette`, fog, `quality.density`.

## 5. Plan of work

**M1. Cars on lanes.** One low-poly car mesh built in code (wedge body and cabin, about 40 triangles),
instanced. Pack attributes from the lanes: spacing about 28 to 45 m at full density, scaled by
`quality.density`. Body colours dark with a palette-coloured underglow strip and roof line. A few
vehicle classes by scale (car, van, bus) from one mesh. Proof: a unit test of the packer (count per
lane, no two cars in a lane closer than a minimum gap at any loop phase), and `street` and `high`
screenshots at two times showing the cars have moved along their lanes.

**M2. Lights.** A second instanced mesh sharing the same instance buffers, additive: headlight and
tail-light quads (L3 cores, small), a soft pool on the road ahead of the headlights and a red smear
behind, and the underglow as a ground quad in the car's palette colour. Light sprites fade in size
with distance but keep a minimum pixel size, so a distant car is still a dot of light.

**M3. Far traffic.** Beyond about 1,200 m draw no car bodies; instead, one ribbon quad per lane lying
just above the road, whose shader draws moving dashes with the same spacing and speed as that lane's
cars, white one way and red the other, cross-faded with the real cars so the handover is invisible.
This is what makes avenues read as rivers of light from the air. Proof: `high` and `top` views.

**M4. Crowds.** Pedestrians as small upright camera-facing impostors on the sidewalks: a simple
figure silhouette from an SDF, dark with a rim or accent in a palette colour, drifting along the
sidewalk with the same loop-periodic rule (much smaller `laps`), bobbing slightly. Only within about
350 m of the camera and only on `medium` and up. Density highest in `lowrise` and `plaza` cells
(read `ctx.plan.cells`). Proof: `street` view shows populated sidewalks; nobody stands in the road.

**M5. Variety.** Occasional emergency vehicle with a red and blue strobe; a few cars with over-bright
underglow; buses with a lit side stripe.

## 6. Validation and acceptance

- `npm run check:task -- T06` exits 0.
- Screenshots in `shots/T06/` with `layers=sky,ground,buildings,streetlife` where available: `street`,
  `canyon`, `high`, `top`; two times 2 s apart from the same camera to show motion.
- Traffic keeps right: from a camera looking along a road, oncoming headlights are on the left of the
  frame and tail lights on the right. Check a road on each axis and write down what was seen.
- At most 5 draw calls in the main pass; `update` does no work.
- A frame at time `LOOP_SECONDS - 0.01` and one at `0.01` show cars in continuous positions (the loop
  seam).

Human checks: H-T06-1, the streets feel busy rather than sparse or jammed.

## 7. Idempotence and recovery

Stateless.

## 8. Progress

- [ ] M1 cars on lanes
- [ ] M2 lights
- [ ] M3 far traffic
- [ ] M4 crowds
- [ ] M5 variety

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
