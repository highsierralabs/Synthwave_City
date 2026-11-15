---
id: T09-holograms
title: Floating holographic billboards
status: done
depends_on: [T00, T01, T02]
owns: [src/layers/holograms/**, tests/unit/holograms/**, plans/T09-holograms.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-15
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

**M7. Station billboards (revision, 2026-11-15).** The city gains five radio stations (the audio side
is built in `src/audio/**` and `src/app/**` by another task, not here). Each gets its own wide ad:
SUNSET FM 88.8 (outrun, unchanged, wide 3), OBSIDIAN 93.3 (darksynth), VELVET 97.1 (chillwave),
STARPORT 101.5 (spacesynth), PLAZA 104.3 (mallsoft). They read as one family (big frequency numerals
with an FM tag, a genre line, an ON AIR / LIVE badge or tuning dial) and differ in motif and layout.
The atlas has no free cell, so the four new ads replace the drawing functions of wide 0, 2, 5 and 6;
cell count, layout and `pack.ts` placement stay as they are. Optionally one station joins a ticker.
Proof: atlas dump at 1:1, each new ad cropped and looked at; in-city shots of new station panels under
two moods; `npm run check:task -- T09` green.

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

- [x] M1 atlas (2026-11-14). `layout.ts` (pure cell layout), `atlas.ts` (16 wide ads, 8 tall ads,
  4 ticker strips, drawn as three inks), dump behind `?holoAtlas=1|top|bottom|raw`. Looked at
  `shots/T09/atlas_top.png` and `atlas_bottom.png`.
- [x] M2 panels (2026-11-14). `pack.ts` + `PANEL_VERT/FRAG` in `shaders.ts`: scanlines, rolling bar,
  flicker, glitch bands, fringe, frame, brackets, grazing and near fades.
- [x] M3 presentation (2026-11-14). Bob, sway, lean; wipe between two ads on 55% of panels; projector
  lamp and fan of light under every panel, in the same draw call.
- [x] M4 wire holograms (2026-11-14). `wire.ts` bakes six shapes into one mesh; `WIRE_VERT/FRAG`.
- [x] M5 tickers (2026-11-14). `TICKER_VERT/FRAG`: text runs round the ring, LED dots near, halo far.
- [x] M6 balance and distance (2026-11-14). Gains set against the real `sky`, `ground` and
  `buildings` layers; far lift for panels; scanline fade tightened; tiers `low`/`medium` and moods
  `midnight`/`miami` looked at; magnified three-frame shimmer check.
- [x] Unit tests (2026-11-14): `tests/unit/holograms/{layout,pack,wire}.test.ts`, 26 tests, each
  group shown failing once under a deliberate mutation before passing.
- [x] Acceptance run and Outcomes written (2026-11-14). Nothing is left open in this plan's paths.
- [x] M7 station billboards (2026-11-15). In `atlas.ts`: wide 0 = OBSIDIAN 93.3, wide 2 = VELVET
  97.1, wide 5 = STARPORT 101.5, wide 6 = PLAZA 104.3; SUNSET FM (wide 3) untouched. New helpers
  `dial` (88-108 tuning scale with a needle), `frequency` (numerals plus FM tag), `tear` (shifts a
  drawn slice sideways), `shard`, `column`, `checkerFloor`; `type()`'s `grad` now takes any number
  of evenly spaced stops (used for STARPORT's chrome). News strip 1 gains "OBSIDIAN 93.3 FM". The
  unused `COIN` sprite (only ARCADE PALACE's wide ad used it) was removed for lint. Looked at the
  1:1 dump four times (`shots/T09/atlas_stations.png`, crops `atlas_stations_{obsidian,velvet,
  starport,plaza,sunset}.png` at 2x) and fixed: VELVET's crescent leaked the inner circle outside the
  moon (clip rebuilt as outer circle, then rect minus bite) and its sky was a hard-edged box (now a
  radial glow); OBSIDIAN's crystal read as a pink gem (facets moved to dark inks); PLAZA's fountain
  read as a ghost and was replaced by a potted palm; light type on VELVET and PLAZA raised from 300
  to 400 weight after the in-city shots showed it faint.
- [x] M7 in the city (2026-11-15), `layers=sky,ground,buildings,holograms&t=12`, cameras placed 90 m
  in front of non-switching panels found with `packPanels(createCityPlan(1984).sites, ..., 1)`:
  `city_starport.png` (cam 3635,176,3690,0,0), `city_velvet.png` (3145,57,919,3.1416,0),
  `city_obsidian.png` (4720,261,2734,0,0), `city_plaza.png` (4275,57,1012,0,0); moods
  `city_velvet_midnight.png`, `city_starport_midnight.png`, `city_plaza_miami.png`; far view
  `city_starport_300m.png` (+ `_zoom` 2x crop). All four ads legible; no console error or shader
  warning in any shot. The probe test used to find the panels was deleted afterwards.
- [x] M7 gates (2026-11-15): `npm run check:task -- T09` PASS (26 tests), `npm run plans:check` OK.

## 9. Surprises and discoveries

- **`pow` of an extrapolated varying blacked out the whole frame.** The first `canyon` shot with the
  pipeline on was one large black rectangle, and `high` was black edge to edge; the same URLs with
  `post=0` were fine. Cause: `pow(1.0 - t, 2.2)` in the projector fan, with `t` a 0..1 varying. Under
  MSAA a varying can be extrapolated past the triangle, the base goes negative, `pow` returns NaN, and
  bloom spreads one NaN pixel over the frame. Fixed by clamping `t` (both the fan and the wire cone).
  An 8-bit canvas hides this, so `post=0` is not a safe place to judge an additive shader.
- **Timing a GPU-backed 2D canvas measures nothing.** `performance.now()` round `drawAtlas` read 4 ms
  on one load and 69 ms on another, because Chromium records the calls and rasterises later. Forcing
  the work with a one-pixel `getImageData` gave 122 to 550 ms over five loads (the 550 was the first
  page of a fresh browser). With `getContext('2d', { willReadFrequently: true })` the canvas stays on
  the CPU, drawing is synchronous, and six loads gave 63 to 75 ms, the first included.
- **Additive panels lose to lit megatower screens.** A panel or ticker in front of one of T05's big
  facade screens (themselves L1 to L2 over a large area) washes out: `shots/T09/seq_4.png`,
  `ticker_a.png`. Against sky, roofs or ordinary facades the same panel reads well. Ticker text is
  pushed towards white-hot for this reason; panels are not, because that whites them out over sky.
- **Few panel sites downtown.** Of 817 `holoPanel` sites, 560 are roof billboards, which the plan
  places only on buildings up to 130 m. A 1.6 km square round the `downtown` landmark holds 30 panels
  (11.7 per km2 against 19.9 overall), 9 of them above y = 200. So `canyon`, `roof` and `high` each
  show only one to three panels, while views over lowrise (`at300.png`, `lowrise.png`) are full of
  them. The sites are T01's; see Outcomes.
- **The `plaza` view looks at a wall.** `dev/views.ts` puts that camera 150 m diagonally from the
  plaza at y = 55, which is beside a tower in the next block (`shots/T09/plaza.png`). The plaza
  evidence here uses explicit cameras instead (`plaza_above.png`, `w_*.png`).
- **Sibling saves reload the page mid-capture.** `shot.mjs` sequences failed twice with "Execution
  context was destroyed" or "the page kept reloading", and a syntax error in `shots/T10/harness.js`
  put Vite's error overlay across two of this task's screenshots. Retrying was enough.
- **`holoObject` sites and the ground's plaza rings are not concentric.** In
  `shots/T09/disc_with.png` the projector ring, which sits at the site position, is about 4 m from
  the centre of T04's plaza rings. Inferred cause, not checked in T04's code: the site is at the
  cell centre and the plaza art at the block centre, which differ when one side is an avenue.

- **(2026-11-15) An evenodd clip of two overlapping circles is not a crescent.** VELVET's first moon
  showed a filled sliver of the bite circle outside the moon, because evenodd fills every region
  covered once, including the bite's part outside the disc (`atlas_stations` iterations, first
  dump). Clipping to the disc first, then to a rectangle minus the bite, fixed it.
- **(2026-11-15) Light weights fade on a panel.** Weight-300 type that was crisp in the 1:1 dump
  ("velvet", "P L A Z A") was faint on a busy facade backdrop in `city_velvet.png` and
  `city_plaza.png`; 400 reads. The hologram treatment (scanlines, translucency) eats thin strokes.
- **(2026-11-15) The station panels looked the same under `sunset`, `midnight` and `miami`.** Only the
  sky and fog changed between `city_velvet.png` / `city_velvet_midnight.png` and `city_plaza.png` /
  `city_plaza_miami.png`. Not investigated (cause unknown: the moods may share those palette entries);
  it does not depend on this revision, which changed only canvas drawing.

## 10. Decision log

- **(2026-11-15) Four wide slots replaced, not added.** All 28 atlas cells are in use and the layout,
  cell count and round-robin in `pack.ts` are tested and tuned; adding cells would mean a new layout,
  smaller cells or a bigger atlas. NOVA COLA (0), KIRO NOODLE BAR (2), ARCADE PALACE (5) and LUX
  CAPSULE HOTEL (6) were chosen (as directed for this revision) because each still has a tall banner, and NOVA
  COLA and KIRO also run on ticker strips, so no brand leaves the city. Order: OBSIDIAN 0, VELVET 2,
  STARPORT 5, PLAZA 6, in frequency order, so the order has no other meaning.
- **(2026-11-15) Family look.** Every station has heavy italic frequency numerals with a small italic
  FM tag (`frequency`), a tracked genre line and a badge or dial; motif and layout differ: OBSIDIAN
  is a black crystal with torn video lines, VELVET a moon over water with light lowercase type and
  upright numerals, STARPORT a star at the vanishing point of lasers with chrome type, PLAZA a
  symmetric colonnade over a chequered floor with wide-spaced letters. Large fills use the dim inks
  (A3, B3, A2) per the bloom notes; white-hot is kept to edges, small type and star cores.
- **(2026-11-15) One ticker mention.** "OBSIDIAN 93.3 FM" was appended to news strip 1; the strip is
  scaled to fit, so the other items are squeezed about 20% sideways and still read in the dump.

All 2026-11-14 below.

- **The atlas holds inks, not colours.** Red is the panel's first palette colour, green its second,
  blue white-hot; the shader mixes them with `uPalette`. The plan said to bake the colours in. Reason:
  one advert then appears in many colourways (24 ads look like far more), and a mood that re-tints
  the palette re-tints the billboards, which architecture.md 5.1 asks of every layer. The dump
  re-colours the inks so it can still be reviewed by eye.
- **Ads read from both sides.** The panel's u is flipped for a viewer behind it. The plan allows a
  mirrored back; half of all panels would then be mirrored from any one direction, and H-T09-1 is
  that the ads are fun to read. The back is dimmed to 82% so the two sides still differ.
- **Fog dims holograms; it is not mixed in.** Agents.md says to run every colour through `sc_fog`.
  For an additive surface that adds the fog colour on top of an already fogged background, and far
  panels become pale rectangles. The shaders multiply by `1 - sc_fogAmount` instead.
- **Three draw calls.** Image, projector fan and lamp are three quads of one instanced geometry; all
  wire solids, their glow sprites, cones and floor rings are one baked mesh; tickers are one instanced
  geometry. Measured: 4 calls with `layers=holograms&post=0` against 1 with no layers.
- **Layout: 16 wide (512 x 256), 8 tall (256 x 512), 4 strips (2048 x 128).** The plan's sites come in
  two shapes only: 678 with aspect 1.6 to 2.6 and 138 with aspect under 0.8. An ad keeps its shape
  inside its panel, stretched by at most 12% and letterboxed beyond that.
- **Six wire shapes, not five:** icosphere, torus, globe with an orbiting ring, banded pyramid with a
  floating capstone, ring stack, gyroscope. Every object also gets a glow sprite, a cone of light
  from the plaza floor and a ring on the floor.
- **Tickers draw a quad twice the site's band height.** The text band is exactly the site's `h`; the
  rest is a halo that fades to nothing, so a 9 m band on a 1000 m tower is still visible from afar.
- **Panels are lifted with distance** (image up to 1.7x, veil up to 5x, between 150 m and 1500 m), so
  a far panel is a card of colour rather than a faint outline.
- **Scanlines are gone by two pixels per line**, earlier than `sc_detail` would fade them: the box
  filter alone still beats against the pixel grid near that size.
- **Density.** Panels are thinned by a hash against `quality.density`; panels 80 m or wider always
  stay. Tickers never go below 0.6 and wire solids never below 0.5, since there are few of each.
- **The atlas canvas is CPU-backed** (`willReadFrequently`), for the reason given under Surprises.
- **Names.** The plan's examples were kept except ZENITH MOTORS, which became ZEPHYRA MOTORS; PULSAR,
  OKO, REDLINE and "CHANNEL 5" were replaced during the work by KILOVOLT, OKU, CRIMSON and "CHANNEL
  404" to move away from names that exist. All names are invented, but none was searched against a
  trademark register.
- **Glitches run about 6% of the time per panel** (one sixth of a second each); 10% read as broken
  rather than occasional.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

**Result.** The layer `holograms` exists and does what Purpose asks: translucent ad panels with a
frame, brackets, scanlines, a rolling bar, flicker, glitch bands, fringing and wipes float over
roofs, across streets and beside megatowers, each over its own projector; six kinds of wireframe
solid turn over the plazas; text runs round the megatowers. The camera can fly through a panel.

**Evidence** (all from runs in this session, 2026-11-14, RTX 4070 SUPER through ANGLE D3D11):

```
> npm run check:task -- T09
typecheck tsconfig.json: 0 error(s) in T09-holograms, 0 elsewhere
typecheck tsconfig.node.json: 0 error(s) in T09-holograms, 0 elsewhere
lint: ok (src/layers/holograms, tests/unit/holograms)
tests: ok (tests/unit/holograms)
   Test Files  3 passed (3)
        Tests  26 passed (26)
PASS T09-holograms
```

- Mutation runs: overlapping tall cells failed `has no two cells overlapping`; dropping the landmark
  rule failed two pack tests; dropping every 50th panel failed four; drawing quad diagonals failed
  `never draws the diagonal of a quad`. Each was reverted and the suite re-run green.
- Draw calls: `layers=holograms&post=0` reports 4, `layers=none&post=0` reports 1, so 3 in the main
  pass (budget 6). `update` is empty.
- Atlas time, logged once per load as `holograms: ad atlas drawn in N ms`: 75, 67, 65, 65, 65, 63 ms
  over six loads with all four layers mounted (budget 300 ms).
- `layers=holograms` alone prints no console error and no shader warning.

Screenshots in `shots/T09/`, with `layers=sky,ground,buildings,holograms` unless noted, and what was
seen in each:

| File | What it shows |
|---|---|
| `atlas_top.png`, `atlas_bottom.png` | The dump: 16 wide ads, 8 tall ads, 4 strips; laid out, legible, no cell bleeding into another |
| `front30.png`, `behind30.png` | 30 m in front of and behind a 34 m avenue panel (ZEPHYRA MOTORS): frame, brackets, scanlines, lamp and fan; the text reads correctly from both sides; city visible through it |
| `near45.png`, `fly_0.png` to `fly_4.png` | A 90 m panel from 45 m down to 7 m behind it: a wash of light, not a white rectangle; clipped pixels 0.26% at 45 m |
| `at300.png` | Panels about 300 m off: GRAVBALL FINALS and LUX CAPSULE HOTEL legible, a dozen smaller cards in the sky |
| `lowrise.png`, `tele_0.png` | Above lowrise: panels as cards of coloured light across the roofs; wordmarks legible in the telephoto |
| `canyon.png`, `roof.png`, `high.png` | Downtown: one to three panels each (see Surprises), tickers as thin bands on the megatowers |
| `mega.png`, `ticker_b.png`, `ticker_near.png`, `ticker_far.png` | Ticker rings: text continuous round the corner, LED dots close up, a line of light far away; NOVA COLA beside the tower |
| `plaza_above.png`, `w_torus.png`, `w_globe.png`, `w_pyramid.png`, `w_rings.png`, `w_gyro.png` | All six wire solids, with cone and floor ring; `disc_with.png` shows the torus mirrored in the wet plaza |
| `tall_front.png`, `street.png` | A tall banner close up; from the street, a banner across the road and a billboard over a low roof |
| `wipe_0.png` to `wipe_4.png` | One ad wiping over another with a bright torn edge |
| `zoom_0.png` to `zoom_2.png` | The rendered frame at 4x, three steps of camera and time: no scanline moire on mid-distance panels |
| `lowrise_low.png`, `lowrise_medium_midnight.png`, `lowrise_miami.png` | Fewer holograms at `low`; palette follows the mood |
| `only.png` | Holograms alone on black |

**Gaps and things for other tasks.**

- Downtown is thin on holograms because the plan puts few sites there. Raising the avenue and street
  chances in `src/city/sites.ts` (0.12 and 0.055 today) or allowing roof billboards above 130 m would
  fix it; this layer draws one instance per site and cannot add any.
- Panels and tickers in front of megatower facade screens wash out. That is a balance question
  between T05 and this layer for T13; the usual fix is to dim large facade screens, not to brighten
  additive panels further.
- The `plaza` view in `dev/views.ts` and the 4 m offset between plaza art and `holoObject` sites, both
  described under Surprises.

**Not verified.**

- H-T09-1 and H-T09-2: whether the ads are fun, and how the text renders with another machine's
  fonts. Only Chromium on this Windows machine was seen.
- Frame time. Every shot reported 144 fps, which is the headless cap, not a measurement; the cost of
  several hundred large additive quads on a weaker GPU is unknown.
- Shimmer in continuous motion. The check was three magnified frames and a few time sequences, not
  video.
- `uMotion` below 1, `dispose()`, a lost and restored WebGL context, and the mood cross-fade were not
  exercised. `medium` was seen only in `midnight`, `miami` only at `high`.
- The names were not checked against any trademark register.

**Revision M7, station billboards (2026-11-15).** The wide atlas now carries all five radio stations:
OBSIDIAN 93.3 (wide 0), VELVET 97.1 (wide 2), SUNSET FM 88.8 (wide 3, unchanged), STARPORT 101.5
(wide 5), PLAZA 104.3 (wide 6), plus "OBSIDIAN 93.3 FM" on news strip 1. Layout, cell count and
`pack.ts` are unchanged; NOVA COLA, KIRO, ARCADE and HOTEL remain on their tall banners and tickers.

```
> npm run check:task -- T09
typecheck tsconfig.json: 0 error(s) in T09-holograms, 0 elsewhere
typecheck tsconfig.node.json: 0 error(s) in T09-holograms, 0 elsewhere
lint: ok (src/layers/holograms, tests/unit/holograms)
tests: ok (tests/unit/holograms)
   Test Files  3 passed (3)
        Tests  26 passed (26)
PASS T09-holograms
> npm run plans:check
OK
```

Evidence: `shots/T09/atlas_stations.png` (1:1 dump; the overlay caption read "drawn in 80 ms" on one
load, within the 300 ms budget) and its 2x crops; `city_{starport,velvet,obsidian,plaza}.png`,
`city_velvet_midnight.png`, `city_starport_midnight.png`, `city_plaza_miami.png`,
`city_starport_300m.png`. No new unit test: the change is drawing only, which the node test
environment cannot run; the existing layout and pack tests still pass.

Not verified for M7: H-T09-1/2 for the new ads (fun, and fonts on another machine; weight-300/400
type in particular depends on the system font having those weights); the named harness views
(`plaza`, `canyon`, `mega`) were not used because explicit cameras framed the panels directly;
`low`/`medium` tiers, where density thinning may drop some of these panels; the stations' audio
side, which is another task's.
