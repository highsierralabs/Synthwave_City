// Smoke run of the built site: build, serve dist/, boot in Chromium on the GPU, and check that it
// starts without errors, draws a non-empty frame and holds a frame-time budget.
//
//   node scripts/smoke.mjs [--seconds 6] [--q high] [--w 1920] [--h 1080] [--budget 16.6] [--no-build]
//                          [--out shots/smoke.png] [--mode gpu|software|nowebgl]
//
// The page under test is index.html (T12). It must set window.__SC_READY and expose window.__sc
// with info() and measure(), like the dev harness does.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launch, parseArgs, serverUp } from './lib/browser.mjs';

const args = parseArgs(process.argv.slice(2));
const base = 'http://127.0.0.1:5181';
const seconds = Number(args.seconds ?? 6);
const budget = Number(args.budget ?? 16.6);
const mode = String(args.mode ?? 'gpu');
const out = resolve(String(args.out ?? 'shots/smoke.png'));
mkdirSync(dirname(out), { recursive: true });
const vite = resolve('node_modules/vite/bin/vite.js');

if (!args['no-build']) {
  const build = spawnSync(process.execPath, [vite, 'build'], { stdio: 'inherit' });
  if (build.status !== 0) {
    console.error('FAIL: build failed');
    process.exit(1);
  }
}

const server = spawn(process.execPath, [vite, 'preview'], { stdio: 'ignore' });
let failed = false;
const fail = (message) => {
  console.log(`FAIL: ${message}`);
  failed = true;
};
let browser;
try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    up = await serverUp(base, '/');
    if (!up) await new Promise((r) => setTimeout(r, 200));
  }
  if (!up) throw new Error('preview server did not start on ' + base);

  browser = await launch(mode, ['--disable-gpu-vsync', '--disable-frame-rate-limit']);
  const page = await browser.newPage({
    viewport: { width: Number(args.w ?? 1920), height: Number(args.h ?? 1080) },
    deviceScaleFactor: 1,
  });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(`${base}/?autostart=1&q=${args.q ?? 'high'}`, { waitUntil: 'load', timeout: 60000 });
  if (mode === 'nowebgl') {
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    console.log('page text without WebGL: ' + text.replace(/\s+/g, ' ').slice(0, 200));
    if (!/webgl/i.test(text)) fail('the page does not explain that WebGL is missing');
    await page.screenshot({ path: out });
  } else {
    await page.waitForFunction(() => window.__SC_READY === true, null, { timeout: 90000 });
    await page.waitForTimeout(seconds * 1000);
    const info = await page.evaluate(() => window.__sc.info());
    const frame = await page.evaluate(() => {
      const s = window.__sc.engine.stats;
      return { frameMs: s.frameMs, cpuMs: s.cpuMs, fps: s.fps };
    });
    const image = await page.evaluate(() => window.__sc.measure());
    await page.screenshot({ path: out });
    console.log(`renderer: ${info.renderer}`);
    console.log(`layers: ${info.layers.join(', ')}   pipeline: ${info.pipeline}`);
    console.log(`draw calls ${info.drawCalls}   triangles ${info.triangles}   scale ${info.renderScale}`);
    console.log(`frame ${frame.frameMs.toFixed(2)} ms (${frame.fps.toFixed(0)} fps, vsync off)   cpu ${frame.cpuMs.toFixed(2)} ms`);
    console.log(`image mean ${image.mean.toFixed(1)}/255   clipped ${(image.clipped * 100).toFixed(2)}%   black ${(image.black * 100).toFixed(1)}%`);
    console.log(`screenshot: ${out}`);
    const pageErrors = await page.evaluate(() => window.__SC_ERRORS ?? []);
    for (const e of pageErrors) fail(`page error: ${e}`);
    if (info.layers.length === 0) fail('no layers mounted');
    if (image.mean < 2) fail('the frame is black');
    if (image.clipped > 0.5) fail('more than half the frame is clipped white');
    if (mode === 'gpu' && frame.frameMs > budget) fail(`frame time ${frame.frameMs.toFixed(2)} ms is over the ${budget} ms budget`);
    if (mode === 'gpu' && !/NVIDIA|AMD|Radeon|Intel|Apple/i.test(String(info.renderer))) {
      console.log('WARNING: not a hardware GPU; the frame time means nothing.');
    }
  }
  for (const e of consoleErrors) fail(`console error: ${e}`);
} catch (error) {
  fail(error.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
process.exit(failed ? 1 : 0);
