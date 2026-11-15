// Finds the Chromium that Playwright has already cached, and launches it on the real GPU.
// The cached revision is older than this Playwright expects, so the path is passed explicitly.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const RELATIVE = [
  'chrome-win64/chrome.exe',
  'chrome-win/chrome.exe',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
];

export function findChromium() {
  const override = process.env.SC_CHROMIUM;
  if (override) {
    if (!existsSync(override)) throw new Error(`SC_CHROMIUM does not exist: ${override}`);
    return override;
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
    process.env.XDG_CACHE_HOME && join(process.env.XDG_CACHE_HOME, 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ];
  let best;
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!name.startsWith('chromium-')) continue;
      const revision = Number(name.slice('chromium-'.length));
      if (!Number.isInteger(revision) || (best && revision <= best.revision)) continue;
      for (const rel of RELATIVE) {
        const path = join(root, name, rel);
        if (existsSync(path)) { best = { revision, path }; break; }
      }
    }
  }
  return best?.path;
}

/** mode: 'gpu' (default), 'software' (SwiftShader) or 'nowebgl'. */
export async function launch(mode = 'gpu', extraArgs = []) {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error('No cached Chromium found. Set SC_CHROMIUM to a Chrome executable, or run: npx playwright install chromium');
  }
  const args = {
    gpu: ['--ignore-gpu-blocklist', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
    software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    nowebgl: ['--disable-3d-apis'],
  }[mode];
  if (!args) throw new Error(`unknown browser mode: ${mode}`);
  return chromium.launch({ executablePath, headless: true, args: [...args, ...extraArgs] });
}

/** Parse --name value pairs and bare --flags. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export async function serverUp(base, path = '/@vite/client') {
  try {
    const res = await fetch(base + path);
    return res.ok;
  } catch {
    return false;
  }
}
