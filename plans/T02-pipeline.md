---
id: T02-pipeline
title: Frame pipeline: reflection, bloom, tone map, grade
status: done
depends_on: [T00]
owns: [src/post/**, tests/unit/post/**, plans/T02-pipeline.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**]
updated: 2026-11-16
---

# T02: frame pipeline

## 1. Purpose

Make light glow. After this task anything a layer writes above the bloom threshold blooms, the frame
is tone-mapped so neon stays saturated instead of bleaching, the ground can mirror the city, and the
resolution adapts to hold the frame rate. Every layer task after this one is judged through this
pipeline, so it comes first.

## 2. Context and orientation

`architecture.md` §3.5 and §5.6. The engine (`src/engine`) loads `src/post/index.ts` through a lazy
glob and calls `createPipeline(host)`; with `?post=0` it bypasses it. Contract types `FramePipeline`
and `PipelineHost` are in `src/contracts/layer.ts`. Only this module imports `postprocessing`. Read the
"pmndrs postprocessing" section of Agents.md first: most of its lines are traps.

The reflection pass renders the scene from a camera mirrored in the plane `y = 0`. Shaders place
geometry relative to the camera's x and z (§4.1), and the mirror camera has the same x and z, so
layers need no change for it. Objects on three layer `SC_LAYER_NO_REFLECT` are left out.

## 3. Scope

Owns `src/post/**`. Non-goals: any layer's shading; mood values; the quality table (it reads
`QualitySettings`).

## 4. Interfaces

Provides `createPipeline(host: PipelineHost): FramePipeline`. Writes the shared uniforms `uReflTex`,
`uReflMatrix`, `uReflAmount` and `uResolution`. Reads the tier from `host.quality`.

## 5. Plan of work

**M1. Composer and bloom.** `EffectComposer` with a half-float buffer and tier MSAA; `RenderPass`;
bloom with a luminance threshold near 1.0 and a soft knee; output to the canvas with alpha 1.
Proof: a probe box written at 0.1 does not bloom, one at 3.0 does (screenshot).

**M2. Tone curve and grade.** Compare ACES, AgX and a custom curve (per-channel soft shoulder with a
saturation hold) on the same frame and keep the one where magenta, cyan and orange at L2 stay
recognisably coloured while L3 cores go white. Then chromatic aberration (small, radial), vignette,
and one custom effect for scanlines and grain whose strength is a uniform (0 is off; no runtime
effect toggling). Dithering on the last pass. Proof: side-by-side screenshots and the choice recorded
in the Decision log.

**M3. Reflection pass.** A mirror camera rebuilt each frame from the main camera, a render target at
the tier's reflection scale with mipmaps, `uReflMatrix` so a shader can project a ground position
into it, `uReflAmount` 0 when the tier has no reflections (the target is then a 1x1 black texture and
the pass is skipped). Proof: a test plane in the probe sampling `uReflTex` shows the boxes upside
down, aligned at their bases, from a low camera and a high one.

**M4. Adaptive resolution.** Track a smoothed frame time; step the render scale down when it is over
budget for a second, up when comfortably under for several; clamp to the tier's range; never resize
more than about once a second. Pure logic in its own file with unit tests (step down under load, step
up with headroom, no oscillation on a boundary).

**M5. Precompile.** Expose warm-up so the engine can compile every program with the composer's target
bound before the first frame. Proof: no shader compile is logged after the first rendered frame.

**M6. Sun shafts (stretch).** A depth-masked radial blur from the sun's screen position, `high` tier
only, strength from the mood. Only if M1 to M5 are done and budget remains.

**M7. A CRT look you can see (revision, 2026-11-16).** The operator could not tell whether the menu's
CRT switch did anything. Scanlines one device pixel apart blur into a slight dimming at normal
viewing size, and on a phone's 2.6x screen they are finer still. Size them in CSS pixels instead,
make them deeper, add an RGB aperture grille at the same pitch and faster falloff in the corners,
and give back most of the average light they take. Proof: the line pitch in CSS pixels is the same
at every pixel ratio (unit test); screenshots on and off at 1x and at a phone's ratio, viewed.

## 6. Validation and acceptance

- `npm run check:task -- T02` exits 0.
- Screenshots in `shots/T02/`: bloom on and off (`post=0`) of the same view; the tone-curve
  comparison; the reflection proof.
- Draw calls with the pipeline on are within 2x the scene's own count plus 20.
- No console errors or shader warnings in the shot output.

Human checks: H-T02-1, the tone curve "feels" right on a real monitor (judged again in T13).

## 7. Idempotence and recovery

No persistent state. `?post=0` always gives the unprocessed frame for comparison.

## 8. Progress

- [x] 2026-11-14 M1 composer and bloom: half-float composer, tier MSAA, mip-chain bloom.
- [x] 2026-11-14 M2 grade: one custom effect (exposure, tone curve, vignette, scanlines, grain) plus
  radial chromatic aberration; dithering on. Curve choice is provisional, see the Decision log.
- [x] 2026-11-14 M3 reflection pass: mirror camera, half-size half-float target with mipmaps.
- [x] 2026-11-14 M4 adaptive resolution: `adaptive.ts`, five unit tests.
- [x] 2026-11-14 M5 precompile: `warmUp()` compiles with the composer target bound.
- [ ] M6 sun shafts (stretch): not built. Dropped by T13 (see its Decision log).
- [x] 2026-11-16 M7 visible CRT: `grade.ts` draws scanlines and an aperture grille `uCrtPitch` device
  pixels apart, `crtPitch()` gives 3 CSS pixels per line and never under 3 device pixels, and
  `index.ts` sets it with every resize or render-scale change. Lines are deeper in the darks and
  mids than in highlights; most of the lost light is given back. `CRT_STRENGTH` (0.7, T12) unchanged.
  Evidence:
  - The old effect did run: at `crt=0.7` the mean of `view=high` fell from 97.5 to 92.8 of 255, but
    the lines were invisible at 1:1 (alternate rows, 2 device pixels per cycle).
  - `tests/unit/post/crt.test.ts` (2 tests). Shown failing once with the pitch at 2 CSS pixels
    ("expected 2 to be close to 3"); restored, passes.
  - Viewed, `layers=all`, `t=20`, no console errors or shader warnings: `shots/crt/new-high-0.7.png`
    (1600 x 900 at 1x: lines plain across the sky and facades, corners darker), `new-zoom-0.7.png`
    (4x crop: line, gap and the RGB stripes), `phone-0.7.png` (915 x 412 CSS at 2.625x, `q=medium`:
    the same line size on screen). Mean at `crt=0.7` 94.4 against 97.5 off.
  - `npm run check:task -- T02` PASS; `npm run check` 375 of 375.

Evidence:

    npm run check:task -- T02     -> PASS (5 tests)
    shot view=high                -> pipeline: post, 18 draw calls (scene 3, mirror 3, effects 12), no errors
    shot view=street              -> viewed: towers and curb lines mirrored in the road, bases aligned
    post=0                        -> falls back to the engine's basic pipeline

## 9. Surprises and discoveries

- Grain added in linear light at a fixed amplitude is enormous in the darks after sRGB encoding (the
  black sky came out as grey noise). It is now scaled with brightness.
- The reflection needed no change in any shader: placing geometry relative to the camera's x and z
  means the mirror camera, which shares them, renders the same world.

## 10. Decision log

- 2026-11-14: The default tone curve is the custom "neon" curve (a per-channel exponential shoulder
  blended 45 percent with a luminance-scaled, hue-holding version), with ACES kept behind `?tm=aces`
  for comparison. This is provisional: with only the probe to look at, both curves give an unclipped
  frame and the difference cannot be judged. T13 compares them on the finished city.
- 2026-11-14: Vignette, scanlines and grain live in the same effect as the tone curve instead of three
  library effects: fewer shader stages, and scanline strength is a uniform, so nothing is toggled at
  run time.

- 2026-11-16: The CRT pitch is in CSS pixels (3 per line, one RGB triad per line), not device pixels,
  so it reads the same on a monitor and a phone, and never under 3 device pixels so a lowered render
  scale cannot alias it. It needs the device-per-CSS ratio, which `src/post` already has at resize, so
  the pitch is a private uniform of the grade and no contract changes.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Done except the stretch milestone. Bloom, grade, reflection and adaptive scale run on the RTX at 18
draw calls with the probe. Not verified: that no program compiles after the first frame (the warm-up
exists but was not instrumented); behaviour of the adaptive scale on a real vsynced display (unit
tests only); the `medium` and `low` tiers on screen; human check H-T02-1.

**M7 outcome (2026-11-16).** The CRT switch now shows plainly: scanlines and an aperture grille about
3 CSS pixels apart on any screen, and darker corners. The operator viewed the production build on
the PC and on the Android phone over the tailnet and reported it looks good on both, at the existing
strength of 0.7 (2026-11-16). Not verified: frame cost, not measured (a few ALU ops in a pass that
already runs).
