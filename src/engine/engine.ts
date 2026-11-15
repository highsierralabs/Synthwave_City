// The engine (architecture.md section 3): renderer, frame loop, shared uniforms and the layer host.
// It finds layers and the pipeline through lazy globs and never imports one by name.
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { BeatSource } from '../contracts/audio';
import type { CameraDriver, CameraPose } from '../contracts/camera';
import type { CityPlan } from '../contracts/city';
import {
  CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, LOOP_SECONDS, SC_LAYER_NO_REFLECT, TILE,
} from '../contracts/constants';
import {
  LAYER_ORDER, type FramePipeline, type FrameState, type Layer, type LayerModule, type PipelineModule, type SharedUniforms,
} from '../contracts/layer';
import { MOODS, type MoodId } from '../contracts/moods';
import type { QualitySettings } from '../contracts/quality';
import { LoopClock } from '../core/clock';
import { wrap } from '../core/math';
import { hashInts } from '../core/random';
import { createBasicPipeline } from './basicPipeline';
import { createSharedUniforms, MoodDriver } from './uniforms';

const layerModules = import.meta.glob<LayerModule>('../layers/*/index.ts');
const pipelineModules = import.meta.glob<PipelineModule>('../post/index.ts');

/** Ids of the layers present on disk, in init order. */
export function availableLayers(): string[] {
  const found = Object.keys(layerModules).map((path) => path.split('/')[2]!);
  const known = LAYER_ORDER.filter((id) => found.includes(id)) as string[];
  return [...known, ...found.filter((id) => !known.includes(id)).sort()];
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  plan: CityPlan;
  quality: QualitySettings;
  /** Layer ids to mount, or 'all'. Unknown ids are reported and skipped. */
  layers?: readonly string[] | 'all';
  /** Layers supplied directly (the dev probe). */
  extraLayers?: readonly Layer[];
  /** false bypasses src/post and uses the fallback pipeline. */
  usePipeline?: boolean;
  mood?: MoodId;
  seed?: number;
  onProgress?: (fraction: number, label: string) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface EngineStats {
  fps: number;
  /** Smoothed time between frames, ms. */
  frameMs: number;
  /** Smoothed CPU time inside one frame, ms. */
  cpuMs: number;
  drawCalls: number;
  triangles: number;
  renderScale: number;
  frames: number;
}

export interface Engine {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly uniforms: SharedUniforms;
  readonly plan: CityPlan;
  readonly quality: QualitySettings;
  /** The pose the next frame is drawn from. A camera driver overwrites it every frame. */
  readonly pose: CameraPose;
  readonly clock: LoopClock;
  readonly stats: EngineStats;
  /** Ids of layers that initialised. */
  readonly layerIds: readonly string[];
  /** Human-readable problems: layers that failed, shader errors. Also on window.__SC_ERRORS. */
  readonly errors: readonly string[];
  /** 'post' or 'basic'. */
  readonly pipelineKind: string;
  readonly running: boolean;
  start(): void;
  stop(): void;
  /** Freeze time at t seconds and draw one frame. */
  renderAt(time: number): void;
  /** Draw one frame at the current clock time without advancing it. */
  renderNow(): void;
  resize(): void;
  setMood(id: MoodId, immediate?: boolean): void;
  readonly mood: MoodId;
  setBeatSource(source: BeatSource | null): void;
  setCameraDriver(driver: CameraDriver | null): void;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createEngine(options: EngineOptions): Promise<Engine> {
  const { canvas, plan, quality } = options;
  const progress = options.onProgress ?? ((): void => {});
  const errors: string[] = [];
  (globalThis as { __SC_ERRORS?: string[] }).__SC_ERRORS = errors;
  const report = (message: string): void => {
    errors.push(message);
    console.error(`[synthwave-city] ${message}`);
  };

  // three throws when it cannot get a context; the caller shows the message.
  const renderer = new WebGLRenderer({
    canvas, antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
  });
  renderer.info.autoReset = false;
  renderer.setClearColor(0x000000, 1);
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader): void => {
    const parts = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertexShader), gl.getShaderInfoLog(fragmentShader)]
      .filter((s): s is string => !!s && s.trim().length > 0);
    report(`shader error: ${parts.join(' | ').slice(0, 1200)}`);
  };

  const scene = new Scene();
  scene.matrixAutoUpdate = false;
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.rotation.order = 'YXZ';
  camera.layers.enable(SC_LAYER_NO_REFLECT);

  let moodId: MoodId = options.mood ?? 'sunset';
  const uniforms = createSharedUniforms(plan, quality, MOODS[moodId]);
  const moodDriver = new MoodDriver(uniforms, moodId);

  const blackTexture = uniforms.uReflTex.value;

  const clock = new LoopClock();
  const pose: CameraPose = { x: TILE / 2, y: 200, z: TILE / 2, yaw: 0, pitch: 0, roll: 0, fov: CAMERA_FOV };
  const frame: FrameState = {
    time: 0, dt: 0, loop: 0, beat: 0, frame: 0, camX: 0, camY: 0, camZ: 0, camYaw: 0, camPitch: 0, width: 1, height: 1,
  };
  const stats: EngineStats = { fps: 0, frameMs: 0, cpuMs: 0, drawCalls: 0, triangles: 0, renderScale: 1, frames: 0 };

  // ---- pipeline
  progress(0.05, 'Starting renderer');
  const host = { renderer, scene, camera, uniforms, quality };
  let pipeline: FramePipeline | null = null;
  let pipelineKind = 'basic';
  const loadPipeline = pipelineModules['../post/index.ts'];
  if (options.usePipeline !== false && loadPipeline) {
    try {
      pipeline = (await loadPipeline()).createPipeline(host);
      pipelineKind = 'post';
    } catch (error) {
      report(`pipeline failed, using the fallback: ${describe(error)}`);
    }
  }
  if (!pipeline) pipeline = createBasicPipeline(host);

  // ---- layers
  const wanted = options.layers === undefined || options.layers === 'all' ? availableLayers() : [...options.layers];
  const layers: Layer[] = [];
  const layerIds: string[] = [];
  const seed = options.seed ?? plan.seed;
  const candidates: Layer[] = [];
  for (const id of wanted) {
    const load = layerModules[`../layers/${id}/index.ts`];
    if (!load) {
      report(`layer "${id}" does not exist`);
      continue;
    }
    try {
      candidates.push((await load()).createLayer());
    } catch (error) {
      report(`layer "${id}" failed to load: ${describe(error)}`);
    }
  }
  if (options.extraLayers) candidates.push(...options.extraLayers);
  for (let i = 0; i < candidates.length; i++) {
    const layer = candidates[i]!;
    progress(0.1 + (0.75 * i) / candidates.length, `Building ${layer.id}`);
    try {
      await layer.init({ scene, renderer, camera, plan, uniforms, quality, seed: hashInts(seed, i + 1) });
      layers.push(layer);
      layerIds.push(layer.id);
    } catch (error) {
      report(`layer "${layer.id}" failed in init: ${describe(error)}`);
    }
  }

  // ---- size
  function resize(): void {
    const width = Math.max(1, canvas.clientWidth || canvas.width);
    const height = Math.max(1, canvas.clientHeight || canvas.height);
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, quality.maxPixelRatio);
    frame.width = width;
    frame.height = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    pipeline!.setSize(width, height, pixelRatio);
  }
  resize();

  // ---- one frame
  let beatSource: BeatSource | null = null;
  let driver: CameraDriver | null = null;
  let lastFov = camera.fov;

  function drawFrame(): void {
    const t0 = performance.now();
    frame.time = clock.time;
    frame.dt = clock.dt;
    frame.loop = clock.loop;
    const sourced = beatSource ? beatSource.beatPosition() : null;
    frame.beat = sourced === null ? clock.beat : sourced;

    if (driver) driver.update(frame, pose);
    const camX = wrap(pose.x, TILE);
    const camZ = wrap(pose.z, TILE);
    frame.camX = camX;
    frame.camY = pose.y;
    frame.camZ = camZ;
    frame.camYaw = pose.yaw;
    frame.camPitch = pose.pitch;
    camera.position.set(0, pose.y, 0);
    camera.rotation.set(pose.pitch, pose.yaw, pose.roll);
    if (pose.fov !== lastFov) {
      camera.fov = pose.fov;
      lastFov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);

    moodDriver.update(frame.dt);
    uniforms.uTime.value = frame.time;
    uniforms.uLoop.value = frame.loop;
    uniforms.uCam.value.set(camX, pose.y, camZ);
    const beat = frame.beat;
    const inBeat = beat - Math.floor(beat);
    const fall = 1 - inBeat;
    uniforms.uBeat.value.set(
      fall * fall * fall,
      (beat / 4) - Math.floor(beat / 4),
      Math.floor(beat) % 16,
      beatSource && beatSource.energy ? beatSource.energy() : 1,
    );

    for (let i = 0; i < layers.length; i++) layers[i]!.update(frame);

    renderer.info.reset();
    pipeline!.render(frame);
    frame.frame++;

    stats.frames = frame.frame;
    stats.drawCalls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    stats.renderScale = pipeline!.renderScale;
    const cpu = performance.now() - t0;
    stats.cpuMs += (cpu - stats.cpuMs) * 0.1;
  }

  // ---- loop
  let running = false;
  let raf = 0;
  let lastTs = 0;
  let contextLost = false;
  function onFrame(ts: number): void {
    if (!running) return;
    raf = requestAnimationFrame(onFrame);
    if (contextLost) return;
    if (lastTs > 0) {
      const delta = ts - lastTs;
      if (delta > 0 && delta < 1000) {
        stats.frameMs += (delta - stats.frameMs) * 0.1;
        stats.fps = stats.frameMs > 0 ? 1000 / stats.frameMs : 0;
      }
    }
    lastTs = ts;
    clock.advance(ts);
    drawFrame();
  }

  const onLost = (event: Event): void => {
    event.preventDefault();
    contextLost = true;
    report('WebGL context lost');
    options.onContextLost?.();
  };
  const onRestored = (): void => {
    contextLost = false;
    clock.resync();
    resize();
    options.onContextRestored?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  if (pipeline.warmUp) {
    progress(0.9, 'Compiling shaders');
    try {
      await pipeline.warmUp();
    } catch (error) {
      report(`warm-up failed: ${describe(error)}`);
    }
  }
  progress(1, 'Ready');

  const engine: Engine = {
    renderer, scene, camera, uniforms, plan, quality, pose, clock, stats, layerIds, errors,
    get pipelineKind(): string { return pipelineKind; },
    get running(): boolean { return running; },
    get mood(): MoodId { return moodId; },
    start(): void {
      if (running) return;
      running = true;
      lastTs = 0;
      clock.resync();
      raf = requestAnimationFrame(onFrame);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(raf);
    },
    renderAt(time: number): void {
      clock.freezeAt(((time % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS);
      drawFrame();
    },
    renderNow(): void {
      drawFrame();
    },
    resize,
    setMood(id: MoodId, immediate = false): void {
      moodId = id;
      moodDriver.set(id, immediate);
    },
    setBeatSource(source: BeatSource | null): void {
      beatSource = source;
    },
    setCameraDriver(next: CameraDriver | null): void {
      driver = next;
    },
    setReducedMotion(reduced: boolean): void {
      uniforms.uMotion.value = reduced ? 0.25 : 1;
    },
    dispose(): void {
      running = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const layer of layers) layer.dispose();
      pipeline!.dispose();
      uniforms.uCellTex.value.dispose();
      blackTexture.dispose();
      renderer.dispose();
    },
  };
  return engine;
}
