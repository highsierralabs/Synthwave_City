---
id: T04-ground
title: Streets, plazas, wet reflections and street lamps
status: ready
depends_on: [T00, T01, T02]
owns: [src/layers/ground/**, tests/unit/ground/**, plans/T04-ground.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-14
---

# T04: ground

## 1. Purpose

Give the city a floor worth looking at: dark wet asphalt that mirrors the neon above it, glowing
curbs and lane markings that draw the street grid in light all the way to the horizon, plazas tiled
with a neon grid, and rows of street lamps. From the air the ground should read as a circuit board of
light; at street level it should shine.

## 2. Context and orientation

`architecture.md` §4.2, §4.4, §5.2 to §5.5. The street grid is fully regular and defined by constants
in `src/contracts/constants.ts`, mirrored as `#define`s and helper functions in `SC_COMMON`
(`src/contracts/glsl.ts`). Per-cell data (district, palette, height class, flags) arrives as the 40x40
texture `uCellTex`; sample it with `texelFetch` at the cell index. The mirrored city arrives as
`uReflTex` with `uReflMatrix` and `uReflAmount` (0 when the tier has no reflection pass).

The ground is one large plane centred under the camera, big enough to reach the far plane. Its
fragment shader recovers tile coordinates as `uCam.xz + relative.xz` and derives everything from
them. Because the pattern is periodic with the tile, the plane needs no wrap of its own.

## 3. Scope

Owns `src/layers/ground/**`. Non-goals: vehicles and their light pools (T06), building bases (T05),
the reflection pass itself (T02).

## 4. Interfaces

Provides `createLayer()` with id `ground`. The ground plane sets three layer `SC_LAYER_NO_REFLECT`
(it must not appear in its own reflection); lamps stay reflected. Consumes `uCellTex`, `uReflTex`,
`uReflMatrix`, `uReflAmount`, `uWet` and the rest of the shared uniforms.

## 5. Plan of work

**M1. Grid and surfaces.** From tile coordinates, find the nearest grid line on each axis, whether it
is an avenue, and the distance to it; classify the pixel as carriageway, sidewalk, intersection or
block interior. Asphalt, sidewalk and block floor each get an L0 base colour in the indigo family,
tinted slightly by the cell's palette. Proof: `view=top` shows the grid matching the probe boxes
exactly (no building overlaps a road).

**M2. Lines in light.** Lane dashes, solid edge lines, the avenue median as a glowing strip, stop bars
and crossings at intersections, and a neon curb line along every block edge in the cell's palette
colour (L2). Every line is filtered: widened to at least a pixel and dimmed in proportion, and dashes
fade to their average at distance. Proof: a low-altitude shot looking down a street to the horizon
shows no shimmer in a six-frame sequence with the camera moving 2 m per frame.

**M3. Plazas and block floors.** Plaza cells get a bright perspective grid with pulsing rings round the
centre (on `uBeat`); other blocks get a faint paving grid visible between buildings. Beyond the far
fade, where buildings have sunk away, add a sparse sparkle of "distant lights" inside blocks so the
plain still reads as city.

**M4. Wet reflections.** Project the fragment through `uReflMatrix`, sample `uReflTex` with a small
normal perturbation from scrolling noise (rougher on sidewalks, smoother in puddles), weight by a
Fresnel term and `uWet`, and add it. Puddles: low-frequency noise patches with near-mirror
reflection. When `uReflAmount` is 0, fall back to a fake: smear the adjacent block's palette colour
across the road as a soft glow. Proof: street-level screenshot with `layers=sky,ground,probe` showing
the sun and the boxes mirrored, upright alignment at the bases.

**M5. Street lamps.** Instanced posts along both sidewalks every 40 m (count scaled by tier density),
each a thin dark pole with a glowing head (L3 core, small) and an additive glow sprite; lamp colour
alternates by street between two palette entries. Also draw each lamp's pool of light on the ground
analytically in the ground shader (lamp positions are periodic, so the nearest lamp is a formula).
Lamps are placed with `sc_place` so they wrap and sink like everything else.

## 6. Validation and acceptance

- `npm run check:task -- T04` exits 0; a unit test checks the TypeScript mirror of the surface
  classifier against the constants (carriageway, sidewalk and block widths add up to `CELL`).
- Screenshots in `shots/T04/`: `top`, `high`, `street`, `canyon`, and the shimmer sequence.
- At most 3 draw calls in the main pass. `update` does no work.
- No console errors or shader warnings.

Human checks: H-T04-1, the wet look reads as wet rather than as noise.

## 7. Idempotence and recovery

Stateless.

## 8. Progress

- [ ] M1 grid and surfaces
- [ ] M2 lines in light
- [ ] M3 plazas and block floors
- [ ] M4 wet reflections
- [ ] M5 street lamps

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
