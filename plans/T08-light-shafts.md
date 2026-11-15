---
id: T08-light-shafts
title: Shimmering shafts of light
status: done
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

The layer is three files:

- `src/layers/beams/pack.ts`: pure. Chooses which sites are lit (`chooseEmitters`), turns them into
  per-instance arrays (`packBeams`), and holds `beamDirection`, the CPU mirror of the GLSL that
  aims a beam. No three, so it is unit-tested in node.
- `src/layers/beams/shaders.ts`: one ribbon shader for all three kinds and one sprite shader for
  the flare at each emitter. `BEAM_DIR` is the GLSL that aims a beam.
- `src/layers/beams/index.ts`: `createLayer()`. Builds four meshes in `init`; `update` is empty.

## 3. Scope

Owns `src/layers/beams/**`. Non-goals: sun shafts (a post effect, T02), hologram projector cones (T09),
vehicle headlights (T06, T07).

## 4. Interfaces

Provides `createLayer()` with id `beams`. On `SC_LAYER_NO_REFLECT` except pillars, which are reflected
(a pillar mirrored in a wet plaza is worth the cost). Consumes sites, `uTime`, `uLoop`, `uBeat`,
`uMotion`, `uGlow`, `uPalette`, fog.

## 5. Plan of work

**M1. One beam, done well.** A single instanced beam type: origin, direction, length, start and end
radius, colour, seed. Cross-section profile soft at the edges and brighter at the centre; brightness
falling along the length; the view-angle problem handled (when the camera looks nearly along the
axis the quad degenerates, so fade it and rely on the emitter flare). Shimmer: two scales of noise
scrolling along the beam at different speeds, plus rare bright motes. Proof: close and far
screenshots of a few test beams; a 6-frame time sequence shows the shimmer moving.

**M2. Searchlights.** At each `searchlight` site, one to three beams sweeping in slow arcs: direction
computed in the vertex shader from sines of the loop phase (see the Decision log), tilted 20 to 60
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

Stateless. Every command above can be re-run. `shots/T08/` is git-ignored and can be deleted.

## 8. Progress

- [x] 2026-11-14 M1 one beam, done well. Ribbon of 16 rows, soft cone profile with a core, falloff
  along the length, end-on fade with a flare taking over, near-camera fade, shimmer and motes.
- [x] 2026-11-14 M2 searchlights. One to three beams per roof site (sway, crossing pair, turning V,
  turning tripod), plaza rings in formation, a flare that glints when a beam points at the viewer.
- [x] 2026-11-14 M3 pillars. Hot thread, core, glow and halo; rising bands; a pulse that climbs
  once a bar; a swell on the beat; base flare with halo and a horizontal streak. Reflected.
- [x] 2026-11-14 M4 laser fans. 5 to 9 lines per fan, never under 1.3 pixels half-width, opening,
  closing, turning and rolling, never below the horizon, with a running sparkle.
- [x] 2026-11-14 M5 balance. Emitters thinned by spacing; checked on `high`, `away`, `canyon`,
  `mega`, `roof`, `top`, `sun`, at all three tiers, in `midnight`, with `post=0` and with `layers=all`.
- [x] 2026-11-14 Acceptance run and evidence pasted below. Nothing is left to do in this plan.

## 9. Surprises and discoveries

- **A NaN from a multisampled ribbon blacked out half the frame.** With `layers=sky,ground,buildings,beams`,
  `view=away`, `q=high`, the shot tool reported `black 55.5%` every run, and 0.0% at `q=medium`,
  `q=low` and `post=0`. Bisecting inside the layer: no flares, still black; no ribbons, clean. Cause:
  with MSAA a varying is extrapolated to sample points outside its triangle, and on a ribbon seen
  nearly end-on the extrapolation is large, so the along-beam coordinate went far below 0, the
  interpolated radius went negative and `pow(r0 / r, 0.6)` returned NaN. Bloom smeared the one NaN
  pixel into a black block. Fix: clamp every interpolated input in the fragment shader (`x`, `t`,
  the thin-line factor, the view gain). After the clamp alone: `black 0.0%`. This is a general trap
  for any layer whose fragment shader feeds an interpolated value to `pow`, `sqrt`, `log` or a
  division, and it only shows at `q=high` under the pipeline.
- **The beams a page shows depend on which other layers are mounted.** The engine seeds a layer
  with `hashInts(seed, i + 1)`, where `i` counts the mounted layers, so `layers=probe,beams`,
  `layers=sky,probe,beams` and `layers=all` each light a different set of emitters. Evidence: with
  a random half of the laser sites lit, the same view and time showed two fans over downtown with
  `probe,beams` and a net of several once `sky` was added. It made a random keep-share impossible
  to balance by eye, and is why selection is now by spacing. Reported to the T00 owner; not a
  contract matter.
- **A random share of sites clumps.** 8 of the 21 laser sites of seed 1984 stand within about
  1,100 by 320 m downtown. With all of them lit the fans net over the sky; with a random half lit
  the result swung between sparse and netted depending on the seed.
- **Value noise sampled along a line shows its lattice.** Haze drawn as `sc_fbm(s / 90, ...)` read
  as evenly spaced beads up a pillar. Letting the second coordinate creep along the beam too
  (`s / 370`) crosses the lattice diagonally and the beads go.
- **Fine noise and motes are grain at distance.** An 8 m noise octave and 5 percent mote cells
  looked like television static on white beams a kilometre away. The fine octave was dropped and
  motes now fade before a dot is under about two pixels.
- **`dev/views.ts` `plaza` does not show the plaza.** The camera sits against a wall of the
  neighbouring block (`shots/T08/plaza.png` is mostly one facade). Not in my paths; reported. The
  plaza evidence here uses `cam=3760,10,6078,0,0.18` and `cam=3830,25,6090,0.66,0.5` instead.
- **A translator warning appears when `buildings` is mounted.** `warning X3577: value cannot be NaN,
  isnan() may not be necessary` at `(912,17-31)` of some program, seen with
  `layers=ground,buildings`, `sky,ground,buildings` and `buildings,beams`, never with `beams`,
  `sky,beams` or `sky,probe,beams`. It comes and goes between runs, so the attribution to T05 is
  likely, not proven. Not in my paths; reported.
- A heredoc containing an apostrophe failed in the Bash tool again, as `Agents.md` says [O].

## 10. Decision log

All dated 2026-11-14.

- **Fog only dims a beam.** Output is `colour * (1 - sc_fogAmount(p))`, not `sc_fog`. `sc_fog` mixes
  towards the fog colour, and on an additive quad that adds the fog colour over the whole quad; the
  background behind it already carries its own fog.
- **Four draw calls, two programs.** One ribbon material serves all three kinds (a `kind` value per
  instance picks the branch) and one sprite material serves the flares. Each is drawn twice: once
  for searchlights and lasers on `SC_LAYER_NO_REFLECT`, once for pillars on the default layer. A
  set's ribbon and flare geometries share the same instanced attribute objects.
- **Sweeps run on `uLoop`, not `uTime`.** The plan allowed `uTime` as cosmetic motion. Every rate
  is instead a whole number of cycles per loop, so a sweep is continuous when the loop wraps and a
  1,500 m beam does not jump once every 68 minutes. Shimmer, motes and sparkle do use `uTime`.
- **Searchlights are soft cones, not lines.** The first version (end radius 10 to 25 m, strong
  core) read as light sabres. End radius is now 10 to 64 m, the body carries most of the light, and
  brightness falls as the cone widens.
- **Emitters are chosen by spacing, not by share.** No two lit emitters of a kind stand closer than
  640 m (searchlights; a plaza ring counts as one), 240 m (plaza pillars) or 650 m (laser fans) at
  `high`; the spacing grows as `1 / sqrt(density)` on lower tiers. Megatower pillars are always lit.
  For seed 1984 that lights 94 of 206 searchlight sites (102 beams), 7 of 21 laser sites (51 beams)
  and 53 of 54 pillars. This is the M5 reduction, and it is the acceptance-relevant change: it was
  made so that the skyline stays clear, not to pass a threshold.
- **Plaza rings are placed before roof lights.** A ring of two to four beams turning in formation
  is the better picture, so rings get first claim on the spacing.
- **A beam fades out close to the camera** (between 1.5 and 6 radii plus 15 m). A ribbon is a poor
  stand-in for a volume from inside it and twists hard to keep facing the viewer; fading also means
  flying through a beam cannot white out the frame.
- **Laser fans stay above the horizon.** The centre line leans at most 45 degrees and the fan opens
  at most 1.2 rad, so no line points down into the streets.
- **Megatower pillars at intensity 1.3, plaza pillars at 0.65,** so the landmarks lead.
- **Flares sit on `RENDER_ORDER.sprites`,** the band the architecture names for glow sprites, and
  are lifted up to 8 m towards the viewer so a roof does not slice them.
- **`beamDirection` in TypeScript mirrors `bm_dir` in GLSL by hand.** The tests check the
  TypeScript one; nothing checks that the two agree except the screenshots.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

**Result against Purpose.** Delivered. Searchlights sweep from roofs and in rings from plazas,
pillars stand over every megatower and most plazas, and laser fans open and close over the denser
districts. All of it shimmers: long rays waver across each beam, haze drifts up it, motes glint
close up, bands and a once-a-bar pulse climb the pillars.

**Evidence** (all from runs in this session, RTX 4070 SUPER, ANGLE D3D11):

```
> npm run check:task -- T08
typecheck tsconfig.json: 0 error(s) in T08-light-shafts, 0 elsewhere
typecheck tsconfig.node.json: 0 error(s) in T08-light-shafts, 0 elsewhere
lint: ok (src/layers/beams, tests/unit/beams)
tests: ok (tests/unit/beams)
   Test Files  1 passed (1)
        Tests  19 passed (19)
PASS T08-light-shafts
```

- The tests can fail: four deliberate breaks in the packer (no length clamp, a wider tilt range, the
  spacing check off, a `ticker` site packed as a searchlight) failed 8 of the 19; restored, 19 pass.
- Counts for seed 1984 at density 1 (from the test): `sites {searchlight 206, pillar 54, laser 21}`,
  `used {searchlight 94, pillar 53, laser 7}`, `beams {searchlight 102, laser 51, pillar 53}`.
- Clipped share, `layers=sky,ground,buildings,beams`, `t=5`: `high` 0.00%, `away` 0.00%, `canyon`
  0.00%, `mega` 0.00%, `roof` 0.00%, `top` 0.00%, `sun` 0.00%; `high` at `q=low`, `q=medium`,
  `mood=midnight`, `mood=miami` and `post=0` 0.00%; `layers=all&view=high` 0.00%. Black share 0.0%
  in all of them.
- Draw calls: `sky,ground,buildings` 28; with `beams` 34. That is 4 in the main pass and 2 (pillar
  ribbons and pillar flares) in the reflection pass. `update` is an empty function.
- Motion, `view=mega`, 6 frames 0.4 s apart: mean difference between consecutive frames 3.2 to
  3.5 of 255 with 12 to 14% of pixels changed, against 1.3 and 2.5% for the same sequence without
  the layer.
- Reflection: at the plaza camera, moving the pillars to `SC_LAYER_NO_REFLECT` changed 7.3% of the
  pixels (mean 1.92 of 255); two runs of the unchanged layer differed by 0.00.
- Tile seam, `layers=sky,beams`: a 0.5 m camera step across x = 6400 changed the frame by 1.35 of
  255 (3.8% of pixels), the same as a 0.5 m step just before it (1.35, 3.8%).
- No console errors and no shader warnings in any run with `beams` alone or with `sky` and `probe`.

**What the screenshots show** (`shots/T08/`, opened and looked at):

- `high.png`, `all_high.png` (far): pillars as soft coloured columns over the skyline, the
  megatower pillars in view with white-hot flares, plaza rings as fans of white beams, two or three
  thin laser fans over downtown. Towers and the sun stay clear behind them.
- `away.png` (far, dark sky): the same against violet; this is the view that exposed the NaN.
- `mega.png`, `seq_0.png` to `seq_5.png`: beams from roof height; across the sequence the fans
  open and turn, the white beams move, and the bright pulse on the pillars climbs.
- `plaza_up.png`, `plaza_low.png` (near): a violet plaza pillar beside a megatower, a ring of white
  searchlights round it, its base flare glowing on the plaza floor. From 78 m, head-on against the
  lit megatower, the pillar is a soft veil rather than a column; from further off it reads as a shaft.
- `top.png` (above): beams radiate towards the viewer; nothing whites out.
- `roof.png`, `sun.png`: laser fans and pillars rising behind the nearer towers, searchlights in
  the gaps. `canyon.png`: the slit of sky between the towers happens to hold no beam in the final
  selection (an earlier selection put one there); nothing is drawn over the facades.
- `high_low.png`: far fewer beams, megatower pillars kept. `high_midnight.png`, `high_miami.png`:
  the beams hold up on a dark blue sky and on a pale orange one. `high_nopost.png`: without the
  pipeline the beams lose their glow but are intact. `high_medium.png` was shot (0.00% clipped)
  but not opened.

**Gaps and what was not verified.**

- H-T08-1 is open: nobody has watched it move. Stills and frame differences show that it changes;
  they do not show that the sweep is smooth or that the shimmer is pleasant at 60 Hz.
- Frame time. The shot tool reports a capped 144 fps with and without the layer. The fill cost of
  wide additive ribbons near the camera was not measured.
- Other GPUs, phones, `mediump`-limited devices, and reduced motion (`uMotion` below 1) were not run.
- `bm_dir` (GLSL) against `beamDirection` (TypeScript): agreement is by reading, not by test.
- The far fade was not looked at on its own; beams use `sc_place` with the emitter as anchor, and
  nothing odd showed at the horizon in `high` or `away`.
- Cross-layer balance with everything mounted is T13's; `all_high.png` is busy but unclipped.
