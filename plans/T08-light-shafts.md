---
id: T08-light-shafts
title: Shimmering shafts of light
status: ready
depends_on: [T00, T01, T02]
owns: [src/layers/beams/**, tests/unit/beams/**, plans/T08-light-shafts.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-14
---

# T08: light shafts

## 1. Purpose

Put light in the air itself. Searchlights sweep slowly across the sky from rooftops and plazas;
beacon pillars stand over the megatowers and plazas like columns reaching out of sight; fans of thin
lasers scissor above downtown. Every shaft shimmers, as if lighting drifting haze. These are the
vertical accents that make the skyline feel enormous.

## 2. Context and orientation

`architecture.md` §4.5, §5.2, §5.5. Emitters are sites in `ctx.plan.sites` (`Site` in
`src/contracts/city.ts`) of kinds `searchlight`, `pillar` and `laser`, each with a position, size
fields, yaw, a palette colour index and a seed. The plan guarantees the emitter position is clear of
buildings; a sweeping beam may still pass through a tower, and depth testing hides that part, which
is correct.

A beam is a quad that turns about its own axis to face the camera. `SC_COMMON` provides
`sc_axisBillboard` for this. The fragment shader gives it a soft cross-section, brightness that
falls off along its length, and shimmer. All beams are additive with depth test on and depth write
off, on `RENDER_ORDER.beams`. Additive light adds up fast: a beam seen end-on, or twenty overlapping
beams, can white out the frame, so individual beams are faint (peak around L1 to L2 at the core near
the emitter) and get their presence from bloom and length.

## 3. Scope

Owns `src/layers/beams/**`. Non-goals: sun shafts (a post effect, T02), hologram projector cones (T09),
vehicle headlights (T06, T07).

## 4. Interfaces

Provides `createLayer()` with id `beams`. On `SC_LAYER_NO_REFLECT` except pillars, which are reflected
(a pillar mirrored in a wet plaza is worth the cost). Consumes sites, `uTime`, `uLoop`, `uBeat`,
`uPalette`, fog.

## 5. Plan of work

**M1. One beam, done well.** A single instanced beam type: origin, direction, length, start and end
radius, colour, seed. Cross-section profile soft at the edges and brighter at the centre; brightness
falling along the length; the view-angle problem handled (when the camera looks nearly along the
axis the quad degenerates, so fade it and rely on the emitter flare). Shimmer: two scales of noise
scrolling along the beam at different speeds, plus rare bright motes. Proof: close and far
screenshots of a few test beams; a 6-frame time sequence shows the shimmer moving.

**M2. Searchlights.** At each `searchlight` site, one to three beams sweeping in slow arcs: direction
computed in the vertex shader from hashed sines of `uTime` (cosmetic motion, §4.3), tilted 20 to 60
degrees off vertical, 600 to 1,500 m long, widening. Add a small emitter flare sprite at the base.
Groups on plazas move in loose formation.

**M3. Pillars.** At each `pillar` site, a vertical shaft 1,500 to 3,000 m tall in the site's colour,
with bands of brightness rising slowly, a pulse on `uBeat`, a bright base flare and a soft halo.
Megatower pillars are the brightest things in the sky after the sun and should be visible across
the whole view.

**M4. Laser fans.** At each `laser` site, a fan of 5 to 9 hair-thin, very long, saturated lines
opening and closing and rotating slowly, with a minimum pixel width (filtered) and a faint sparkle
running along them.

**M5. Balance.** With all three kinds on, check `high` and `canyon`: shafts must read as shafts
against the sky and towers, not as fog. Reduce count or brightness until the skyline behind is still
clear. Count scales with `quality.density`.

## 6. Validation and acceptance

- `npm run check:task -- T08` exits 0. Unit test: the packer produces beams only from sites of the
  three kinds, with lengths and radii inside the stated ranges.
- Screenshots in `shots/T08/` with `layers=sky,ground,buildings,beams` where available: `high`,
  `canyon`, `plaza`, `mega`, and a time sequence.
- The shot tool's clipped-pixel share for `high` stays under 5 percent with beams on.
- At most 4 draw calls in the main pass; `update` does no work.

Human checks: H-T08-1, the shafts shimmer visibly in motion.

## 7. Idempotence and recovery

Stateless.

## 8. Progress

- [ ] M1 one beam, done well
- [ ] M2 searchlights
- [ ] M3 pillars
- [ ] M4 laser fans
- [ ] M5 balance

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
