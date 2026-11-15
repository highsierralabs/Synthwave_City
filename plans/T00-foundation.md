---
id: T00-foundation
title: Tooling, contracts, core, engine and dev harness
status: ready
depends_on: []
owns: [package.json, package-lock.json, tsconfig.json, tsconfig.node.json, vite.config.ts, vitest.config.ts, eslint.config.js, .gitignore, .gitattributes, CLAUDE.md, src/contracts/**, src/core/**, src/engine/**, dev/**, scripts/**, tests/unit/contracts/**, tests/unit/core/**, tests/unit/engine/**, plans/README.md, plans/T00-foundation.md]
reads: [architecture.md, Agents.md]
updated: 2026-11-14
---

# T00: foundation

## 1. Purpose

After this task a developer can run one command and see a wrapped, fogged, endless field of test
boxes in the browser, fly through it, and take a reproducible screenshot of it. Every later task
builds on what this one freezes: the contracts, the engine that hosts layers, and the tools that
prove a layer works.

## 2. Context and orientation

The folder holds only `architecture.md`, `Agents.md`, `CLAUDE.md` and `plans/`. Node is 24.14.1 and
npm 11. Chromium revision 1234 is in the Playwright cache; do not download another. The pinned
versions in `architecture.md` §2 are the set Midnight Vector (`C:\highsierralabs\Midnight_Vector`)
already runs on this machine; its `package.json` and configs are a reference, not a dependency.

Terms: a **layer** is one visual subsystem (§3.4). The **harness** is the page under `dev/` that mounts
any subset of layers with a fixed or free camera. The **probe** is a throwaway layer that lives in
`dev/`, draws the plan's boxes with flat shading, and exists to prove the engine before real layers do.

## 3. Scope

Owned paths are in the frontmatter. Non-goals: any real layer, the pipeline (`src/post`), the shipped
`index.html`, audio, the real camera rig.

## 4. Interfaces

Provides everything in `src/contracts/**` (§8), plus:

- `src/core/random.ts`: `hash32`, `mulberry32`, `Rng` helpers. `src/core/math.ts`: `clamp`, `lerp`,
  `smoothstep`, `wrap`, `wrapDelta`. `src/core/clock.ts`: `LoopClock`.
- `src/engine/engine.ts`: `createEngine(options)` returning `Engine` (`start`, `stop`, `renderAt`,
  `resize`, `setMood`, `setBeatSource`, `setCameraDriver`, `stats`, `errors`, `dispose`).
- `dev/`: the harness, with URL parameters `layers`, `view`, `cam`, `t`, `q`, `mood`, `post`, `seed`,
  and `window.__SC_READY`, `window.__SC_ERRORS`, `window.__SC_STATS`.
- `scripts/`: `shot.mjs`, `smoke.mjs`, `check-task.mjs`, `plans-check.mjs`, `lib/browser.mjs`.

Consumes: `src/city/index.ts` (`createCityPlan(seed)`) and `src/post/index.ts` (`createPipeline(host)`)
through lazy globs, when they exist. Until T01 lands the harness uses a small fixture plan in `dev/`.

## 5. Plan of work

**M1. Scaffold.** `package.json` with exact versions and the scripts named in Agents.md; two tsconfigs
(`src` and node-side), `vite.config.ts` (`base: './'`, ports 5180 and 5181, host 127.0.0.1),
`vitest.config.ts`, `eslint.config.js` with the §3.2 boundaries. `npm install`, commit the lockfile.
Proof: `npm run typecheck` and `npm run lint` exit 0 on an empty `src`.

**M2. Contracts.** Write every file in §8.1. The GLSL chunk gets the shared uniform declarations, the
hashes, `sc_place`, `sc_project`, fog, palette lookup, road-grid helpers, line filters and
`sc_axisBillboard`. Proof: a unit test parses the `#define`s out of `SC_COMMON` and compares them with
`constants.ts`; a second test implements `sc_place`'s wrap in TypeScript and checks it against
`wrapDelta` on random inputs, including the seams.

**M3. Core.** Seeded random, maths, `LoopClock` (wraps at `LOOP_SECONDS`, clamps `dt`, survives a hidden
tab). Proof: unit tests, including "advance past the loop end and time wraps without a negative dt".

**M4. Engine.** Renderer creation behind try/catch; one `Scene`; camera at `(0, y, 0)`; the
`SharedUniforms` object; mood easing; beat from the clock or a `BeatSource`; layer host over
`import.meta.glob`; fallback direct render with a tone map when no pipeline loads; shader-error
capture into `__SC_ERRORS`; `renderAt(time)` for frozen frames; resize. A layer that throws in `init`
is skipped and recorded.

**M5. Harness and probe.** `dev/index.html` and `dev/main.ts`: parse the URL, build the plan (real or
fixture), mount layers, install either a fixed camera (`view`/`cam`) or a simple fly camera, show a
small overlay (fps, draw calls, triangles, layer errors). `dev/probe/` draws plan boxes through
`sc_place` and `sc_fog`. Proof: screenshots at two cameras 6400 m apart are identical (the wrap), and a
camera placed on a tile seam shows no gap.

**M6. Scripts.** `shot.mjs` (launch cached Chromium on the GPU, open a harness URL, wait for
`__SC_READY`, save a PNG, print renderer string, console errors and warnings, image mean and
percentage of clipped pixels; exit non-zero on errors). `smoke.mjs` (build, preview, boot, same
checks, plus frame time from the engine). `check-task.mjs` (typecheck, lint and tests filtered to one
plan's `owns`). `plans-check.mjs` (frontmatter parses; no path owned twice).

## 6. Validation and acceptance

- `npm run check` exits 0. `npm run plans:check` exits 0 and lists 14 plans.
- `node scripts/shot.mjs --url "/dev/?layers=probe&view=high" --out shots/T00/high.png` exits 0, prints
  a renderer string containing `NVIDIA`, and the image shows fogged boxes to the horizon.
- The wrap proof and the seam proof from M5, with both images viewed.
- Negative control: a deliberate GLSL syntax error in the probe makes `shot.mjs` exit non-zero and name
  the error.

Human checks: none.

## 7. Idempotence and recovery

Everything is re-runnable. `npm ci` restores `node_modules`. Nothing outside the project folder is
written except the Vite and npm caches.

## 8. Progress

- [ ] M1 scaffold
- [ ] M2 contracts
- [ ] M3 core
- [ ] M4 engine
- [ ] M5 harness and probe
- [ ] M6 scripts

## 9. Surprises and discoveries

None yet.

## 10. Decision log

- 2026-11-14: Playwright is used as a library from Node scripts rather than through its test runner.
  There are no pixel baselines to manage (D-09), so the runner would add configuration for nothing.
- 2026-11-14: Shaders are TypeScript strings, not `.glsl` files, so `SC_COMMON` can be prepended with
  plain concatenation and no build plugin.

## 11. Contract change requests

This task owns the contracts. Requests from other plans are recorded here with their outcome.

## 12. Outcomes and retrospective

Not yet written.
