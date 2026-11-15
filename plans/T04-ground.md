---
id: T04-ground
title: Streets, plazas, wet reflections and street lamps
status: done
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

The ground is one large flat mesh centred under the camera, big enough to reach the far plane (a
disc of rings whose radius doubles; see the Decision log). Its fragment shader recovers tile
coordinates as `uCam.xz + relative.xz` and derives everything from them. Because the pattern is
periodic with the tile, the mesh needs no wrap of its own.

Files, as built:

- `src/layers/ground/layout.ts`: no three, no DOM. The tunable numbers (`GROUND`), the TypeScript
  mirror of the surface classifier (`surfaceAt`, `curbDistance`, `blockDistance`), the lamp layout
  (`buildLamps`, `lampHead`, `lampSpacing`) and the two meshes as plain arrays (`buildDisc`,
  `buildPost`).
- `src/layers/ground/shaders.ts`: the GLSL. Its `G_` defines are generated from `GROUND`, and the
  light levels are in `LIGHT`.
- `src/layers/ground/index.ts`: `createLayer()`. Three meshes: ground, lamp posts, lamp glows.
- `tests/unit/ground/layout.test.ts`: 13 tests.

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

Stateless. Every shot and check can be re-run. Screenshots are in `shots/T04/` (git-ignored).

## 8. Progress

- [x] 2026-11-14 M1 grid and surfaces. Per-cell curb and building-line distance fields; asphalt,
  sidewalk slabs, block floor. Proof: `shots/T04/top.png` and the unit test that puts every box of
  the city plan on block floor.
- [x] 2026-11-14 M2 lines in light. Lane dashes, edge lines, street double centre line, avenue
  median with lit edges and a tube of light, zebra crossings, stop bars on the approach side, neon
  curb in the cell colour with rounded corners. Proof: `shots/T04/shimmer_0..5.png` and the flicker
  measurement under Outcomes.
- [x] 2026-11-14 M3 plazas and block floors. Polished plaza floor, 8 m grid, rings every 12 m that
  flash as the wave of each beat passes, hub disc; faint 8 m floor grid in other blocks; far-field
  sparkle beyond the far fade.
- [x] 2026-11-14 M4 wet reflections. Five mip-blurred taps along the projected "up" direction, ripple
  noise, puddles, Fresnel; a fallback without the reflection pass, compiled as its own variant.
- [x] 2026-11-14 M5 street lamps. Posts (camera-following lattice), glow sprites (every lamp in the
  tile), analytic pools of light in the ground shader.
- [x] 2026-11-14 Acceptance run, evidence pasted under Outcomes. Nothing is left open.

## 9. Surprises and discoveries

- **The scratchpad folder is shared by every sibling agent.** I backed up `index.ts` there under a
  plain name for a temporary measurement; the beams agent wrote its own `index.ts.bak` over it a few
  seconds later, and my restore put the beams layer into `src/layers/ground/index.ts`. Evidence: the
  file began `// The beams layer (plan T08)`. I rewrote the file from this session and moved my
  scratch files to a `T04/` subfolder. `src/layers/beams/index.ts` was checked and was intact; I
  never wrote to it.
- **A heredoc fails in the Bash tool only when its apostrophes are unbalanced** (`lamp's`), not
  whenever one is present. Evidence: `unexpected EOF while looking for matching` on a file with a
  possessive in a comment; the same heredoc with paired quotes worked.
- **`patch` is a reserved word in this GLSL compiler.** A sibling layer hit
  `'patch' : Illegal use of reserved word` in a page I loaded; I had already renamed my own `patch`
  and `near` variables as a precaution. Not re-tested in my shader.
- **A page reload from a sibling's edit can hang `shot.mjs` in the middle of a sequence** (it sat for
  three minutes on frame 2). I now run sequences under `timeout 70` with a retry.
- **Sub-pixel lamp poles crawl.** With the camera moving 0.25 m per frame, the only flicker in a
  ground-only sequence was on the poles and the far glows, none on the ground. Poles are now
  thickened to 1.1 pixels and the far glow has a broader profile.
- **The rings pulse was invisible at first.** A ring 1.7 times brighter on the beat looked the same
  after tone mapping, because both were already near white. The rings now rest in the cell colour
  and flash towards white.
- **Lamp pools at 0.15 of the lamp colour turned whole streets orange.** The average pool is a third
  of the peak, several times the asphalt. Road pools are now 0.04.
- **The named `plaza` view is inside a building** at seed 1984 (see Outcomes, defects).

## 10. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-11-14 | The curb and the building line are signed distances to a rounded box per cell, not per-axis tests against the nearest grid line | One field gives the carriageway mask, the neon curb with rounded corners, the gutter and the spill of light; it is continuous across cell boundaries (unit-tested), so `fwidth` of it is safe |
| 2026-11-14 | A disc of 15 rings whose radius doubles (1,392 triangles), radius 1.75 x `CAMERA_FAR`, instead of one quad | Position interpolated across a 28 km triangle is good to millimetres at best, and a pixel at street level covers millimetres; the quad also ends short of the far plane in the frame corners |
| 2026-11-14 | Every pattern period divides `CELL`, and every lattice index is wrapped with integer arithmetic before hashing | Tile coordinates jump by `TILE` when the camera wraps; anything not exactly periodic would pop once per 6.4 km. Float `mod` can return the period itself on a GPU that multiplies by a reciprocal |
| 2026-11-14 | Each pattern is filtered against the pixel footprint of the axis it varies along, never the larger of the two | At street level a pixel is centimetres wide and tens of metres long; an isotropic filter would erase the lines of the street you stand in |
| 2026-11-14 | Lines thinner than a pixel dim as coverage^0.7, not coverage (`LIGHT.keep`) | Purpose says the ground must read as a circuit board from the air; energy-true lines were too faint at 2,400 m. The line is a pixel wide by then, so this cannot alias |
| 2026-11-14 | Lamp posts are one 640 m pattern repeated on a 4 x 4 lattice that follows the camera in whole pattern steps; glows are one sprite per lamp in the tile | The layout is exactly 640-periodic (unit-tested). 4,096 posts instead of 25,600 saves about 770,000 triangles per pass; a pole is under a pixel wide long before the lattice edge, and the fade (520 to 760 m) ends inside the guaranteed 960 m. Placement still goes through `sc_place` |
| 2026-11-14 | Lamp spacing is 40 m at density >= 0.8 and 80 m below | "Count scaled by tier density", kept to spacings that divide `CELL` so the pools in the ground shader stay a formula |
| 2026-11-14 | The ground draws at `renderOrder` opaque + 1 | Still inside the opaque band and before the sky (50), but after buildings and cars, so the depth test rejects hidden ground before this expensive shader runs |
| 2026-11-14 | The fallback without a reflection pass is a compile-time variant (`G_REFLECT` from `quality.reflectionScale`), and the mirrored variant still mixes by `uReflAmount` | Quality is fixed per page, so the `low` tier need not pay for five texture taps and two noise fields; `post=0` on a higher tier still works |
| 2026-11-14 | Zebra crossings are L1 (0.62), stop bars signal red L2, lane paint 1.5 | A crossing is a large area; section 5.2 keeps large areas at or under L1 |
| 2026-11-14 | Lamps are orange on even grid lines (which includes every avenue) and cyan on odd ones | Two palette entries alternating by street, as planned; warm against cool reads at a distance |

## 11. Contract change requests

None. Nothing in `src/contracts/**` needed to change.

## 12. Outcomes and retrospective

**Result against Purpose.** Delivered: dark wet asphalt that mirrors the towers and the sun, glowing
curbs and markings out to the horizon, plazas with a neon grid and beat-driven rings, rows of lamps
with pools and glows. From the air the ground reads as a grid of light; at street level it shines.

**What the layer draws.** Three draw calls in the main pass (ground, posts, glows); posts and glows
are also in the reflection pass, the ground is not (`SC_LAYER_NO_REFLECT`). `update` is empty.
Triangles per pass at `high`: 1,392 ground + 147,456 posts + 51,200 glows = 200,048; at `low`
100,720.

**Evidence** (all run on 2026-11-14, RTX 4070 SUPER, ANGLE D3D11):

```
npm run check:task -- T04
typecheck tsconfig.json: 0 error(s) in T04-ground, 0 elsewhere
typecheck tsconfig.node.json: 0 error(s) in T04-ground, 0 elsewhere
lint: ok (src/layers/ground, tests/unit/ground)
tests: ok (tests/unit/ground)   Test Files 1 passed (1)   Tests 13 passed (13)
PASS T04-ground

/dev/?layers=ground&view=street&t=5&post=0     draw calls 4 (3 of mine + the basic pipeline's quad)   triangles 200049
/dev/?layers=ground&view=high&t=5&q=high|medium|low and post=0: exit 0, no PAGE ERROR, no console warning
```

A gate that cannot fail is not evidence: with `lampSetback` negated and the curb moved 1 m, 5 of the
13 tests failed; restored, 13 pass.

Shimmer, measured rather than only viewed. Six frames, camera stepping 0.25 m, `post=0` (no grain),
lamps hidden for the measurement: per pixel, the path length of its value minus its net change.
Rows 500 to 560 (the ground from about 40 m to the horizon): mean 0.20, p99 4, p99.9 10 of 255. The
planned sequence (2 m per frame, six frames) is `shots/T04/shimmer_0..5.png`; its horizon strips side
by side are `shimmer_sheet.png`.

Seams. Two frames 2 mm apart differ in about 3,900 of 1,440,000 pixels by more than 8 (ordinary
sub-pixel motion of bright edges) whether the pair straddles the tile wrap (3,999), the post-lattice
snap (3,921) or neither (3,843). The same camera twice differs in 0 pixels.

**Screenshots viewed, and what they show** (`shots/T04/`):

- `top.png` (from 2,400 m, straight down, with buildings): the street grid between the blocks, no
  building over a road, plazas as dark squares with rings.
- `high.png`, `away_bld.png`, `high_miami.png` (far): the city on its grid, and beyond the far fade
  the plain continuing as faint streets and sparse points of light into the haze.
- `street.png`, `side_midnight.png`, `sidewalk.png`, `corner.png` (near): streaked reflections of the
  facades and the sun on the asphalt, mirror-sharp puddles, slab joints on the sidewalk, zebra
  crossing and red stop bar, lamps with glow.
- `canyon.png`, `low_bld.png`: the avenue between towers with median, dashes, crossings and puddles.
- `plaza_bld.png`, `plaza_floor.png`, `plaza_beat_pair.png`: the plaza grid and rings, the polished
  floor mirroring the towers, and the ring flash at two beat phases.
- `street_probe.png` (`layers=sky,ground,probe`): the sun and the boxes mirrored, reflections
  starting at the base of each wall. The probe's own ground z-fights with this one in patches, as
  expected.
- `street_low.png` (`q=low`): the fallback, streaks of block colour and sky, no reflection pass.
- `junction_top.png`: from 150 m, lane dividers between the lanes, stop bars on the keep-right
  approach side of each arm, lamps on the sidewalks.

**Not verified.**

- H-T04-1 is a human check. To my eye the street reads as wet, not as noise; nobody else has looked.
- Motion on a real display. Stills and step sequences only; no video.
- Frame time. The harness reported 144 fps at 1600x900 and at 2560x1440 with sky, ground and
  buildings, which is the headless cap, so it shows no slowdown but measures no headroom. The `low`
  variant was never run on integrated graphics.
- `uWet` below 1 and `uMotion` below 1: no harness parameter sets them. Read from the code only.
- The reflection under camera roll: the streak direction is derived from the mirror matrix so it
  should follow, but every shot had roll 0.
- Ground traffic (T06) on top of the markings, and how its light pools sort against the ground.
- Only seed 1984, one GPU, one browser.

**Defects seen in other tasks' paths** (not edited):

- `dev/views.ts` (T00): at seed 1984 the `plaza` view sits inside a tower of the neighbouring block
  (`shots/T04/plaza_a.png` without buildings is fine; with buildings the frame is a wall). I used
  `cam=3760,42,6112,0,-0.38` instead.
- Buildings (T05): with `layers=sky,ground,buildings` the console shows
  `warning X3577: value cannot be NaN, isnan() may not be necessary`. It does not appear with
  `layers=ground` or `layers=sky,ground`.

**For T06 and T13.** Lamp heads hang 1.7 m inside the curb at 7 m (streets) and 9 m (avenues). Lane
dividers are at 4 m (street) and 6 and 10 m (avenue) from the centre line; stop bars lie 0.7 to
1.25 m outside the cross road's building line; markings stop 1.6 m outside it. All light levels are
in `LIGHT` (`shaders.ts`) and all dimensions in `GROUND` (`layout.ts`).
