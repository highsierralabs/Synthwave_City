// Take reproducible screenshots of the dev harness on the real GPU.
//
//   node scripts/shot.mjs --url "/dev/?layers=sky,buildings&view=high&t=12" --out shots/T05/high.png
//
// Options:
//   --url     harness path and query (required). hud=0 is added unless --hud is given.
//   --out     PNG path (required). With --frames N the files are name_0.png .. name_N-1.png.
//   --w --h   viewport, default 1600 x 900.
//   --frames  number of frames in a sequence (default 1).
//   --t0      time of the first frame in a sequence, seconds (default: the t in the url, else 10).
//   --dt      time step between frames, seconds (default 0).
//   --move    camera step per frame "dx,dy,dz" in metres (default none).
//   --turn    yaw step per frame, radians.
//   --mode    gpu (default) | software | nowebgl.
//   --wait    extra milliseconds to wait before the first capture (default 400).
//
// Needs the dev server: npm run dev. Exits non-zero if the page reports an error.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launch, parseArgs, serverUp } from './lib/browser.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.out) {
  console.error('usage: node scripts/shot.mjs --url "/dev/?layers=...&view=high&t=12" --out shots/T##/name.png');
  process.exit(2);
}
const base = args.base ?? 'http://127.0.0.1:5180';
if (!(await serverUp(base))) {
  console.error(`dev server not reachable at ${base}. Start it with: npm run dev`);
  process.exit(2);
}
let url = String(args.url);
if (!args.hud && !/[?&]hud=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'hud=0';
const width = Number(args.w ?? 1600);
const height = Number(args.h ?? 900);
const frames = Number(args.frames ?? 1);
const dt = Number(args.dt ?? 0);
const move = args.move ? String(args.move).split(',').map(Number) : null;
const turn = args.turn ? Number(args.turn) : 0;
const urlT = /[?&]t=([\d.]+)/.exec(url);
const t0 = Number(args.t0 ?? (urlT ? urlT[1] : 10));
const out = resolve(String(args.out));
mkdirSync(dirname(out), { recursive: true });

const browser = await launch(String(args.mode ?? 'gpu'));
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const consoleErrors = [];
const consoleWarnings = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
  else if (msg.type() === 'warning') consoleWarnings.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

let failed = false;
try {
  await page.goto(base + url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__SC_READY === true, null, { timeout: 90000 });
  await page.waitForTimeout(Number(args.wait ?? 400));
  const hasApi = await page.evaluate(() => typeof window.__sc === 'object');
  for (let i = 0; i < frames; i++) {
    let stats = null;
    if (hasApi) {
      stats = await page.evaluate(({ i, t0, dt, move, turn, sequence }) => {
        const sc = window.__sc;
        const p = sc.engine.pose;
        if (sequence) sc.freeze(t0 + i * dt);
        if (i > 0 && move) sc.setCam(p.x + move[0], p.y + move[1], p.z + move[2], p.yaw + turn, p.pitch);
        else if (i > 0 && turn) sc.setCam(p.x, p.y, p.z, p.yaw + turn, p.pitch);
        return sc.measure();
      }, { i, t0, dt, move, turn, sequence: frames > 1 });
      await page.waitForTimeout(80);
    }
    const file = frames > 1 ? out.replace(/\.png$/i, `_${i}.png`) : out;
    await page.screenshot({ path: file });
    const s = stats ? `mean ${stats.mean.toFixed(1)}/255  clipped ${(stats.clipped * 100).toFixed(2)}%  black ${(stats.black * 100).toFixed(1)}%` : '';
    console.log(`wrote ${file}  ${s}`);
  }
  if (hasApi) {
    const info = await page.evaluate(() => window.__sc.info());
    console.log(`renderer: ${info.renderer}`);
    console.log(`layers: ${info.layers.join(', ') || '(none)'}   pipeline: ${info.pipeline}   boxes ${info.boxes}  lanes ${info.lanes}  sites ${info.sites}  plan ${info.planMs} ms`);
    console.log(`draw calls ${info.drawCalls}   triangles ${info.triangles}   fps ${info.fps}   cpu ${info.cpuMs} ms   scale ${info.renderScale}`);
    if (!/NVIDIA|AMD|Radeon|Intel|Apple/i.test(String(info.renderer)) && (args.mode ?? 'gpu') === 'gpu') {
      console.log('WARNING: the renderer string does not name a hardware GPU; frame times mean nothing.');
    }
  }
  const pageErrors = await page.evaluate(() => window.__SC_ERRORS ?? []);
  for (const e of pageErrors) console.log(`PAGE ERROR: ${e}`);
  for (const e of consoleErrors) console.log(`CONSOLE ERROR: ${e}`);
  for (const e of consoleWarnings.slice(0, 12)) console.log(`console warning: ${e.slice(0, 400)}`);
  if (pageErrors.length > 0 || consoleErrors.length > 0) failed = true;
} catch (error) {
  console.error(`shot failed: ${error.message}`);
  for (const e of consoleErrors) console.log(`CONSOLE ERROR: ${e}`);
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
