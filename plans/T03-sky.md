---
id: T03-sky
title: Synthwave sky
status: ready
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

- [ ] M1 gradient and horizon
- [ ] M2 sun
- [ ] M3 stars
- [ ] M4 mountains
- [ ] M5 horizon life

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
