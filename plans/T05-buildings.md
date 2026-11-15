---
id: T05-buildings
title: Neon towers
status: done
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

- [x] 2026-11-14 M1 instanced boxes: `pack.ts`, `geometry.ts`, `index.ts`; box and cylinder meshes on one material.
- [x] 2026-11-14 M2 windows: grid per style, zones, lit rows, drift, rooms behind the glass, distance average.
- [x] 2026-11-14 M3 neon structure: trim, bands, fins, crowns, shop fronts, megatower spine.
- [x] 2026-11-14 M4 animated facades: eight LED patterns, framed panels, effect towers, ring signs.
- [x] 2026-11-14 M5 roofs: outline, plant, helipads, spires, aviation light sprites.
- [x] 2026-11-14 M6 distance: far views, the avenue flight and slow-step sequences are stable; tiers
  `low` and `medium`, the three moods and reduced motion all render without errors.
- [x] 2026-11-14 Acceptance list run; evidence in section 12. Nothing is left open in this plan.

## 9. Surprises and discoveries

- **One runaway pixel blanks the frame under MSAA.** The first run through the pipeline was black
  (`high`, buildings only: `mean 0.2/255 black 100.0%`) and, with a NaN guard added, a white blob
  (`mean 167.1/255 clipped 4.42%`), while `post=0` looked right. Cause [I]: on a silhouette pixel MSAA
  shades at the pixel centre, outside the triangle, so the interpolated face coordinate overshoots,
  by hundreds of metres on a face seen edge-on down an avenue; `exp(-distanceToEdge)` then returned
  about 1e30 and the bloom spread it. Clamping the face coordinate to the face fixed it (`mean
  46.9/255 clipped 0.00%`, with loud debug guards still in and never firing). The derivative is taken
  before the clamp. A final `clamp(col, 0, 12)` stays in as a guard. Any layer that feeds an
  interpolated coordinate to `exp` or a division has the same exposure.
- **`isnan()` draws a translator warning on D3D11:** `warning X3577: value cannot be NaN, isnan() may
  not be necessary`. It was only in the debug guard and is gone.
- **The palette spans a factor of four in luminance** (ultraviolet 0.20, cyan 0.70, from
  `PALETTE_HEX`), and the bloom threshold is luminance 0.82 (`src/post/index.ts`). A magenta or
  violet tube written at the same value as a cyan one does not bloom. See the decision on `sb_even`.
- **A room seen at a slant shows mostly its side walls.** The first interior mapping looked flat from
  the street, because along a street nearly every view of a window is oblique. Side walls now carry
  bands (offices) or shelves of goods (shops).
- **Sibling activity shows up in shots.** At 20:14 `src/layers/ground/index.ts` held the beams layer
  (same 5234 bytes as `src/layers/beams/index.ts`, header "The beams layer (plan T08)"), and the Vite
  error overlay covered two of my screenshots; by 20:20 the file was the ground layer again. One
  sequence run also hung until stopped and passed when re-run. Neither is in my paths; both resolved
  without me.
- **`engine.setReducedMotion` is the only thing that lowers `uMotion`;** the harness does not follow
  the browser's reduced-motion preference. Checked by calling it from a script.

## 10. Decision log

- 2026-11-14. **The vertex shader decides the facade; the fragment shader only draws it.** Every
  random choice (window size, lit share, colours, trim, panel, shop) is made per vertex from the box
  and building seeds and passed as `flat` varyings, 14 vectors in all (WebGL2 guarantees 15). Reason:
  it removes the per-style branching and most hashes from the per-pixel path, and one shader serves
  every style.
- 2026-11-14. **Own unit shapes instead of `BoxGeometry`.** `geometry.ts` builds a box and a
  28-sided cylinder with no bottom face and a `face` attribute (face id, u, v), so the shader gets
  metres on the face without deriving them from normals. Round and square boxes are two meshes on
  one material, as planned.
- 2026-11-14. **The packer adds two values the plan does not list:** a building seed
  (`hashUnit(plan.seed, building, 0x5b)`) so the boxes of one tower share a design, and the roof
  height of the whole building so gradients run up the whole stack. Both come from `ctx.plan` only.
- 2026-11-14. **`sb_even`: palette colours are divided by luminance^0.75 for tubes and signs, ^0.5
  for windows.** Reason: the luminance spread above. Consequence: light levels in this layer are
  set in luminance, not per channel. A violet tube has luminance about 1.3 but a blue channel of 4 to 7,
  above the 1.5 to 4 written for L2 in architecture.md 5.2. The shot tool reports `clipped 0.00%`
  in every view. T13 can retune `gain` in `shaders/vertex.ts` and the power in `sb_even`.
- 2026-11-14. **`sb_tube` keeps a floor of 0.3 under the sub-pixel dimming of `sc_line`.** Reason:
  M6 wants far towers "reduced to trim"; with pure energy conservation a 0.4 m tube at 2 km dims to a
  tenth and the outlines disappear. The line is still at least a pixel wide with soft edges, so it
  does not alias.
- 2026-11-14. **Signs are LED matrices.** Each pattern is evaluated at the centre of an LED, so only
  the LED grid needs filtering (`sc_pulse`), and the pattern fades to its average when LEDs go
  sub-pixel. Eight patterns: chevrons, equaliser, rings, wipes, checker, rain, striped sun, glyphs.
- 2026-11-14. **Added beyond the plan, inside its Purpose:** rooms behind lit windows and shops by
  interior mapping (no loop, skipped once a window is under about two pixels); "effect towers" whose
  whole facade plays one pattern with the windows as pixels (about 7 percent of shaft, glass and strip buildings); ring signs on round towers; neon shapes, goods and four kinds of sign on shop fronts.
- 2026-11-14. **Window averaging is per axis.** A wall seen at a slant along an avenue keeps its
  floor-by-floor brightness (the row average) while the columns are already blurred, instead of
  dropping straight to the facade average.
- 2026-11-14. **Unit tests use a hand-made plan, not `src/city`.** Reason: this plan's `reads` does
  not include `src/city`, and the packer's contract is `src/contracts/city.ts`.
- 2026-11-14. **Aviation lights are reflected** (three layer 0) and never smaller than 2.2 pixels,
  dimmed by fog amount since they are additive.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

**Result against Purpose.** The skyline is built: about 17,000 boxes drawn in three draw calls, with
window grids that differ by style (punched, curtain glass, ribbon, strip,
podium, megatower, kiosk), neon trim on every edge, light bands, fins, lit crowns, spires, shop
fronts along every street, animated signs, megatower spines and blinking aviation lights. `update`
is empty. It reads as a neon city from 10 m (rooms, shop goods, sign glyphs) and from 2 km (outlines,
zones of lit windows, signs), in all three moods.

**As built.**

| File | Holds |
|---|---|
| `src/layers/buildings/index.ts` | `createLayer()`: two box meshes on one material, the light sprites, dispose |
| `src/layers/buildings/pack.ts` | `packBoxes`, `packRoofLights`: plan to instance attributes, no three |
| `src/layers/buildings/geometry.ts` | `unitBox`, `unitCylinder` as plain arrays |
| `src/layers/buildings/shaders/shared.ts` | style and flag defines, the 14 varyings, `sb_even` |
| `src/layers/buildings/shaders/vertex.ts` | placement and the facade spec |
| `src/layers/buildings/shaders/fragment.ts` | walls, windows, glass, neon structure, `main` |
| `src/layers/buildings/shaders/panels.ts` | `sb_tube`, glyphs, the eight sign patterns |
| `src/layers/buildings/shaders/street.ts` | interior mapping, shop fronts |
| `src/layers/buildings/shaders/tops.ts` | roofs, crowns, spires |
| `src/layers/buildings/shaders/lights.ts` | aviation light sprites |
| `tests/unit/buildings/*.test.ts` | packer and shape tests |

**Evidence** (all from runs on 2026-11-14, RTX 4070 SUPER through ANGLE D3D11).

- `npm run check:task -- T05`: `typecheck ... 0 error(s) in T05-buildings`, `lint: ok`,
  `Tests 14 passed (14)`, `PASS T05-buildings`, exit 0.
- The tests can fail: with `sx`/`sz` swapped and the spire skip removed in the packer, and one
  triangle's winding reversed, `Tests 3 failed | 11 passed (14)`; restored, 14 passed.
- Acceptance screenshots, `layers=sky,ground,buildings&t=5`, all `clipped 0.00%`, no console errors
  or warnings printed: `street` mean 88.6, `canyon` 82.1, `roof` 84.8, `high` 78.8, `mega` 58.8,
  `top` 79.2. Flight along the avenue from `low`, 6 frames, 12 m and 0.1 s apart: means 83.4, 83.6,
  83.3, 85.2, 78.7, 81.2.
- Draw calls: with `post=0`, buildings alone report 4, the probe (two meshes) 3 and the sky alone 2,
  so the pipeline adds one and this layer draws 3.
- Shimmer, as the share of pixels whose luminance changes by more than 0.15 between frames (scratch
  script, full-resolution crops): `high`, far field, camera still 0.00%, 0.2 m steps 0.09%, 1.5 m
  steps 0.97%; `canyon` centre, 0.3 m steps 1.07%. It scales with the step, and the crops show the
  same windows lit in the same places.
- Equaliser: the same panel at t = 5.15 (on the beat) and 5.43 shows tall and short bars; with
  `setReducedMotion(true)` the frame-to-frame change falls from 1.69% to 0.60%.
- Cost, by a scratch script (60 frames back to back, then a read-back) at 2560 x 1440 on `high` tier:
  probe 1.4 ms per frame; buildings 3.3 and 4.5 ms in two runs of `canyon`, 3.1 ms in `high`,
  2.1 ms in `street`.

**What I looked at.** Near: `street`, `side`, two views from about 10 m (`near-a`, `near-b`), `low`.
Among the towers: `canyon`, `roof`, `sun`, `mega`, `plaza`. Far: `high`, `away`, downtown from 2 km
(`far`). From above: `top`, lowrise roofs from 110 m (`roofs-low`). Also `midnight` and `miami`,
tier `low`, and cropped pairs for the far field, the canyon, the equaliser and an aviation light.

**Gaps and what was not verified.**

- Only this GPU. Nothing here says how the fragment shader runs on a phone or an integrated GPU,
  or whether a `mediump` device shows artefacts (this desktop gives 23 bits for `mediump`).
- Frame time on a real display was not measured; the figures above are a regression signal only.
- The jump when `uTime` wraps at 4096 s was not looked at. It is cosmetic by section 4.3.
- `dispose()` and context loss were not exercised.
- H-T05-1 (variety) is a human check. In my own look at `sun`, `far` and `roofs-low` I did not spot
  a repeated facade; the operator should judge it in motion.
- Balance against the other layers (traffic, beams, holograms) belongs to T13. Window colours and
  trim gain were tuned with only the sky and the ground present.
- The round towers' ring signs have a joint where the unrolled wall meets itself; the frame line
  and one dark LED column mark it. Left as is.
