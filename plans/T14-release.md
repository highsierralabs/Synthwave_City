---
id: T14-release
title: Public release on GitHub and GitHub Pages
status: done
depends_on: [T00, T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13]
owns: [LICENSE, THIRD-PARTY-NOTICES.md, CONTRIBUTING.md, .github/**, docs/screenshots/**, plans/T14-release.md]
reads: [architecture.md, Agents.md, README.md, package.json, plans/**]
updated: 2026-11-14
---

# T14: release

## 1. Purpose

Put Synthwave City on GitHub at `highsierralabs/Synthwave_City`, set up the way Midnight Vector is:
MIT-licensed source, and the built site served by GitHub Pages at
`https://highsierralabs.github.io/Synthwave_City/` from a workflow that runs on every push to `main`.
After this task anyone with the link can open the city in a browser.

## 2. Context and orientation

The operator asked for this on 2026-11-14: "I want to set this up on my highsierralabs github at
https://github.com/highsierralabs/Synthwave_City like we have Midnight_Vector setup. Same MIT license."

Facts read before any change:

- `highsierralabs/Synthwave_City` exists, created by the operator on 2026-11-15T05:28Z, **private** and
  empty. `gh` is signed in as `highsierralabs` with `repo` and `workflow` scopes.
- `highsierralabs/Midnight_Vector` is public, MIT, with Pages built by a workflow
  (`build_type: workflow`), force pushes and deletions disallowed on `main`, seven topics, a
  description and a homepage. Its release ran in two gates: push while private, then the operator
  released the switch to public.
- On the free plan, Pages serves only public repositories and branch protection needs a public
  repository, so nothing is served and `main` cannot be protected until the repository is public.
- This repository has 28 local commits, all authored by the repo-local identity (the operator's
  GitHub noreply address), no remote.

## 3. Scope

Owned: the licence, notices, contributing file, the workflow, README screenshots, this plan.

Changes outside `owns`, each through its owner:

| Path | Owner | Change |
|---|---|---|
| `package.json`, `package-lock.json` | T00 | `license`, `homepage`, `repository`; the lockfile root entry gains the licence. `"private": true` stays: it concerns the npm registry, not the repository |
| `README.md` | T12 | play link, screenshots, licence section, what has been tested |
| `Agents.md`, `architecture.md`, `plans/README.md` | orchestrator | Git section; task row; index row |

Outside the repository: GitHub settings; the workspace `CLAUDE.md` above this folder, which the
operator asked to have this project added to.

Non-goals: any change to the app; a custom domain; releases or tags.

## 4. Plan of work

**M1. Audit.** Search every tracked file for user-home paths, host names, tailnet addresses, e-mail
addresses and secrets; confirm every commit author; confirm nothing large or binary is tracked by
accident.

**M2. Release files.** `LICENSE` (MIT, the same holder and year as Midnight Vector),
`THIRD-PARTY-NOTICES.md` (the licence texts of three and postprocessing, copied from the installed
packages), `CONTRIBUTING.md`, `.github/workflows/pages.yml` (the Midnight Vector workflow: pinned
action commits, Node 24.14.1, `npm ci`, `npm run build`, licence files copied into `dist/`, deploy
job skipped while the repository is private), package metadata, README, screenshots taken from the
build.

**M3. Local checks.** `npm run check`, `npm run build`, `npm run smoke`; then a fresh clone of the
local repository builds with `npm ci` and `npm run build`, proving the tracked files are sufficient.

**Gate 1. Push.** Add `origin`, push `main` to the private repository. Authorised by the request
quoted above.

**M4. Remote build.** The workflow's `build` job passes on GitHub; `deploy` is skipped because the
repository is private.

**Gate 2. Public.** Switching the repository to public publishes the source and, once Pages is on,
the site. It cannot be taken back in any practical sense. This step waits for the operator's
explicit release.

**M5. Publish settings**, after Gate 2: visibility public; Pages enabled with the workflow as its
source; workflow run; description, homepage and topics; `main` protected against force pushes and
deletion; dependency alerts, private vulnerability reporting, secret scanning and push protection.
Each is read back through the API.

**M6. Notes.** Workspace `CLAUDE.md` gains this project; the session memory records the release.

## 5. Validation and acceptance

| Id | Check | Expected |
|---|---|---|
| A1 | The audit of M1 | no user-home path, host name, address or secret in a tracked file; one author |
| A2 | `npm run check` | exit 0 |
| A3 | `npm run build`, `npm run smoke` | exit 0, SMOKE OK |
| A4 | Fresh clone: `npm ci`, `npm run build` | exit 0 |
| A5 | Licence texts in `THIRD-PARTY-NOTICES.md` | byte-equal to `node_modules/three/LICENSE` and `node_modules/postprocessing/LICENSE.md` |
| A6 | After Gate 1: `git ls-remote origin` | one ref, `main`, at the local head |
| A7 | The workflow run for that commit | `build` succeeds |
| A8 | After Gate 2: visibility, Pages API, workflow run | `public`; `build_type` `workflow`; `build` and `deploy` succeed |
| A9 | `https://highsierralabs.github.io/Synthwave_City/` in Chromium | boots to the title, no console errors, a non-empty frame |
| A10 | Settings read back | description, homepage, topics; force pushes and deletions disallowed on `main`; security features on |

Human checks: H-T14-1, the operator opens the public link on a device of their own.

## 6. Idempotence and recovery

Everything before Gate 1 is local and can be redone. A push to a private repository can be followed
by further pushes; history is never rewritten. After Gate 2 the settings can each be read back and
set again, but publication itself cannot be undone: assume anything pushed has been copied.

## 7. Progress

- [x] 2026-11-14 M1 audit. **A1 passes.** `git grep` over every tracked file for the user-home name,
  the tailnet and host names, `AppData`, token prefixes: 0 lines (one unrelated hit, the
  `LOCALAPPDATA` environment variable name in `scripts/lib/browser.mjs`). Two files mention the
  workspace folder `C:\highsierralabs`, which Midnight Vector's public plans already do. All commits
  have one author, the GitHub noreply address. Largest tracked file before screenshots: the lockfile,
  90 kB.
- [x] 2026-11-14 M2 release files. `LICENSE` and the workflow copied from Midnight Vector unchanged;
  `THIRD-PARTY-NOTICES.md` from the same source with the two sentences that name the project changed;
  **A5 passes** (both licence texts found byte for byte against `node_modules`). `CONTRIBUTING.md`,
  package metadata, README (play link, four screenshots at 1280x720 taken from the build with
  `shot.mjs`, licence and contributing sections, an honest tested-on paragraph), `Agents.md` Git
  section, the T14 rows in `architecture.md` and `plans/README.md`.
- [x] 2026-11-14 M3 local checks. **A2:** `npm run check` exit 0, 341 tests. **A3:** `npm run build` and
  `npm run smoke` pass (865 frames in 6 s, p99 7.1 ms, none over 50 ms). **A4:** a fresh `git clone`
  of the local repository, `npm ci`, `npm run build`: exit 0, clean tree, `dist/` complete.
- [x] 2026-11-14 **Gate 1.** `origin` added; `git push -u origin main`. **A6 passes:** `git ls-remote
  origin` shows `HEAD` and `refs/heads/main` at `e55774a`, the local head. The repository was private.
- [x] 2026-11-14 M4 remote build. **A7 passes:** Actions run 43681902846 for `e55774a`, event `push`:
  job `build` success (checkout, Node 24.14.1, `npm ci`, `npm run build`, licence copy, artifact
  upload); job `deploy` skipped, as designed for a private repository. One annotation: the
  `ubuntu-latest` label will move to Ubuntu 26.
- [x] 2026-11-14 M6, first half: the workspace `CLAUDE.md` now lists the project (table row, the
  instruction-files list, and a Synthwave_City section with commands and gotchas).
- [x] 2026-11-14 **Gate 2 released by the operator**, who chose "Make it public (Recommended)" when
  asked whether to release the step. `git ls-remote origin` read `main` at `bdfaf43`, the local head,
  immediately before. `gh repo edit --visibility public --accept-visibility-change-consequences`; the
  API then read `public`.
- [x] 2026-11-14 M5 publish settings.
  - Pages: `POST .../pages` with `build_type=workflow` returned
    `https://highsierralabs.github.io/Synthwave_City/`, HTTPS enforced.
  - **A8 passes.** Actions run 43682115857 for `bdfaf43`, event `workflow_dispatch`: `build` success,
    `deploy` success.
  - **A9 passes.** The public address in Chromium on the GPU (`shots/T14/live.mjs`): HTTP 200, title
    "Synthwave City", state `title`, seven layers, the `post` pipeline, 59 draw calls, image mean
    86.3/255, 0 page errors, 0 console errors; `LICENSE` is served beside the page.
  - **A10 passes,** read back through the API: public; the description "An endless 80s synthwave
    megacity you fly through in your browser."; the homepage; topics `creative-coding`, `glsl`,
    `procedural-generation`, `synthwave`, `threejs`, `typescript`, `webgl`; licence detected as MIT; wiki
    off; on `main`, force pushes and deletions disallowed with admins included; dependency alerts,
    private vulnerability reporting, secret scanning and push protection on.
- [x] 2026-11-14 M6 notes: the workspace `CLAUDE.md` entry says the repository is public, and the
  session memory records that a push to `main` publishes.

## 8. Surprises and discoveries

- None in the release itself. The repository already existed, private and empty, created by the
  operator minutes before the request, so no repository was created here.

## 9. Decision log

- 2026-11-14: Published from the source repository, as Midnight Vector is, not from a build-only
  repository. Plans, Agents.md and architecture.md are part of what is published.
- 2026-11-14: Two gates, as in the Midnight Vector release. The push to a private repository is covered
  by the request; the switch to public is a separate, irreversible act and gets its own release.
- 2026-11-14: README screenshots are tracked under `docs/screenshots/`. They are documentation, not
  assets of the app: the build does not include them (R2 is about what the app loads).

## 10. Contract change requests

None.

## 11. Outcomes and retrospective

Done. `highsierralabs/Synthwave_City` is public and MIT-licensed, and the city is served at
`https://highsierralabs.github.io/Synthwave_City/` by a workflow that runs on every push to `main`,
with the same settings as Midnight Vector. Every acceptance row passed and is recorded above.

Not verified: the public page on any device or browser other than headless Chromium on the build
machine (H-T14-1 is open); the workflow on a later Ubuntu runner image; Dependabot security updates,
which are left off as they are on a default repository.

From here on a push to `main` is a publication. The commit that records this section is itself
pushed, which redeploys the same site.
