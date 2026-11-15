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
//
// The dev server reloads the page when a file it imports changes, which happens while other tasks
// are editing. A capture that straddles a reload is detected (the page's load time changes) and the
// whole shot is retried, up to three times.
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

class Reloaded extends Error {}
const RELOAD_SIGNS = /Execution context was destroyed|navigation|reading 'info'|reading 'engine'|Target page, context or browser has been closed/i;

/** One complete attempt. Returns { lines, failed } or throws Reloaded. */
async function attempt(browser) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    else if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  const lines = [];
  try {
    await page.goto(base + url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__SC_READY === true, null, { timeout: 90000 });
    await page.waitForTimeout(Number(args.wait ?? 400));
    const loadedAt = await page.evaluate(() => performance.timeOrigin);
    const stillSamePage = async () => {
      const now = await page.evaluate(() => (window.__SC_READY === true ? performance.timeOrigin : -1));
      if (now !== loadedAt) throw new Reloaded('the page reloaded during the shot');
    };
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
      await stillSamePage();
      const s = stats ? `mean ${stats.mean.toFixed(1)}/255  clipped ${(stats.clipped * 100).toFixed(2)}%  black ${(stats.black * 100).toFixed(1)}%` : '';
      lines.push(`wrote ${file}  ${s}`);
    }
    if (hasApi) {
      const info = await page.evaluate(() => window.__sc.info());
      lines.push(`renderer: ${info.renderer}`);
      lines.push(`layers: ${info.layers.join(', ') || '(none)'}   pipeline: ${info.pipeline}   boxes ${info.boxes}  lanes ${info.lanes}  sites ${info.sites}  plan ${info.planMs} ms`);
      lines.push(`draw calls ${info.drawCalls}   triangles ${info.triangles}   fps ${info.fps}   cpu ${info.cpuMs} ms   scale ${info.renderScale}`);
      if (!/NVIDIA|AMD|Radeon|Intel|Apple/i.test(String(info.renderer)) && (args.mode ?? 'gpu') === 'gpu') {
        lines.push('WARNING: the renderer string does not name a hardware GPU; frame times mean nothing.');
      }
    }
    const pageErrors = await page.evaluate(() => window.__SC_ERRORS ?? []);
    await stillSamePage();
    for (const e of pageErrors) lines.push(`PAGE ERROR: ${e}`);
    for (const e of consoleErrors) lines.push(`CONSOLE ERROR: ${e}`);
    for (const e of consoleWarnings.slice(0, 12)) lines.push(`console warning: ${e.slice(0, 400)}`);
    return { lines, failed: pageErrors.length > 0 || consoleErrors.length > 0 };
  } catch (error) {
    if (error instanceof Reloaded || RELOAD_SIGNS.test(String(error.message))) throw new Reloaded(error.message);
    lines.push(`shot failed: ${error.message}`);
    for (const e of consoleErrors) lines.push(`CONSOLE ERROR: ${e}`);
    return { lines, failed: true };
  } finally {
    await page.close().catch(() => {});
  }
}

const browser = await launch(String(args.mode ?? 'gpu'));
let result = null;
try {
  for (let tries = 1; tries <= 3 && !result; tries++) {
    try {
      result = await attempt(browser);
    } catch (error) {
      if (!(error instanceof Reloaded)) throw error;
      console.log(`retrying (${tries}/3): ${error.message.split('\n')[0]}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
} finally {
  await browser.close();
}
if (!result) {
  console.error('shot failed: the page kept reloading; another task is probably saving files. Try again.');
  process.exit(1);
}
for (const line of result.lines) console.log(line);
process.exit(result.failed ? 1 : 0);
