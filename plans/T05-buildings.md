---
id: T05-buildings
title: Neon towers
status: ready
depends_on: [T00, T01, T02]
owns: [src/layers/buildings/**, tests/unit/buildings/**, plans/T05-buildings.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-14
---

# T05: buildings

## 1. Purpose

Build the skyline. Thousands of towers whose dark faces carry grids of lit windows, whose edges are
drawn in neon, wrapped in light bands, fins and animated signs, with shop fronts blazing at street
level and crowns glowing on top. This layer is most of what the viewer sees, and it should look
bright, varied and unmistakably 1980s-future from a kilometre away and from ten metres.

## 2. Context and orientation

`architecture.md` §4.5, §5.1 to §5.5. The plan (`ctx.plan`, contract in `src/contracts/city.ts`) gives
every building as axis-aligned boxes in one `Float32Array`, `BOX_STRIDE` floats per box with the
offsets in `BOX`: centre x, base y, centre z, size, style (`BOX_STYLE`), two palette indices, a seed,
flags (`BOX_FLAG`: `roof`, `street`, `round`, `landmark`) and a building id. Roof lights are `roofLight`
sites in `ctx.plan.sites`.

All boxes are drawn as instances of one unit box. The vertex shader scales the unit box by the
instance size and places it with `sc_place(centre, local)`. The fragment shader works in metres on
each face: on a side face, `u` runs horizontally and `v` is height above the box base, so a window grid
is just `fract` of those, and the same shader serves a 15 m shop and a 900 m megatower.

## 3. Scope

Owns `src/layers/buildings/**`. Non-goals: the ground under buildings (T04), holograms and tickers
(T09), searchlights and lasers (T08).

## 4. Interfaces

Provides `createLayer()` with id `buildings`. Reflected (three layer 0). Consumes the plan's boxes and
`roofLight` sites, `uBeat`, `uPalette`, fog and the rest of the shared uniforms.

## 5. Plan of work

**M1. Instanced boxes.** Unit box geometry with normals; instance attributes packed from the plan
(position, size, a vec4 of style/colours/seed, flags). Flat L0 wall colour by style, fogged. Round
boxes (`BOX_FLAG.round`) use a second mesh with a unit cylinder and the same material. Proof: `top`
and `high` views match the probe.

**M2. Windows.** A window grid in metres (about 3 m wide, 3.6 m floors, varied per style): a hashed
share of windows lit, in warm white, cyan or the box's palette colours, some dimmer, with a slow
random on/off drift. Styles: punched windows; horizontal ribbon glazing; full curtain glass with a
vertical gradient and a faint reflection of the sky colour; vertical-strip towers. Lit windows are
L1, so a facade reads as lit without turning into one bloom blob. **Filtering:** when a window is
under about two pixels, fade to the facade's average emission; check with a moving-camera sequence.

**M3. Neon structure.** Glowing trim along every vertical edge and roof edge (L2, width filtered to a
pixel minimum), light bands every so many floors, vertical fins, a lit crown on `roof` boxes, and a
storefront band on `street` boxes: the bottom 5 to 8 m divided into shop bays, each a bright mixed
colour with a sign strip above. Megatowers (`landmark`) get bolder trim and a vertical "spine" of
light. Proof: `canyon` and `street` views.

**M4. Animated facades.** A share of faces carry big animated signs made from maths: scrolling
chevrons, equaliser bars driven by `uBeat`, expanding rings, wipes, checker shimmer, vertical "rain"
of light. Keep each one inside a framed panel so the facade still reads as a building. Use `uTime`;
these are cosmetic (§4.3).

**M5. Roofs.** Dark roof with a thin outline, small plant boxes hinted by pattern, helipad circles on
some; spires (`BOX_STYLE.spire`) as thin lit masts. Blinking red aviation lights at `roofLight` sites
as additive glow sprites on `RENDER_ORDER.sprites` (camera-facing quads, strobe pattern hashed per
site).

**M6. Distance.** From `high` the whole field must hold together: no moire, no flicker, the far
towers reduced to trim and averaged windows fading into fog.

## 6. Validation and acceptance

- `npm run check:task -- T05` exits 0. Unit test: the attribute packer writes one instance per plan
  box with the right fields.
- Screenshots in `shots/T05/` with `layers=sky,ground,buildings` (or without the others if they are
  not ready): `street`, `canyon`, `roof`, `high`, `mega`, `top`, and a 6-frame flight sequence along an
  avenue for shimmer.
- At most 4 draw calls in the main pass; `update` does no work.
- Light levels follow §5.2: the mean of a `high` screenshot stays well under clipping (the shot tool
  prints the clipped share; keep it under 5 percent before bloom-heavy T13 tuning).

Human checks: H-T05-1, variety: a viewer does not spot the same facade twice in one frame.

## 7. Idempotence and recovery

Stateless.

## 8. Progress

- [ ] M1 instanced boxes
- [ ] M2 windows
- [ ] M3 neon structure
- [ ] M4 animated facades
- [ ] M5 roofs
- [ ] M6 distance

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
