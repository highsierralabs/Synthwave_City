---
id: T13-art-pass
title: Art pass, performance and final acceptance
status: ready
depends_on: [T00, T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12]
owns: [plans/T13-art-pass.md]
reads: [architecture.md, Agents.md, src/**, plans/**]
updated: 2026-11-14
---

# T13: art pass

## 1. Purpose

Make it one picture. Each layer was built and judged on its own; this task looks at the whole city
through the shipped page, balances the layers against each other, fixes what only shows up when they
are together, checks the performance budgets, and records honestly what the finished build does and
does not do.

## 2. Context and orientation

`architecture.md` §5 (the look), §9 (budgets), §14 (risks). This task has no paths of its own. It
runs alone, after everything else, and in that serial window it may change **numbers** in any module:
colours, intensities, densities, counts, speeds, fog and mood values, thresholds. Each change is
logged below with the file, the old and new value, and the reason. A change to structure, or a defect
that needs more than a number, goes back to the owning plan, which is reopened (`in-progress`), fixed
and closed again.

## 3. Scope

Numeric retuning anywhere; reopening other plans for defects. Non-goals: new features.

## 4. Interfaces

None of its own.

## 5. Plan of work

**M1. Survey.** Take the standard set from the built site and from the harness with all layers:
`street`, `canyon`, `roof`, `high`, `sun`, `plaza`, `mega`, `top`, plus eight frames along the tour,
in each mood. Look at every image and write down, per image, the three worst things.

**M2. Balance.** In this order: fog and far fade (does the city dissolve into the sky; is the tile
repeat ever visible); exposure, bloom and tone curve (nothing large clips; neon keeps its colour);
relative brightness of windows, trim, signs, holograms, traffic, beams (§5.2 bands); colour
distribution (magenta and cyan lead, others accent; no layer makes the frame one colour); density
(streets busy, sky layered, holograms scattered, not wallpaper). Re-shoot after each group.

**M3. Motion.** Frame sequences on the tour and in a slow free-flight pan: shimmer on facades and road
lines, popping at the far fade, anything that strobes unpleasantly. Send defects to owners.

**M4. Performance.** With `scripts/smoke.mjs` and the stats panel at 2560x1440 `high`: frame time,
draw calls, triangles against §9; then `medium` and `low`. Find the most expensive layer by turning
layers off one at a time in the harness, and trim densities or overdraw until the budget holds.
Record that headless numbers are a regression signal, not a display measurement.

**M5. Robustness run.** A 10-minute unattended tour in the smoke harness: no errors, no growth in
draw calls or geometry count, stable frame time. The loop seam: frames around `t = LOOP_SECONDS`.
Context loss and restore, hidden tab, resize, no-WebGL page.

**M6. Final record.** Update `README.md` wording if behaviour changed (through T12's plan), mark every
plan's status truthfully, collect every open human check into one list here, and write the outcome.

## 6. Validation and acceptance

- `npm run check`, `npm run build` and `npm run smoke` all exit 0.
- The final screenshot set exists in `shots/T13/` and every image has been viewed; the notes are in
  this plan.
- The §9 budgets are met at `high` on the reference GPU, or each miss is listed with numbers.
- Every plan is `done`, or says exactly why not.

Human checks: every open check from T02 to T12 is listed in Outcomes for the operator.

## 7. Idempotence and recovery

Each retune is a small diff, committed on its own or in small groups, so any of them can be reverted.

## 8. Progress

- [ ] M1 survey
- [ ] M2 balance
- [ ] M3 motion
- [ ] M4 performance
- [ ] M5 robustness run
- [ ] M6 final record

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet. Retunes are logged here as: file, value, old, new, reason.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
