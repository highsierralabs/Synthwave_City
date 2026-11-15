---
id: T12-app-shell
title: The shipped page: boot, menu, HUD, settings
status: done
depends_on: [T00, T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11]
owns: [index.html, src/main.ts, src/app/**, tests/unit/app/**, README.md, plans/T12-app-shell.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, src/engine/**, src/city/**, src/audio/**, src/camera/**]
updated: 2026-11-15
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

**M7. Full screen (revision, 2026-11-15).** The operator asked: "Add a full screen option for mobile.
I can F11 on the pc but not my phone or tablet." Work:

- `src/app/fullscreen.ts`: pure helpers over a minimal document shape, so they run under Vitest in
  `node`. Support is `document.fullscreenEnabled`, else the prefixed `webkitFullscreenEnabled`
  (Safari on iPad before 16.4). The request goes to `document.documentElement`, not the canvas, so
  the menu, HUD and toasts stay visible in full screen. The state comes from `fullscreenchange` /
  `webkitfullscreenchange`, never from our own bookkeeping, because the system back gesture and Esc
  leave full screen without asking the page.
- Menu: a row "Full screen" with Off and On, like Sound. Where the API is missing (Safari on iPhone)
  the row instead tells the reader to use Share, Add to Home Screen. Launched from the home screen
  (`display-mode: standalone` or `fullscreen`, or `navigator.standalone`), the row is hidden: there is
  no browser chrome left to remove.
- HUD: on touch devices with support, a full-screen button beside the menu button, drawn in CSS
  (four corner marks), since a glyph such as U+26F6 may be missing from a phone's fonts.
- `index.html`: `mobile-web-app-capable`, `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style` and `apple-mobile-web-app-title` metas, so a home-screen
  launch on iOS runs without Safari's bars. No manifest file (R2: no asset files).
- Not stored in settings: a page cannot enter full screen without a fresh user gesture.

Proof: unit tests for the helpers; in Chromium with touch emulation, the menu row and the HUD button
enter and leave full screen and their pressed state follows; with the API removed by an init script,
the row shows the home-screen hint and the HUD button is absent.

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
H-T12-3, pointer lock and audio start in a real (non-automated) browser session; H-T12-4, full screen
on the operator's Android phone and tablet, entered from the menu and from the HUD button, and left
with the back gesture; H-T12-5, Add to Home Screen on an iPhone opens without Safari's bars.

## 7. Idempotence and recovery

`dist/` is disposable. Clearing site data resets settings.

## 8. Progress

- [x] 2026-11-14 M1 boot (`index.html`, `src/main.ts`, `src/app/app.ts`): WebGL2 check, tier choice with
  step-down after a failed boot, real progress, readable errors.
- [x] 2026-11-14 M2 title and menu: CSS-only logo, ENTER, rows for mood, detail, sound and screen (CRT).
- [x] 2026-11-14 M3 HUD (`src/app/ui.ts`): mode chip, hint, toasts, stats panel, photo mode.
- [x] 2026-11-14 M4 wiring: rig actions, audio on the ENTER gesture, beat source, visibility, context
  loss notice, reduced motion.
- [x] 2026-11-14 M5 settings (`src/app/settings.ts`), 7 unit tests.
- [x] 2026-11-14 M6 README.

Evidence:

    npm run check                 -> typecheck and lint clean, 341 tests in 27 files
    npm run build                 -> dist/ holds 1 html and 10 js files; gzipped JS about 260 kB
                                     (main chunk 166 kB, seven layers and post 95 kB), budget 400 kB
    npm run smoke                 -> SMOKE OK: 1,442 frames in 10 s with vsync on, median 6.9 ms,
                                     p99 7.1 ms, worst 10.6 ms, none over 50 ms, 59 draw calls,
                                     2.98 M triangles, render scale 1, no errors (1920x1080, high)
    smoke --mode nowebgl          -> the page says it needs WebGL2 (screenshot shots/T12/nowebgl.png)
    nested path                   -> dist copied to /some/deep/path/ under a plain static server boots
                                     to the running state
    shots/T12/interact.mjs        -> 11 of 11 with real clicks and keys: ENTER, H, T, M, 4, P, Space,
                                     Esc and Esc again all do what the menu says; no console errors
    screenshots viewed            -> title.png, running.png, stats.png

- [x] 2026-11-15 M7 full screen: `src/app/fullscreen.ts` (6 unit tests, one shown failing first with
  the webkit fallback disabled), the menu row, the HUD button, the home-screen metas, a README
  paragraph. Evidence:

      npm run check:task -- T12     -> PASS
      npm run check                 -> typecheck and lint clean, 347 tests in 28 files
      shots/T12/fullscreen.mjs      -> 18 of 18, on the dev server and again on the built site
                                       (vite preview): phone with touch emulation (menu On and Off,
                                       HUD button in and out, leaving from outside is followed, photo
                                       mode hides the button), API hidden by an init script (hint
                                       shown, no button), home-screen launch emulated (row hidden),
                                       desktop (row works, no button); no console errors
      shots/T12/interact.mjs        -> 11 of 11, unchanged
      npm run smoke                 -> SMOKE OK: 770 frames in 6 s, vsync on, median 8.0 ms, p99 8.1,
                                       worst 8.5, none over 50 ms, 59 draw calls, scale 1
      screenshots viewed            -> fs-phone-menu.png, fs-nofs-menu.png, fs-phone-running.png,
                                       fs-icon-enter.png, fs-icon-leave.png (3x crops)

- [x] 2026-11-15 H-T12-4, operator report after trying the built site over the tailnet on their phone
  and tablet: "Full-screen works". Which devices and browsers, and whether the iPhone route (H-T12-5)
  was tried, was not stated.

## 9. Surprises and discoveries

- The first smoke runs read 14 to 21 ms a frame and 8 to 12 ms of CPU. Two causes, neither in the app:
  sibling agents were running audio renders and browsers at the time, and the smoke test measured
  with vsync off, where the full city shows quantised 35 to 70 ms stalls that do not exist with vsync
  on. A bisection over layers, meshes, altitude and speed (scripts kept under `shots/T12/`) showed no
  single mesh stalls alone. The smoke test now records real frame intervals with vsync on.
- Those stalls made the adaptive scale fall from 1.0 to 0.7 in twenty seconds on a GPU with headroom
  to spare. It now ignores the first three seconds, and the smoke test fails if the scale drops at
  `high`.

- 2026-11-15: The first HUD icon, four corner marks drawn with CSS pseudo-elements, rendered as a
  "+" at phone size (`shots/T12/fs-phone-running.png`). It is now an inline SVG in `index.html`,
  checked at 3x (`fs-icon-enter.png`, `fs-icon-leave.png`).
- 2026-11-15: A test pressed `P` after tapping the HUD button and nothing happened: the button kept the
  focus, and the rig leaves keys to a focused button (T11). The button now gives up focus when
  tapped, so a tablet keyboard keeps working.
- 2026-11-15: The smoke median read 8.0 ms against 6.9 ms on 2026-11-14. With vsync on the interval
  follows the display's refresh, and M7 adds no rendering; the display rate was not checked.

## 10. Decision log

- 2026-11-14: The menu's CRT switch needed a way to reach the grade. Rather than import `src/post`, a
  shared uniform `uCrt` was added to the contract (recorded in T00's plan, section 11).
- 2026-11-14: While the menu is open the rig's input is detached, so the tour keeps running behind
  the menu and keys cannot fly the camera; the menu handles its own Escape.
- 2026-11-14: Changing the detail level reloads the page (D-08). The choice is stored first.
- 2026-11-15: Full screen covers the whole document, not the canvas, so the overlay and HUD keep
  working; it is offered on every device in the menu and as a HUD button on touch devices only, where
  there is no F11. No keyboard shortcut: the keys belong to the camera (T11) and F11 already exists.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Done. The built site boots to a title screen over the running city, enters on one click, and every
listed control works. Not verified: sound actually heard through speakers; pointer lock and audio
start in a non-automated browser session (H-T12-3); any touch device (H-T12-2); context loss and
restore (the notice exists, the event was never triggered); Firefox and Safari; how the title looks
on a narrow phone screen (H-T12-1).

M7 (2026-11-15): full screen is offered in the menu everywhere and as a HUD button on touch devices,
and follows the browser's own state. Checked in Chromium with touch emulation and with the API hidden,
which stands in for, but is not, Android Chrome on a phone (H-T12-4) or Safari on an iPhone or iPad
(H-T12-5). Not verified: the prefixed path on a real iPad; whether `navigationUI: 'hide'` hides
anything more on the operator's devices; that the iOS home-screen metas still give a bar-free launch
on current iOS (from memory, not tested).
