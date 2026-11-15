---
id: T01-city-plan
title: The deterministic city plan
status: done
depends_on: [T00]
owns: [src/city/**, tests/unit/city/**, plans/T01-city-plan.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**]
updated: 2026-11-14
---

# T01: city plan

## 1. Purpose

Turn a seed into the city: where the districts are, every building as a stack of boxes, every traffic
lane on the ground and in the air, and every place a hologram, searchlight or beacon stands. After
this task the harness probe shows a real skyline, with downtown peaks, megatowers and open plazas,
instead of the fixture.

## 2. Context and orientation

`architecture.md` §4.4 and §4.5 define the grid and the plan. The contract is `src/contracts/city.ts`;
the constants are in `src/contracts/constants.ts`. This module is pure TypeScript: no three, no DOM,
no `Math.random`, no `Date.now` (§3.2). It runs once at start-up and must finish in well under a
second.

Coordinates are tile coordinates: x and z in `0..TILE`, y up, road surface at `y = 0`. Grid line `i`
(0 to 39) lies at `i * CELL` on its axis; cell `(cx, cz)` spans from line `cx` to line `cx + 1`. A
block is a cell minus the road corridors on its four sides.

## 3. Scope

Owns `src/city/**` and its tests. Non-goals: any rendering, any animation, street furniture positions
(the ground layer derives lamps from the grid), vehicle placement (traffic layers derive it from
lanes).

## 4. Interfaces

Provides `createCityPlan(seed: number): CityPlan` from `src/city/index.ts`. Consumes `src/core/random.ts`
and `src/core/math.ts`.

## 5. Plan of work

**M1. Districts.** A height field over the 40x40 cells, periodic across the tile edge: two or three
downtown peaks plus low-frequency noise. Classify each cell: `downtown` near peaks, `midtown` on the
slopes, `lowrise` elsewhere; about 5 percent `plaza` (never two adjacent); 10 to 14 `mega` cells, none
within three cells of another and none visible twice in one view (keep them at least 8 cells apart
where possible). Fill the `cells` array. Proof: unit test on counts and adjacency; the field is
continuous across the wrap.

**M2. Massing.** Subdivide each block into lots (1 to 9 by district), then stack boxes per lot: an
optional podium, a shaft, zero to three setbacks, an optional crown and spire. Megatowers fill most of
their block and step in several times. Plazas get no buildings, or a low ring of kiosks. Give every box
a style, two palette indices biased by the cell, a seed and flags (`roof` on the top box of a stack,
`street` on the bottom, `landmark` on megatowers). Proof: no box overlaps a road corridor; boxes of one
building nest; heights fall in the §4.5 ranges; total count between 10,000 and 22,000.

**M3. Lanes.** For every grid line and axis, street lanes at the §4.4 offsets with the right-hand rule,
and for avenues the sky lanes at the altitudes in `constants.ts`, two directions each. Proof: counts;
every lane's `fixed` coordinate lies inside its corridor; opposite directions sit on opposite sides.

**M4. Sites.** `roofLight` on spires and on the tallest roofs; `searchlight` on a share of midtown and
downtown roofs and in plazas; `pillar` on megatower tops and plaza centres; `laser` on some downtown
crowns; `ticker` rings round megatowers at two or three heights; `holoObject` over plaza centres;
`holoPanel` floating above low roofs, beside megatowers and across streets between towers, at 40 to
400 m, facing along or across the nearest road. Reject any site whose volume touches a box. Proof:
clearance test over all sites; counts per kind within stated ranges.

**M5. Queries and landmarks.** A per-cell index of boxes; `heightAt(x, z)`; `collide(pos, radius)`
pushing a sphere out of boxes, wrap-aware, and keeping `y` above a floor; `landmarks` with megatowers,
plazas and the tallest downtown block. Proof: random points inside boxes end up outside; a point in a
road corridor is never moved; a query across the tile seam works.

## 6. Validation and acceptance

- `npm run check:task -- T01` exits 0.
- Determinism: two calls with the same seed give byte-equal `boxes` and `cells`; a different seed
  differs.
- `createCityPlan` takes under 250 ms on this machine (measured in a test with a generous 1 s limit).
- `node scripts/shot.mjs --url "/dev/?layers=probe&view=top" --out shots/T01/top.png` and `view=high`:
  the skyline shows distinct peaks, megatowers and plazas, and streets are clear.

Human checks: none.

## 7. Idempotence and recovery

Pure functions; nothing persists. Delete `src/city` and restart from M1 if the structure is wrong.

## 8. Progress

- [x] 2026-11-14 M1 districts (`districts.ts`): three downtown peaks, 12 megatower cells, plazas.
- [x] 2026-11-14 M2 massing (`massing.ts`): lots, podiums, shafts, setbacks, crowns, spires, megatowers.
- [x] 2026-11-14 M3 lanes (`lanes.ts`): 520 lanes.
- [x] 2026-11-14 M4 sites (`sites.ts`), with a clearance check on every panel.
- [x] 2026-11-14 M5 queries and landmarks (`queries.ts`, `index.ts`).

Evidence:

    npm run check:task -- T01     -> PASS (18 tests)
    harness, seed 1984            -> 17,001 boxes, 520 lanes, 2,094 sites, plan built in 55 ms
    view=top and view=high        -> viewed: distinct downtown, megatowers with setbacks and spires,
                                     open plaza cells, colour neighbourhoods, clear streets

## 9. Surprises and discoveries

- The first site pass made 1,289 floating panels, which the range test rejected. Probabilities were cut
  (roofs 0.13 to 0.08, streets 0.10 to 0.055, avenues 0.16 to 0.12).
- `check:task` caught a literal-type error (`let street = BOX_FLAG.street` infers the type `2`) that
  the Vitest run did not, because Vite strips types without checking them.

## 10. Decision log

- 2026-11-14: Buildings are axis-aligned boxes only. Rotation would break the cheap collision and the
  road-corridor guarantee; variety comes from stacking, setbacks and facade styles instead.

## 11. Contract change requests

None.

- 2026-11-14, reopened after T09's report and closed again the same day. Two defects: downtown had few
  billboard sites (roof billboards stopped at 130 m, and road panels were as sparse there as in the
  suburbs), and plaza sites and landmarks used the cell centre while the block is offset 4 m beside an
  avenue. Fix: roof billboards on tall towers at 0.2, road-panel chance scaled by the skyline field
  (base 0.09 avenue, 0.04 street, times 1 to 3.5), plaza sites and landmarks at the block centre. The
  upper bound on panels in the test went from 900 to 1,300.

## 12. Outcomes and retrospective

Done. The plan is deterministic, builds in tens of milliseconds, and every invariant in section 6 is a
unit test, including a brute-force check that no hologram volume touches a box. Megatowers are not
strictly guaranteed to be invisible twice in one view; they are at least 7 cells (1,120 m) apart and
the tile repeat is 6,400 m, which the far fade (3,100 m) hides. Not verified: how the skyline reads
once real facades replace the probe; that is T05 and T13.
