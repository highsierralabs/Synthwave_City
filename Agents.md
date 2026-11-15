# Agents.md

Synthwave City is a static website: an endless synthwave megacity you fly through, built with
TypeScript, three.js on WebGL2, custom GLSL and pmndrs post-processing, with no asset files.

Design lives in [architecture.md](architecture.md) and is not repeated here. This file is how to work
on the project. `§n` means section n of architecture.md. Read §3, §4, §5.2, §8 and your row in §12
before your first change.

**Evidence tags.** `[O]` observed in this project on this machine. `[MV]` observed in the sibling
project Midnight Vector, on this machine, with the same pinned versions; carried over and not yet
re-run here. `[W]` from a web source listed at the end. `[I]` inferred, not tested. `[M]` from memory.
When you confirm an `[MV]` item here, change its tag to `[O]`. When one turns out wrong, fix the line.

## Start here

### Commands

Run from `Synthwave_City/`. PowerShell 5.1 or the Bash tool both work for these.

```
npm ci                       # install exactly what the lockfile says
npm run dev                  # Vite dev server on http://127.0.0.1:5180 ; it blocks, run it in the background
npm run build                # static site in dist/
npm run preview              # serve dist/ on http://127.0.0.1:5181
npm run typecheck            # tsc --noEmit on both tsconfigs
npm run lint                 # ESLint, including the module boundaries of §3.2
npm test                     # vitest run
npm run check                # typecheck + lint + test, whole repo; run when no sibling task is mid-flight
npm run check:task -- T05    # the same gates, reported only for the paths that plan owns
npm run plans:check          # every plan parses, and no path is owned by two plans
npm run smoke                # build, serve, boot in Chromium on the GPU, check errors and frame time

npx vitest run tests/unit/city/plan.test.ts -t "deterministic"     # one unit test
node scripts/shot.mjs --url "/dev/?layers=sky,buildings&cam=3200,180,3200,0.6,-0.15&t=12" --out shots/T05/a.png
```

`shot.mjs` needs the dev server running. It prints the WebGL renderer string, any console errors and
basic image statistics, and writes a PNG. Harness URL parameters: `layers` (comma list, `all`, and
`probe` for the flat-shaded test boxes), `view` (a named camera from `dev/views.ts`: `high`, `away`,
`sun`, `canyon`, `street`, `side`, `roof`, `plaza`, `mega`, `top`, `low`), `cam` (`x,y,z,yaw,pitch`
in metres and radians), `t` (seconds; freezes time), `q` (quality tier), `mood`, `post=0` (bypass the
pipeline), `seed`, `rig=1` (use `src/camera`). `shot.mjs` also takes `--frames N --dt s --move dx,dy,dz
--turn rad` for sequences; run it with no arguments for the list.

### Source of truth, highest first

1. The operator's instruction in the current session.
2. `architecture.md` for design, and `src/contracts/**` for interfaces. If the two disagree, stop and
   report it; do not pick one.
3. Installed source in `node_modules/` for what a library really does. It beats this file, blog posts
   and memory.
4. This file, for how to work.
5. Your plan, for scope and steps inside the paths you own.

### Never

- Edit a path your task does not own (§12). That includes `src/contracts/**` unless you are T00.
- Write code for a task whose plan does not exist yet.
- Install, remove or upgrade a package outside T00. Runtime dependencies are exactly `three` and
  `postprocessing`.
- Run `npm audit fix --force`, or `npx playwright install` as a side effect [MV].
- Add an asset file (image, model, font, sound). Everything is generated (R2).
- Push without the operator asking, or change git history. A push to `main` publishes the site.

### Windows

- PowerShell 5.1 has no `&&`: write `A; if ($?) { B }`.
- In the Bash tool use forward slashes; backslashes in `C:\...` get mangled.
- A heredoc with an unbalanced apostrophe fails in the Bash tool here [O]. Write multi-line files with
  the file tools.
- The session scratchpad folder is shared by every agent in a session. One agent's backup there was
  overwritten by a sibling and restored into the wrong layer [O: T04]. Use a subfolder named for your
  task.
- Paths resolve case-insensitively on this disk, so a wrong-case import passes here and fails on Linux
  [MV]. Match case exactly.

### Loading this file

Claude Code reads `AGENTS.md` on its own only when there is no `CLAUDE.md` in the working folder or
above it, and `C:\highsierralabs\CLAUDE.md` exists [W: cc-memory]. The documented fix is a `CLAUDE.md`
beside this file containing `@Agents.md`; T00 adds it. The file is named `Agents.md`, as the operator
asked; do not add a second copy under another casing, since both names are the same file here.

## TypeScript 6

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and
  `isolatedModules` are on. `moduleResolution` is `bundler`; `node` gives TS5107 [MV].
- Keep `"types": ["vite/client"]`, or `import.meta.glob` and `import.meta.env` stop type-checking [MV].
- **Vite strips types without checking them** [W: vite-features]. A page that runs proves nothing about
  types; run `npm run typecheck`.
- `noUncheckedIndexedAccess` applies to typed arrays: `f32[i]` is `number | undefined`. In hot loops
  write `f32[i]!`, which is erased at compile time [MV]. Do not paper over it with `?? 0`, which adds a
  branch and hides out-of-range bugs.
- Use `as const` objects instead of `enum`, and `import { X, type Y }`.
- Never route round a contract with `any` or a cast. File a contract change request (see Plan files).

## Vite 8

- Shaders are TypeScript template strings exported from `.ts` files and prefixed with `SC_COMMON`.
  No GLSL plugin, no `?raw`, no `#include` of project code (three resolves `#include` only against its
  own chunks [MV]).
- `base: './'`, so the build runs from any folder (R1).
- Old snippets are stale: `rolldownOptions` replaced `rollupOptions`, `oxc` replaced `esbuild` [MV].
- The 500 kB chunk warning is expected: three plus effects is about 600 kB raw, 150 kB gzipped [MV].
- `dev/` pages are for the dev server. The production build takes `index.html` only.
- `import.meta.glob('../layers/*/index.ts')` is lazy by default: each match is a function returning a
  promise, and a module with a syntax error fails only when it is asked for [M]. That is what lets one
  dev server serve every task at once.

## three.js 0.187 on WebGL2

**Materials and programs**

- Use `ShaderMaterial` with `glslVersion` unset. It compiles as `#version 300 es`, so `in`/`out` in
  the three-provided sense, `texelFetch`, `fwidth` and integer ops work. Setting `GLSL3` breaks
  `gl_FragColor`; `RawShaderMaterial` without a version compiles as ESSL 1.00 [MV].
- Write colour with `gl_FragColor`. three declares the output for you.
- Share uniforms by reference: `uniforms: { ...ctx.uniforms, uMine: { value: 1 } }`. Never `clone()` a
  material that shares uniforms; clone deep-copies the values and silently breaks the link [MV].
- Build every mesh in `init`, before the first frame, so program compilation happens during loading.
  Do not flip `transparent`, `defines` or blending afterwards; each change recompiles mid-flight [MV].
- `renderer.debug.onShaderError` replaces three's own `console.error` [MV]. The engine sets it and
  reports through both the console and `window.__SC_ERRORS`, so the screenshot tool can see a broken
  shader. Leave `checkShaderErrors` on.

**Instancing**

- One `InstancedBufferGeometry` (or `InstancedMesh` with custom attributes) per kind of thing, and one
  draw call for all of them. Per-instance data goes in `InstancedBufferAttribute`s filled once in
  `init`.
- **Capacity is fixed.** Resizing an attribute throws [MV]; set `geometry.instanceCount` to draw fewer.
- For data that never changes, leave the default `StaticDrawUsage` and never set `needsUpdate` again.
  For the few CPU-animated things, update in place and use `addUpdateRange`, which counts components,
  not instances [MV].
- Every mesh sets `frustumCulled = false` and `matrixAutoUpdate = false` (§4.1).

**State and colour**

- `Color` setters convert sRGB to linear; uniforms and GLSL literals are already linear [MV]. The
  palette in `src/contracts/palette.ts` is stored linear. Write hex colours through `Color`, numbers
  as linear.
- Data textures (`uCellTex`, atlases of numbers) use `NoColorSpace`; the canvas-drawn ad atlas uses
  `SRGBColorSpace` [I].
- `alpha: false` does not make the canvas opaque; the final pass must write alpha 1 [MV].
- Under the composer, `renderer.toneMapping` is ignored; tone mapping is an effect [MV].
- `renderer.info.autoReset = false` and one `info.reset()` per frame, or draw-call counts under the
  composer are wrong [MV].
- `THREE.Clock` is deprecated and warns [MV]. The loop uses the rAF timestamp.
- Dispose what you create: geometries, materials, textures and render targets. three frees nothing on
  its own [W: dispose].

**Hot paths**

In `update` and anything else called per frame: no `new`, no `clone()`, no closures, no array spread,
`.map`, `.slice()`, `.subarray()` or template strings. Keep scratch objects at module scope.

## Custom GLSL

- Every shader starts with `SC_COMMON` from `src/contracts/glsl.ts`. It declares the shared uniforms,
  so do not redeclare them.
- **Place everything with `sc_place(anchor, local)` and project with `sc_project`** (§4.1). Never use
  `modelMatrix`, never write your own wrap, and never apply the wrap per vertex.
- **Move along lanes with `fract(laps * uLoop + phase)`, `laps` an integer** (§4.3). Use `uTime` only
  for cosmetic flicker.
- **Write light on the shared scale** (§5.2). Unlit surfaces stay under 0.15, large lit areas under
  1.0, neon 1.5 to 4, small cores up to 10. Run every colour through `sc_fog` before output.
- **Filter anything periodic.** Take `fwidth` of the coordinate before `fract`, and fade a pattern to
  its average once a cell is smaller than about two pixels. Use the filtered-line helpers in
  `SC_COMMON` for thin lines; a raw `step` shimmers at distance [W: golus].
- Take derivatives before any branch that depends on per-pixel data, and do not `return` or `discard`
  under a non-uniform condition above derivative-dependent code. On D3D11 that drew outlines around
  cells, which SwiftShader did not show [MV].
- `patch` is a reserved word in this GLSL compiler; do not use it as a name [O: T03, T04].
- **Clamp interpolated values before `pow`, `sqrt`, `exp` or a division.** Under MSAA (the `high` tier) a
  varying is extrapolated outside its triangle at edge samples, so a radius that is never negative
  at a vertex can be negative in the fragment shader. One NaN from `pow` was smeared by bloom into
  a black block over half the frame, and only at `q=high` [O: T08]. T05 and T09 hit the same thing
  with `exp` and `pow`; `post=0` hides it, so test with the pipeline on. Declaring the varyings of
  additive ribbons as `centroid varying` removes the cause; `isnan()` in the shader did not catch it
  [O: T07].
- Ribbons that turn to face the camera need `side: DoubleSide`, or about half are culled [O: T07].
- Avoid undefined built-ins: `smoothstep` with `edge0 >= edge1`, `clamp` with min above max, `pow`
  with a negative base, `%` on negative ints [M]. Write `1.0 - smoothstep(a, b, x)` with `a < b`.
- Use `highp` for coordinates and time. This desktop reports 23 bits for `mediump`, so precision bugs
  do not show here [MV].
- Translator warnings go to `console.warn`, not `console.error` [MV]. The screenshot tool prints both.
- Hashes: use the ones in `SC_COMMON`. They hash the exact bits of a float, so feed them exact
  values: `floor`ed cell indices and quantised seeds. `fract(sin(x) * 43758.5453)` differs between
  GPUs for large arguments [M].
- **Per-instance values go to the fragment shader as `flat varying`.** An interpolated constant is not
  bit-exact across a triangle, and the hashes turned that into speckle on every facade; `flat`, plus
  `floor(seed * 4096.0)` before hashing, fixed it [O].

## pmndrs postprocessing 6.39.6

Only `src/post` uses this library.

- One `EffectComposer` with a `HalfFloatType` frame buffer; `multisampling` set once from the tier.
- Tone map with `ToneMappingEffect` and set the mode explicitly; the default is AGX [MV].
- Bloom thresholds luminance. `mipmapBlur` is already the default; `kernelSize`, `resolutionScale`,
  `width` and `height` are deprecated [MV]. Changing `levels` reallocates targets, so set it once.
- A merged `EffectPass` holds at most one convolution effect, and the check is a text match for
  `mainUv` in the effect's fragment source, comments included. The error is thrown at `addPass`, not
  in the constructor [MV].
- Effect order in a pass is not argument order: convolution effects sort first [MV].
- Do not toggle effects at run time to save GPU: `enabled = false` on the last pass leaves the canvas
  empty, and blend-mode switches recompile [MV]. Build the variants a tier needs once.
- Call `renderer.setPixelRatio` and `composer.setSize` together, only on resize or a scale change, and
  pass `dt` to `composer.render(dt)` [MV].
- Precompile with the composer's target bound, or the first frame compiles every program a second
  time for the other output colour space [MV]:
  `renderer.setRenderTarget(composer.inputBuffer); await renderer.compileAsync(scene, camera); renderer.setRenderTarget(null);`

## Web Audio

- Create or resume the `AudioContext` inside a gesture handler (`pointerup`, `click`, `keydown`). One
  made earlier starts `suspended` [W: mdn-audio].
- Schedule with a lookahead timer: a `setInterval` of about 25 ms that schedules everything due in the
  next 100 ms with `start(t)` and `setValueAtTime`. Never schedule from `requestAnimationFrame`
  [W: clocks].
- Source nodes are one-shot; a second `start()` throws. Make a new source per note, reuse the
  `AudioBuffer`, disconnect on `onended`, and cap polyphony [MV].
- Use `AudioParam` methods for anything timed, not `.value` [W: mdn-audio].
- On `visibilitychange` to hidden: suspend, stop the timer, and reset the next-note time on return so
  no burst plays [MV].
- Keep the master bus under a limiter and start quiet. Nothing in this project may be louder than
  -6 dBFS peak [I].

## Canvas 2D atlases

- Draw once in `init`, upload once as a `CanvasTexture`, then leave it; never redraw per frame.
- Generic font stacks only (`system-ui, sans-serif`, `ui-monospace, monospace`). Do not depend on a
  glyph being present; lean on shapes.
- Invented names only. No real brands, logos, people or song titles.
- Power-of-two sizes, mipmaps on, `anisotropy` from `renderer.capabilities.getMaxAnisotropy()`.

## Vitest 5

- Pure logic only, in the `node` environment. No jsdom; anything needing a DOM or WebGL is checked in
  the browser with `shot.mjs` or `smoke.mjs`.
- `core` and `city` must be deterministic: same seed, same bytes. Test that, and test invariants
  (no box inside a road corridor, every site clear of every box) rather than golden numbers that the
  art pass will move.
- Use `vitest run`; bare `vitest` can sit in watch mode [MV].
- A gate that cannot fail is not evidence. Show a new test failing once before it passes.

## Playwright 1.64

- Used as a library from `scripts/*.mjs`, not through its test runner.
- The cached Chromium is revision 1234, older than this Playwright expects, so the scripts pass an
  explicit `executablePath` found by `scripts/lib/browser.mjs` [MV].
- GPU flags: `--ignore-gpu-blocklist --use-angle=d3d11`. `--disable-gpu` gives SwiftShader, not "no
  WebGL"; `--disable-3d-apis` gives no WebGL [MV]. The scripts print the renderer string; check it
  says NVIDIA and not SwiftShader before believing a frame time.
- `recordVideo` does not run here (wrong cached ffmpeg) [MV]. For motion, take a frame sequence with
  `--t` stepping.
- Headless rAF follows this machine's 144 Hz display [O]. `smoke.mjs` records every frame interval
  with vsync on and holds the 99th percentile to the budget; treat it as a regression signal, not a
  promise about another monitor.
- **Never judge smoothness with vsync off.** With `--disable-gpu-vsync --disable-frame-rate-limit` the
  full city showed a 35 to 70 ms stall every 200 ms and the adaptive scale fell to 0.7; with vsync on
  the same tour had a worst frame of 12 ms and no stall [O]. `perf.mjs` runs uncapped only to compare
  the average cost of layers.
- Other agents' Playwright runs and CPU-heavy jobs on the same machine inflate frame times; a smoke
  run taken while siblings were working read 14 to 21 ms and was wrong [O]. Measure when idle.
- Keep review screenshots at or under 1920 px wide so they are viewed unscaled [MV].

## Browser robustness

- Wrap `new WebGLRenderer` in try/catch; three throws when context creation fails [MV].
- After a context restore, render-target contents are gone and `renderer.capabilities` is a new
  object [MV]. Re-bake anything rendered once; do not cache capabilities.
- Wrap every `localStorage` access in try/catch.

## Stale advice

| Advice | Reality at the pinned versions |
|---|---|
| `glslVersion: GLSL3` is needed for WebGL2 features | Not needed, and it breaks `gl_FragColor` [MV] |
| `outputEncoding`, `sRGBEncoding` | Gone; use `outputColorSpace` [MV] |
| `attribute.updateRange` | Replaced by `addUpdateRange` [MV] |
| `THREE.Clock` | Deprecated [MV] |
| `ToneMappingEffect` defaults to ACES | Defaults to AGX [MV] |
| `renderer.toneMapping` works with the composer | Ignored under the composer [MV] |

## Plan files

Plans follow OpenAI's ExecPlans [W: execplans], with ownership fields added so tasks can run in
parallel [W: speckit]. The rules below are the parts those sources and Anthropic's notes on
long-running agents [W: harness] agree on. They are practitioner guidance, not measured results.

### When a plan is required

- Every task in §12 has a plan, written before that task's first line of code.
- After that: any change that spans several files, has more than one reasonable approach, or touches a
  contract, ownership or a gate gets a plan (a new one, or a revision of the owning one).
- Skip it only for a small fix inside one module you own that an existing check proves. Note the fix
  under Progress in that module's plan.

### Where plans live

- `plans/T##-slug.md`, with the ids from §12. `plans/README.md` is the index.
- In the repository, not in a tool's private store such as `~/.claude/plans/`: other agents and later
  sessions must be able to read them.
- Plans are never moved, renamed or deleted. A finished plan stays as the record.

### What a plan contains

A plan must be **self-contained**: an agent with only the plan, this file, `architecture.md` and the
contracts can do the task without asking anyone. It is also a **living document**, kept current as
work proceeds. Frontmatter carries ownership; prose carries reasoning; checkboxes appear only in
Progress.

```yaml
---
id: T05-buildings
title: Neon towers
status: ready        # draft | ready | in-progress | blocked | done | abandoned
depends_on: [T00, T01, T02]
owns: [src/layers/buildings/**, tests/unit/buildings/**, plans/T05-buildings.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**]
updated: 2026-11-14
---
```

Then these headings, in this order:

1. **Purpose.** What a viewer will see or be able to do that they could not before.
2. **Context and orientation.** The paths, terms and assumptions a newcomer needs.
3. **Scope.** Owned paths, what is read-only, and explicit non-goals.
4. **Interfaces.** What the task consumes and provides, cited by path in `src/contracts/**`. Do not
   copy contract text into a plan; copies drift.
5. **Plan of work.** Milestones. Each one has a goal, the work, and a proof, and each is verifiable on
   its own. Put the riskiest or most uncertain part first, as a prototype if need be.
6. **Validation and acceptance.** Commands and what they must print, and what must be visible in which
   screenshot. Behaviour a person can check, not internal attributes. End with any **human checks**:
   things only eyes, ears or a real device can judge.
7. **Idempotence and recovery.** What is safe to re-run, and how to get back to a clean state.
8. **Progress.** Dated checkboxes. Every stopping point is recorded: what is done, what is left.
9. **Surprises and discoveries.** Unexpected behaviour, each with short evidence.
10. **Decision log.** Decision, reason, date.
11. **Contract change requests.** What is needed, why, the exact additive diff, and its state.
12. **Outcomes and retrospective.** Result against Purpose, gaps, and what was not verified.

### Status

| Status | Meaning |
|---|---|
| `draft` | Being written. No code yet. |
| `ready` | Checked against `architecture.md` and the contracts by the T00 owner. May be executed. The operator may veto or amend any plan at any time. |
| `in-progress` | Being executed. A `done` plan returns here if a defect is found in its paths. |
| `blocked` | Waiting on a contract change, a dependency or a decision; the reason is in Progress. |
| `done` | Acceptance has run, evidence is in the plan, Outcomes is written. |
| `abandoned` | Stopped on purpose, with the reason in Outcomes. |

Status lives only in the plan's frontmatter. Bump `updated` with every change.

### Keeping a plan alive

- Update Progress at every stop, so a fresh agent can resume from the plan alone.
- Log surprises and decisions when they happen, not at the end.
- If the plan and the disk disagree about what exists, the disk wins and the plan is corrected.
- Once a plan is `ready`, run it through without waiting for approval of each step. Stop only for a
  contract change or a decision that belongs to the operator.

### Deviations

- **Small course change:** amend the plan and add a Decision log entry.
- **Contract change needed:** do not widen a type locally. File the request in section 11, set
  `blocked` if you cannot continue without it, and tell the T00 owner. Additive changes are normally
  granted the same day.
- **Defect in another task's paths:** do not edit it. Record it in your plan with evidence and report
  it; the owner reopens their plan.
- **Acceptance:** never loosen a threshold to get a pass without a Decision log entry saying why.

### Parallel tasks

1. **Disjoint `owns` globs.** `npm run plans:check` fails if two plans own the same path. Run it before
   starting executors.
2. **Shared files have one owner.** T00 owns `package.json`, the lockfile, configs, contracts and
   scripts. Everyone else asks.
3. **Contracts freeze before parallel work starts.**
4. **One executor per plan,** and only the executor writes to that plan.
5. **One dev server for everyone,** started by the orchestrator on port 5180. Each task loads only its
   own layer (`?layers=`), so a sibling's half-written file cannot break your page.
6. **Screenshots go in `shots/T##/`,** which is git-ignored.
7. **Use `npm run check:task -- T##` while siblings are running.** The whole-repo `npm run check` is
   for the orchestrator once the batch has landed.
8. **Parallel executors do not commit.** The orchestrator commits each task's owned paths when the task
   reports done, so the git index is never contended.
9. **Executors run on Opus 5.5 at medium effort.** Operator direction, 2026-11-14, for every subagent
   started from then on. The nine executors for T03 to T11 were already running on the session model
   when it was given.

### On completion

1. Run the acceptance list and paste the short evidence into the plan.
2. Write Outcomes, including what was not verified.
3. Set `status: done` and bump `updated`.
4. Do not extend scope quietly. Follow-ups go in a new plan or a change request.

## Definition of done

A task is done only when all of these are true, each from a run you made yourself in this session:

1. The plan's acceptance list passes, with evidence in the plan.
2. `npm run check:task -- T##` exits 0.
3. **For anything visual, you looked.** Take screenshots with `shot.mjs`, open the images, and write
   down what you saw: at least one near view, one far view, and one from above. A still cannot show
   shimmer, so anything periodic also needs a short sequence with the camera or time stepping.
4. The shot output shows no console errors and no shader warnings you have not explained.
5. Your report lists what ran, what the result was, and what was not verified.

Never claim a check you did not run. A check proves only what it tested: `tsc` proves types, a
screenshot on the RTX says nothing about a phone, and "it renders" is not "it looks good".

## Git

- Branch `main`, remote `origin` at `https://github.com/highsierralabs/Synthwave_City`. A push to `main`
  runs `.github/workflows/pages.yml`, which builds `dist/` and, when the repository is public, deploys
  it to GitHub Pages at `https://highsierralabs.github.io/Synthwave_City/`. **A push publishes.** Check
  what a commit contains (no user-home paths, host names, addresses or secrets) before pushing, and
  push only when the operator asks (plan T14).
- Commit small and often with a plain message saying what changed; one commit per finished milestone
  or task is the norm.
- Commits use the repo-local identity already configured. No AI attribution or co-author trailers.
- `.gitattributes` pins LF against the machine-wide `core.autocrlf=true`. Leave it.
- Not tracked: `node_modules/`, `dist/`, `shots/`, `test-results/`. `docs/screenshots/` is tracked: it
  holds the README pictures, which the build does not include.
- Never force-push, rewrite history, change the remote or delete a branch.

## Sources

[execplans]: https://developers.openai.com/cookbook/articles/codex_exec_plans
[speckit]: https://github.com/github/spec-kit/blob/main/spec-driven.md
[harness]: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
[agents-md]: https://agents.md/
[cc-memory]: https://code.claude.com/docs/en/memory
[vite-features]: https://vite.dev/guide/features
[golus]: https://bgolus.medium.com/the-best-darn-grid-shader-yet-727f9278b9d8
[dispose]: https://threejs.org/manual/en/cleanup
[mdn-audio]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
[clocks]: https://web.dev/articles/audio-scheduling

The first five were fetched and read on 2026-11-14. The rest are cited through Midnight Vector's notes
and were not re-read for this project.
