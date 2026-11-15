---
id: T07-air-traffic
title: Flying vehicles
status: ready
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

- [ ] M1 craft in lanes
- [ ] M2 engines and running lights
- [ ] M3 trails
- [ ] M4 hero ships
- [ ] M5 near passes

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
