---
id: T03-sky
title: Synthwave sky
status: done
depends_on: [T00, T01, T02]
owns: [src/layers/sky/**, tests/unit/sky/**, plans/T03-sky.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, plans/README.md]
updated: 2026-11-14
---

# T03: sky

## 1. Purpose

Put the city under the sky everyone pictures when they hear "synthwave": deep indigo overhead fading
through violet and magenta to a hot horizon, a huge striped sun sitting on that horizon, stars above,
and a ridge of glowing wireframe mountains in front of the sun. From any view, the far city should
dissolve into this sky with no visible edge.

## 2. Context and orientation

`architecture.md` §5.1 to §5.5 and §5.7. The layer contract is `src/contracts/layer.ts`; the shared
GLSL is `SC_COMMON` in `src/contracts/glsl.ts`. Sky colours, sun direction and sun colours come from
the shared uniforms, which the engine eases between moods, so this layer hard-codes no colour that a
mood should change.

The sky is drawn at the far plane after the opaque geometry (`RENDER_ORDER.sky`), so it costs only the
pixels the city does not cover. Because the camera only rotates (§4.1), the dome is camera-centred: use
`mat3(viewMatrix)` on a unit direction and set `gl_Position.z = gl_Position.w`.

As built, the layer is three files in `src/layers/sky/`:

- `params.ts`: every tunable, plus `skyParamProblems()`, which names anything that would show as a
  seam or a jump (a ridge that does not close, a scroll that is not loop-periodic).
- `shaders.ts`: the GLSL, generated from `params.ts`. One function per mountain range is generated,
  so its row count is a compile-time loop bound.
- `index.ts`: `createLayer()`: one cube mesh, one `ShaderMaterial`, an empty `update`.

## 3. Scope

Owns `src/layers/sky/**`. Non-goals: fog on geometry (that is `sc_fog`, already in the contract), the
sun-shaft post effect (T02), weather.

## 4. Interfaces

Provides `createLayer()` returning a `Layer` with id `sky`. Consumes shared uniforms only. It is
reflected (stays on three layer 0), so the wet streets pick up the sun and gradient.

## 5. Plan of work

**M1. Gradient and horizon.** Three-stop vertical gradient from `uSkyTop`, `uSkyMid`, `uSkyHorizon`,
blended into `sc_fogColor(dir)` in a band just above the horizon so fogged geometry and sky meet at
the same colour in every direction. Below the horizon, continue the fog colour (the ground covers it
anyway). Proof: with `layers=sky,probe`, distant probe boxes vanish into the horizon band with no
outline, looking both towards and away from the sun.

**M2. The sun.** A disc about 9 degrees in radius, its centre a little above the horizon in direction
`uSunDir`: vertical gradient from `uSunTop` to `uSunBottom`, horizontal cut-out stripes that get
thicker towards the bottom and scroll slowly downwards, antialiased edges, and a wide soft halo. The
disc is L3 at its top, so it blooms. Proof: screenshot towards the sun; stripes are crisp, edge is
smooth, no banding in the halo (check a contrast-stretched crop).

**M3. Stars.** Hashed points on a direction grid, a few brightness classes, gentle twinkle, a handful
of large four-point sparkles, a faint band of denser stars. Amount scales with `uStars`; they fade
towards the horizon and inside the sun's halo. Stars must not crawl when the camera turns: derive them
from the direction, with a cell size chosen against pixel footprint. Proof: two shots a tiny yaw apart
show the same stars shifted, not reshuffled.

**M4. Mountains.** Two or three layered ridge silhouettes around the whole horizon, tallest near the
sun, filled dark with a glowing wireframe (ridge line plus a perspective grid on the slopes) in
palette colours, behind the city but in front of the sun's lower half. Lines filtered against pixel
size. Proof: screenshot from `view=high` and `view=sun`.

**M5. Horizon life.** A thin sparkling band of distant city lights along the horizon and a slow drift
of high haze or thin cloud streaks catching the sun's colour. Subtle; it must not compete with the
real city.

## 6. Validation and acceptance

- `npm run check:task -- T03` exits 0.
- Screenshots in `shots/T03/`: towards the sun, away from it, straight up, and `view=high` with
  `layers=sky,probe`; one each for moods `sunset`, `midnight`, `miami`.
- No visible seam where the dome wraps in azimuth; no banding in the gradient (stretch a crop).
- The layer is one draw call and its `update` does no work.

Human checks: H-T03-1, the sun reads as the classic striped synthwave sun at a glance.

## 7. Idempotence and recovery

Stateless. Reloading the harness page rebuilds everything.

## 8. Progress

- [x] 2026-11-14 M1 gradient and horizon; the haze band was reworked once (Decision log)
- [x] 2026-11-14 M2 sun: disc, gradient, scrolling cut-outs, halo
- [x] 2026-11-14 M3 stars: two cube-grid layers, sparkles, dense band
- [x] 2026-11-14 M4 mountains: three triangulated wireframe ranges; the first version was replaced
- [x] 2026-11-14 M5 horizon life: city-light band and cloud streaks
- [x] 2026-11-14 unit tests in `tests/unit/sky/`, each new shader check shown failing against a
      broken copy before passing
- [x] 2026-11-14 acceptance: screenshots, motion sequences, stretched crops, tiers, loop wrap
- [x] 2026-11-14 `npm run check:task -- T03` exits 0; Outcomes written

Nothing is left open in this plan. Follow-ups for other tasks are listed under Outcomes.

## 9. Surprises and discoveries

1. **`patch` is a reserved word in GLSL ES 3.00.** A local named `patch` compiled in TypeScript and
   failed on the GPU: `ERROR: 0:503: 'patch' : Illegal use of reserved word`, and the layer drew
   nothing (`black 100.0%`). Renamed, and `tests/unit/sky` now checks every declared name against
   the reserved list.
2. **A linear blend into the fog colour reads as a hard line.** With `mix(sky, fog, exp(-h / 0.019))`
   the horizon still showed an edge looking away from the sun, because the horizon sky there is
   about 14 times brighter than the fog (luminance about 0.14 against 0.01 for the sunset mood, worked out
   from the values in `moods.ts`), so
   even 5% of sky is a visible step. See the Decision log for the replacement.
3. **A large L3 area does not keep its colour.** With the whole disc at `uSunTop`..`uSunBottom` (4 to
   6 linear), the lower bars came out pale peach under the tone curve and the bloom. The bottom of
   the disc is now written at 0.42 of `uSunBottom` and the gradient is weighted towards it.
4. **One star per jittered cell shows its lattice when most cells are full.** At 96% occupancy in the
   dense band the fine layer looked like a grid. Density is now modulated by 3D value noise and
   capped at 60%.
5. **The sun's own bloom tints the sky above it.** With the pipeline on, the area above the disc goes
   brownish (yellow bloom over magenta). It is the T02 bloom acting on a disc that the moods make L3
   by contract; not changed here, noted for T13.
6. **`scripts/shot.mjs` sometimes fails or saves a black PNG while siblings are editing.** Seen five
   times in some sixty to seventy runs: once an all-black PNG whose own statistics line said
   `mean 49.1/255 black 0.0%`; twice `Cannot read properties of undefined (reading 'info')`; twice
   `Execution context was destroyed, most likely because of a navigation`. The same command passed
   on the next run each time. The navigation message suggests the page reloaded mid-shot (a Vite
   full reload after someone's edit); that cause is inferred, not confirmed. It is in T00's paths.

## 10. Decision log

All 2026-11-14.

- **Dome is a cube, `gl_Position = p.xyww`, `DoubleSide`.** Only the direction of a vertex matters,
  and perspective-correct interpolation across a flat face gives the exact direction per pixel.
  It needs nothing but `projectionMatrix` and `mat3(viewMatrix)`, so it is right for the mirrored
  camera too.
- **One pixel-footprint value, from derivatives of the direction.** `px` is the angle one pixel
  covers. Every filter uses it, and the azimuth gradient is built analytically from `dFdx(d)`, so
  nothing takes a derivative of `atan`, which jumps at the seam. All derivatives are at the top of
  `main`; the rest of the shader branches freely to skip stars, clouds, mountains and lights where
  they cannot appear. A unit test holds that order.
- **Mountains are drawn analytically in the dome shader, not as geometry.** That keeps the layer at
  one draw call and gives the silhouette and every mesh line the same analytic antialiasing on all
  tiers, where a mesh edge would alias without MSAA.
- **Mountains are a triangulated mesh, not scaled copies of the ridge.** The first version drew grid
  rows as copies of the ridge profile and looked like a pleated curtain. Now each range has vertices
  on integer columns and on rows spaced as a plane receding from the viewer, each vertex nudged off
  its row, with straight edges and one diagonal per cell, and a slightly different fill per facet.
- **Ridges are fixed in the world; their height envelope follows the sun.** Tallest on the sun's
  flanks, with a notch on the sun's own azimuth so the stripes stay in view, and a per-range `sink`
  that drops the low stretches under the horizon so no range is a continuous line round the sky.
- **Haze is `exp(-depth / sin(elevation))`.** The transmission of a ground-hugging layer along the
  view ray. It is zero at the horizon with zero slope, so the sky rises out of the fog colour with
  no edge, and lets about 77% of the sky through at 2 degrees. Replaces the exponential blend (Surprise 2).
- **Sun.** Cut-outs open 0.5 radius above the centre and widen with the square root of depth down to
  where the horizon crosses the disc, so every mood shows a full set whatever the sun's height.
  The sky shows through a cut-out without the halo and at 0.75, for contrast. The disc runs from
  `uSunBottom * 0.42` to `uSunTop * 0.85` (5.1 linear red at the top, still L3).
- **Stars are a cube-face grid with an arctangent warp,** at most one star per cell, kept clear of
  the cell edge, each a Gaussian at least 0.8 pixel in radius. Twinkle uses `uTime` (cosmetic, so
  the one-frame jump at the loop wrap is accepted, §4.3).
- **Stripe scroll and cloud drift are loop-periodic:** 384 stripe periods and one turn of the cloud
  field per loop, both integers, checked by `skyParamProblems`.
- **`low` tier** drops the second cloud octave and the noise in the star band (`SKY_DETAIL`).

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

**Result against Purpose.** Delivered: the gradient, a striped sun that scrolls, stars with sparkles
and a dense band, three ranges of wireframe mountains, cloud streaks and a band of distant lights,
in one draw call with an empty `update`, for all three moods, in the main and the mirrored pass.

**Evidence** (RTX 4070 SUPER, ANGLE D3D11, 1600 x 900 unless noted, 2026-11-14):

```
npm run check:task -- T03
typecheck tsconfig.json: 0 error(s) in T03-sky, 0 elsewhere
typecheck tsconfig.node.json: 0 error(s) in T03-sky, 0 elsewhere
lint: ok (src/layers/sky, tests/unit/sky)
tests: ok (tests/unit/sky)   Tests  15 passed (15)
PASS T03-sky
```

- Tests can fail: run against copies with `stripeLaps: 384.5`, `cols: 181`, a local renamed `patch`,
  a reversed `smoothstep` and a derivative moved under a branch, the four tests that guard those
  failed and the other eleven passed.
- One draw call: `layers=sky&post=0` reports `draw calls 2` (dome plus the tone-map quad);
  `layers=probe` 18 against `layers=sky,probe` 20 with the pipeline (scene pass and reflection pass).
- Stars under a turn: 8 frames 0.0003 rad apart (a quarter pixel), time frozen, `post=0`: light in
  stars summed over a 600 x 400 window varies by at most 0.25% of its mean. Two frames 0.0035 rad
  apart show the same stars shifted about 2 pixels.
- Mountain lines under the same turn: at most 0.21% variation.
- Loop wrap: frames at t = 4093 .. 4098 s: the top edge of the first cut-out moves 366.5, 368.4,
  369.6, 371.5, 372.9, 374.5 px, with no jump across the wrap.
- Seam: looking exactly at the azimuth seam, `post=0`, the seam columns are not among the five
  largest column-to-column steps (those are stars), and the ridge and lights cross it unbroken.
- Banding: contrast-stretched crops of the halo and of the left gradient show smooth ramps and grain.
- No console errors or shader warnings in any final shot.

**Screenshots looked at** (`shots/T03/`): `sun`, `away`, `up`, `high`, `street`, `canyon`, `roof`,
`top` (all `sky,probe`); `mood_sunset`, `mood_midnight`, `mood_miami`; `sky_sun`, `sky_away`,
`sky_sun_midnight`, `sky_away_miami` (sky alone); `q_low` (crop), `q_medium`; `all_high`,
`all_street` (every layer that had landed); plus crops of the sun, mountains, horizon and seam.

**Not verified.**

- Any device but this desktop: no phone, no other GPU vendor, no SwiftShader run. `mediump` is 23
  bits here, so precision problems would not show.
- Frame cost. The only signal is that a sky-only frame at 3840 x 2160 held the 144 fps cap in
  headless Chromium; no GPU time was measured.
- Motion as motion: twinkle, stripe scroll and cloud drift were checked from frame sequences, not
  video. A mood change in mid-ease was not looked at.
- Context loss and restore, and `uMotion` below 1.
- H-T03-1 is a human check and is still open.

**For other tasks.** T13: the bloom veil over the sky above the sun (Surprise 5); the ground's far
edge meets the sky at the fog colour, so any change to `sc_fogColor` moves both together. T00: the
`shot.mjs` flake (Surprise 6).
