# Plans

One plan per task in `architecture.md` §12. The rules for writing and keeping plans are in
`Agents.md`, "Plan files". Status lives in each plan's frontmatter; this index only lists them.

| Plan | What it delivers | Needs |
|---|---|---|
| [T00-foundation](T00-foundation.md) | Tooling, frozen contracts, core, engine, dev harness, scripts | none |
| [T01-city-plan](T01-city-plan.md) | The deterministic city: cells, boxes, lanes, sites, collision | T00 |
| [T02-pipeline](T02-pipeline.md) | Reflection pass, bloom, tone map, grade, adaptive resolution | T00 |
| [T03-sky](T03-sky.md) | Gradient sky, striped sun, stars, wireframe mountains, haze | T00 to T02 |
| [T04-ground](T04-ground.md) | Streets, markings, plazas, wet reflections, street lamps | T00 to T02 |
| [T05-buildings](T05-buildings.md) | Neon towers and their facades | T00 to T02 |
| [T06-street-life](T06-street-life.md) | Ground traffic and crowds | T00 to T02 |
| [T07-air-traffic](T07-air-traffic.md) | Flying vehicles and hero ships | T00 to T02 |
| [T08-light-shafts](T08-light-shafts.md) | Searchlights, beacon pillars, laser fans | T00 to T02 |
| [T09-holograms](T09-holograms.md) | Floating billboards and wire holograms | T00 to T02 |
| [T10-audio](T10-audio.md) | Generative soundtrack, ambience, the beat | T00 |
| [T11-camera](T11-camera.md) | Free flight, collision response, tour, viewpoints, input | T00, T01 |
| [T12-app-shell](T12-app-shell.md) | The shipped page: boot, menu, HUD, settings | all above |
| [T13-art-pass](T13-art-pass.md) | Cross-layer balance, performance, final acceptance | all above |

Order: `T00 -> T01, T02 -> T03 .. T11 in parallel -> T12 -> T13`.

Every layer plan shares the same working loop, so it is stated once here:

1. Start from the dev harness: `http://127.0.0.1:5180/dev/?layers=<yours>`, with other layers added to
   the list when you want context (for example `layers=sky,ground,<yours>`).
2. Take screenshots with `node scripts/shot.mjs --url "/dev/?layers=...&view=<name>&t=<s>" --out shots/T##/<name>.png`
   and open them. The harness's named views (`street`, `canyon`, `roof`, `high`, `sun`, `plaza`,
   `mega`, `top`) are derived from the plan, so they are the same for everyone; `cam=x,y,z,yaw,pitch`
   gives an exact camera.
3. Gate with `npm run check:task -- T##`.
