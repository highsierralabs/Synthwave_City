// The dev harness: mounts any subset of layers with a fixed or free camera.
//
//   /dev/?layers=sky,buildings      which layers (comma list, 'all', and/or 'probe'); default all
//        &view=high                 a named view (dev/views.ts), or
//        &cam=x,y,z,yaw,pitch       an exact camera (metres, radians)
//        &t=12                      freeze time at this many seconds
//        &q=high                    quality tier
//        &mood=sunset               mood
//        &post=0                    bypass src/post
//        &seed=1984                 city seed
//        &hud=0                     hide the overlay
//        &rig=1                     use src/camera's rig instead of the harness fly camera
//
// It sets window.__SC_READY once frames are on screen, and exposes window.__sc for scripts/shot.mjs.
import type { CameraDriver } from '../src/contracts/camera';
import type { CityPlan } from '../src/contracts/city';
import type { Layer } from '../src/contracts/layer';
import { MOODS, type MoodId } from '../src/contracts/moods';
import { QUALITY, type QualityTier } from '../src/contracts/quality';
import { createEngine, availableLayers } from '../src/engine/engine';
import { createFixturePlan } from './fixturePlan';
import { createFlyCamera } from './flyCamera';
import { createProbeLayer } from './probe/index';
import { computeViews, type View } from './views';

interface CityModule { createCityPlan(seed: number): CityPlan }
interface RigModule {
  createCameraRig(plan: CityPlan, options?: object): CameraDriver & { attachInput?(element: HTMLElement): () => void };
}
const cityModules = import.meta.glob<CityModule>('../src/city/index.ts');
const rigModules = import.meta.glob<RigModule>('../src/camera/index.ts');

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

async function main(): Promise<void> {
  const seed = Number(params.get('seed') ?? 1984);
  const loadCity = cityModules['../src/city/index.ts'];
  const t0 = performance.now();
  const plan = loadCity ? (await loadCity()).createCityPlan(seed) : createFixturePlan(seed);
  const planMs = performance.now() - t0;

  const tier = (params.get('q') ?? 'high') as QualityTier;
  const quality = QUALITY[tier] ?? QUALITY.high;
  const moodParam = params.get('mood') ?? 'sunset';
  const mood: MoodId = moodParam in MOODS ? (moodParam as MoodId) : 'sunset';

  const requested = (params.get('layers') ?? 'all').split(',').map((s) => s.trim()).filter(Boolean);
  const extraLayers: Layer[] = requested.includes('probe') ? [createProbeLayer()] : [];
  const named = requested.filter((id) => id !== 'probe' && id !== 'all');
  const layers = requested.includes('all') ? 'all' : named;

  const engine = await createEngine({
    canvas, plan, quality, layers, extraLayers, mood, seed, usePipeline: params.get('post') !== '0',
  });

  const views = computeViews(plan);
  const setCam = (x: number, y: number, z: number, yaw: number, pitch: number): void => {
    engine.pose.x = x; engine.pose.y = y; engine.pose.z = z; engine.pose.yaw = yaw; engine.pose.pitch = pitch;
  };
  const setView = (name: string): boolean => {
    const v: View | undefined = views[name];
    if (!v) return false;
    setCam(v.x, v.y, v.z, v.yaw, v.pitch);
    return true;
  };
  const cam = params.get('cam');
  if (cam) {
    const n = cam.split(',').map(Number);
    setCam(n[0] ?? 3200, n[1] ?? 200, n[2] ?? 3200, n[3] ?? 0, n[4] ?? 0);
  } else if (!setView(params.get('view') ?? 'high')) {
    setView('high');
  }

  const loadRig = rigModules['../src/camera/index.ts'];
  if (params.get('rig') === '1' && loadRig) {
    const rig = (await loadRig()).createCameraRig(plan, {});
    rig.attachInput?.(canvas);
    engine.setCameraDriver(rig);
  } else {
    engine.setCameraDriver(createFlyCamera(canvas));
  }

  const t = params.get('t');
  if (t !== null) engine.clock.freezeAt(Number(t));

  addEventListener('resize', () => engine.resize());

  // ---- script API (scripts/shot.mjs)
  const probe = document.createElement('canvas');
  probe.width = 256;
  probe.height = 144;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true })!;
  const api = {
    engine,
    views,
    setCam,
    setView,
    freeze: (time: number): void => engine.clock.freezeAt(time),
    /** Draw a frame and return simple image statistics. Must read back in the same task as the draw. */
    measure(): { mean: number; clipped: number; black: number } {
      engine.renderNow();
      probeCtx.drawImage(canvas, 0, 0, probe.width, probe.height);
      const data = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
      let sum = 0, clipped = 0, black = 0;
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
        sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (r >= 250 && g >= 250 && b >= 250) clipped++;
        if (r <= 3 && g <= 3 && b <= 3) black++;
      }
      return { mean: sum / pixels, clipped: clipped / pixels, black: black / pixels };
    },
    info(): Record<string, unknown> {
      const gl = engine.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        layers: engine.layerIds,
        available: availableLayers(),
        pipeline: engine.pipelineKind,
        boxes: plan.boxCount,
        lanes: plan.lanes.length,
        sites: plan.sites.length,
        planMs: Math.round(planMs),
        drawCalls: engine.stats.drawCalls,
        triangles: engine.stats.triangles,
        fps: Math.round(engine.stats.fps),
        cpuMs: Number(engine.stats.cpuMs.toFixed(2)),
        renderScale: engine.stats.renderScale,
        errors: [...engine.errors],
      };
    },
  };
  (window as unknown as { __sc: typeof api }).__sc = api;

  // ---- overlay
  if (params.get('hud') === '0') hud.style.display = 'none';
  setInterval(() => {
    if (hud.style.display === 'none') return;
    const s = engine.stats;
    const p = engine.pose;
    const lines = [
      `${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms  cpu ${s.cpuMs.toFixed(2)} ms  scale ${s.renderScale.toFixed(2)}`,
      `${s.drawCalls} draws  ${(s.triangles / 1e6).toFixed(2)} M tris  ${engine.pipelineKind}  ${quality.tier}`,
      `layers: ${engine.layerIds.join(', ') || '(none)'}`,
      `cam=${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)},${p.yaw.toFixed(2)},${p.pitch.toFixed(2)}  t=${engine.clock.time.toFixed(1)}`,
    ];
    hud.textContent = lines.join('\n');
    if (engine.errors.length > 0) {
      const err = document.createElement('span');
      err.className = 'err';
      err.textContent = '\n' + engine.errors.join('\n');
      hud.appendChild(err);
    }
  }, 250);

  engine.start();
  let frames = 0;
  const waitFrames = (): void => {
    if (++frames >= 4) (window as unknown as { __SC_READY: boolean }).__SC_READY = true;
    else requestAnimationFrame(waitFrames);
  };
  requestAnimationFrame(waitFrames);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  hud.textContent = `Failed to start: ${message}`;
  hud.style.color = '#ff6a8a';
  const w = window as unknown as { __SC_ERRORS?: string[]; __SC_READY?: boolean };
  (w.__SC_ERRORS ??= []).push(`harness: ${message}`);
  w.__SC_READY = true;
  console.error(error);
});
