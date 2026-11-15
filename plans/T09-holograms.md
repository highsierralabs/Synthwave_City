---
id: T09-holograms
title: Floating holographic billboards
status: ready
depends_on: [T00, T01, T02]
owns: [src/layers/holograms/**, tests/unit/holograms/**, plans/T09-holograms.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-14
---

# T09: holograms

## 1. Purpose

Hang advertising in the sky. Huge translucent panels float between the towers and over the roofs,
showing loud invented ads that flicker, scan and glitch the way a projected image would; giant
wireframe shapes turn slowly over the plazas; bands of scrolling text circle the megatowers. The
viewer should be able to fly straight through one.

## 2. Context and orientation

`architecture.md` §4.5, §5.1, §5.2, §5.5, and "Canvas 2D atlases" in Agents.md. Sites come from
`ctx.plan.sites` (`Site` in `src/contracts/city.ts`):

- `holoPanel`: centre position, `w` by `h` metres, `yaw` (the way it faces), colour index, seed.
- `holoObject`: centre position, `w` as radius.
- `ticker`: centre of a rectangular ring round a tower at height `y`, half-extents `w` and `d`, band
  height `h`.

The plan guarantees these volumes are clear of buildings. Holograms are light, not objects: additive,
depth test on, depth write off, visible from both sides (mirrored from behind is fine and reads as
right for a hologram), on `RENDER_ORDER.holograms`. Nothing collides with them.

There are no image files (R2). Ad content is drawn with Canvas 2D into one atlas texture during
`init`, then animated by the shader.

## 3. Scope

Owns `src/layers/holograms/**`. Non-goals: signs that are part of a facade (T05), beams (T08) apart
from each panel's own small projector cone.

## 4. Interfaces

Provides `createLayer()` with id `holograms`. Reflected (three layer 0): a billboard mirrored in the
wet street is part of the look. Consumes sites, `uTime`, `uBeat`, `uPalette`, fog.

## 5. Plan of work

**M1. The atlas.** A 2048x2048 canvas divided into 16 or more panels in a few aspect ratios. Each ad
is built from a small set of generators so they look designed rather than random: bold word marks in
heavy italic or wide-tracked sans, sun-and-grid motifs, chevrons, palm and skyline silhouettes drawn
from paths, gradient bars, price tags, "ON AIR", arrows, concentric shapes. Invented names only (for
example NOVA COLA, HYPERLINE, KIRO NOODLE BAR, SUNSET FM 88.8, ZENITH MOTORS, ARCADE PALACE, LUX
CAPSULE HOTEL, ORBIT AIRLINES); no real brand, logo or person. Draw white-hot on transparent black
with the panel's colours baked in, since the result is added as light. Proof: dump the atlas to the
harness page behind a URL flag, screenshot it, and look.

**M2. Panels.** Instanced quads at `holoPanel` sites sampling their atlas cell. Hologram treatment in
the shader: horizontal scanlines tied to screen space or panel space (whichever does not shimmer at
distance; filter them), a slow rolling brightness bar, flicker, occasional glitch bands that shift a
strip sideways, red/cyan fringe at the edges, a brighter frame line, slight transparency so towers
show through, and fading at grazing angles. Content L2 on average with small L3 highlights; a panel
must stay readable through bloom. Proof: `canyon` and `roof` screenshots; a panel legible at 300 m
and not a white rectangle at 50 m.

**M3. Presentation.** Each panel bobs a metre or two and sways slightly; some switch between two
atlas cells with a wipe every 10 to 20 s; a small emitter device with a faint cone of light sits
under or beside it so the image reads as projected. Corner brackets or a thin frame.

**M4. Wire holograms.** At `holoObject` sites, large rotating wireframe solids (icosahedron, torus,
globe with latitude and longitude lines, pyramid, a stack of rings), built as meshes whose shader
draws edges from barycentric or parametric coordinates with filtered line width, with a scanline
sweep and a soft inner glow. One instanced draw per shape, or fewer.

**M5. Tickers.** At `ticker` sites, a ring band round the tower with text and symbols scrolling round
it, sampled from a strip of the atlas; brightness pulsing gently on `uBeat`.

**M6. Balance and distance.** From `high`, panels should read as coloured cards of light scattered
through the skyline. Check the far view for moire from scanlines and fix by filtering.

## 6. Validation and acceptance

- `npm run check:task -- T09` exits 0. Unit test: the layout of atlas cells (no overlap, all inside
  the canvas) and the packer (one instance per site of each kind).
- Screenshots in `shots/T09/` with `layers=sky,ground,buildings,holograms` where available: the atlas
  dump, `canyon`, `roof`, `plaza`, `mega`, `high`, a camera 30 m in front of a panel, and one behind it.
- At most 6 draw calls in the main pass; `update` does no work, or only allocation-free work.
- Atlas generation takes under 300 ms (log it once).

Human checks: H-T09-1, the ads are fun to read; H-T09-2, text renders acceptably with the fonts on
another machine.

## 7. Idempotence and recovery

Stateless. The atlas is rebuilt on every page load.

## 8. Progress

- [ ] M1 atlas
- [ ] M2 panels
- [ ] M3 presentation
- [ ] M4 wire holograms
- [ ] M5 tickers
- [ ] M6 balance and distance

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
