---
id: T12-app-shell
title: The shipped page: boot, menu, HUD, settings
status: ready
depends_on: [T00, T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11]
owns: [index.html, src/main.ts, src/app/**, tests/unit/app/**, README.md, plans/T12-app-shell.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, src/engine/**, src/city/**, src/audio/**, src/camera/**]
updated: 2026-11-14
---

# T12: app shell

## 1. Purpose

Turn the parts into the thing people open. A title screen over the living city, one button to enter,
a small menu for mood, quality and sound, a discreet HUD, remembered settings, and honest messages
when something cannot work. After this task `npm run build` produces the finished static site.

## 2. Context and orientation

`architecture.md` §1.2, §3, §7, §9, §10. Everything visual already exists as layers the engine finds
by itself; this task wires `createCityPlan`, `createEngine`, `createCameraRig` and `createAudio`
together and adds the DOM around the canvas. `src/app` is the only module allowed to import
everything (§3.2). The dev harness under `dev/` stays as it is and is not part of the build.

The page has three states: loading (progress bar while the plan is built, layers initialise and
shaders compile), title (the city already running behind a dimmed, slightly blurred overlay, on the
tour), and running (overlay gone, HUD hints fading out after a few seconds).

## 3. Scope

Owns `index.html`, `src/main.ts`, `src/app/**`, `README.md`. Non-goals: changing any layer; new
dependencies; a UI framework (plain DOM and CSS).

## 4. Interfaces

Consumes the public functions of `engine`, `city`, `camera`, `audio` and the contract types. Provides
the built site, and URL parameters for testing: `?q=low|medium|high`, `?mood=`, `?seed=`,
`?autostart=1` (skip the title, used by the smoke run), `?t=` (freeze time).

## 5. Plan of work

**M1. Boot.** `index.html` with the canvas, inline critical CSS, and a no-script and no-WebGL2 message.
`main.ts`: detect WebGL2; pick the tier (stored choice, else by device hints; step down once if the
last boot never reached the first frame); build the plan; create the engine; show real progress;
first frame; then the title state. Errors at any step show a readable message with the cause.
Proof: `npm run build` then `npm run smoke` passes.

**M2. Title and menu.** Synthwave typography in CSS only (gradient text, glow, a perspective grid
accent drawn with CSS), `ENTER` button, rows for mood (Sunset, Midnight, Miami), quality (Low, Medium,
High; changing it reloads), sound on or off, and a controls list that adapts to pointer type.
`Esc` or the menu button returns to it. Keyboard and screen-reader reachable: real buttons, focus
styles, `aria-pressed`.

**M3. HUD.** Minimal and fading: mode (Tour or Free flight), a hint line, toast messages for viewpoint
names and mood changes, and an optional stats panel on `H` (fps, frame time, draw calls, render
scale, tier). A photo mode (`P`) that hides everything.

**M4. Wiring.** Keys: `Space` tour or free flight, `1`-`6` viewpoints, `T` next mood, `M` mute, `H`
stats, `P` photo mode, `Esc` menu. Audio starts on the `ENTER` gesture and follows the mute setting;
its `BeatSource` goes to the engine. Pointer lock on entering free flight with a mouse. Pause on
`visibilitychange`; context-loss notice and recovery; `prefers-reduced-motion` passed to the rig.

**M5. Settings.** One `localStorage` key holding tier, mood, mute, volume; every access in try/catch;
pure load, validate and migrate functions with unit tests (garbage in storage gives defaults).

**M6. README.** What it is, a screenshot-free description, how to run and build, controls, the tech
stack, how it relates to the demo that inspired it, and what has and has not been tested.

## 6. Validation and acceptance

- `npm run check` exits 0 (whole repo, since nothing else is in flight by now).
- `npm run build` succeeds; `dist/` contains no file other than HTML, JS and CSS; gzipped JS is under
  the §9 budget.
- `npm run smoke` passes: boots from the built site, no console errors, a non-empty frame, frame time
  reported.
- Screenshots in `shots/T12/` of the built site: loading, title, running with HUD, menu open, stats
  panel, and the no-WebGL message (launch with `--disable-3d-apis`).
- The built site also works when served from a nested path.

Human checks: H-T12-1, the title screen looks the part; H-T12-2, the whole flow on a touch device;
H-T12-3, pointer lock and audio start in a real (non-automated) browser session.

## 7. Idempotence and recovery

`dist/` is disposable. Clearing site data resets settings.

## 8. Progress

- [ ] M1 boot
- [ ] M2 title and menu
- [ ] M3 HUD
- [ ] M4 wiring
- [ ] M5 settings
- [ ] M6 README

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
