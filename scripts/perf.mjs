// Frame-time survey on the dev harness with vsync off: which layers cost what.
//
//   node scripts/perf.mjs [--view high] [--q high] [--w 2560] [--h 1440] [--seconds 4] [--sets "all;sky;ground"]
//
// Each set is a comma list of layers. The default runs every layer alone, then all together.
// Needs the dev server. Headless numbers are a regression signal, not a promise about a display.
import { launch, parseArgs, serverUp } from './lib/browser.mjs';

const args = parseArgs(process.argv.slice(2));
const base = args.base ?? 'http://127.0.0.1:5180';
if (!(await serverUp(base))) {
  console.error(`dev server not reachable at ${base}. Start it with: npm run dev`);
  process.exit(2);
}
const view = String(args.view ?? 'high');
const tier = String(args.q ?? 'high');
const seconds = Number(args.seconds ?? 4);
const width = Number(args.w ?? 2560);
const height = Number(args.h ?? 1440);
const defaults = ['sky', 'ground', 'buildings', 'streetlife', 'airtraffic', 'beams', 'holograms', 'all'];
const sets = args.sets ? String(args.sets).split(';').map((s) => s.trim()).filter(Boolean) : defaults;

const browser = await launch('gpu', ['--disable-gpu-vsync', '--disable-frame-rate-limit']);
console.log(`view=${view}  q=${tier}  ${width}x${height}  ${seconds}s each, vsync off`);
console.log('layers'.padEnd(34) + 'frame ms'.padStart(10) + 'fps'.padStart(8) + 'cpu ms'.padStart(9) + 'draws'.padStart(8) + 'tris'.padStart(12) + 'scale'.padStart(7));
let failed = false;
try {
  for (const set of sets) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    try {
      await page.goto(`${base}/dev/?layers=${set}&view=${view}&q=${tier}&hud=0`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__SC_READY === true, null, { timeout: 90000 });
      await page.waitForTimeout(seconds * 1000);
      const r = await page.evaluate(() => {
        const s = window.__sc.engine.stats;
        return { frameMs: s.frameMs, fps: s.fps, cpuMs: s.cpuMs, draws: s.drawCalls, tris: s.triangles, scale: s.renderScale, errors: window.__SC_ERRORS ?? [] };
      });
      console.log(
        set.padEnd(34) + r.frameMs.toFixed(2).padStart(10) + r.fps.toFixed(0).padStart(8) + r.cpuMs.toFixed(2).padStart(9)
        + String(r.draws).padStart(8) + String(r.tris).padStart(12) + r.scale.toFixed(2).padStart(7),
      );
      for (const e of r.errors) {
        console.log(`  PAGE ERROR: ${e}`);
        failed = true;
      }
    } catch (error) {
      console.log(`${set.padEnd(34)} failed: ${error.message.split('\n')[0]}`);
      failed = true;
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
