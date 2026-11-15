// Boot and wiring (plan T12, M1 and M4): plan -> engine -> camera rig -> audio, plus the UI around them.
// The only module allowed to import everything (architecture.md section 3.2).
import { createAudio, nextStation, STATIONS, type StationId } from '../audio/index';
import { createCameraRig } from '../camera/index';
import { createCityPlan } from '../city/index';
import { MOOD_ORDER, MOODS, type MoodId } from '../contracts/moods';
import { QUALITY, type QualityTier } from '../contracts/quality';
import { createEngine, type Engine } from '../engine/engine';
import { installDebugApi } from './debugApi';
import { chooseSeed, parseSeed, rollSeed } from './seed';
import { fullscreenSupported, isFullscreen, isStandalone, onFullscreenChange, setFullscreen } from './fullscreen';
import { loadSettings, resolveTier, safeStorage, saveSettings, type DeviceHints } from './settings';
import { createUi } from './ui';

const CRT_STRENGTH = 0.7;

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export async function boot(): Promise<void> {
  const flags = window as unknown as { __SC_READY?: boolean; __SC_ERRORS?: string[] };
  const params = new URLSearchParams(location.search);
  const storage = safeStorage();
  const settings = loadSettings(storage);
  const save = (): void => {
    saveSettings(storage, settings);
  };
  const coarse = matchMedia('(pointer: coarse)').matches;
  // The city: a valid ?seed= in the address, else the one last chosen in the menu, else 1984 (M9).
  const seed = chooseSeed(params.get('seed'), settings.seed);
  /** Build another city: remember it, put it in the address, reload (the plan is built once, D-08). */
  const loadCity = (next: number): void => {
    if (next === seed) return;
    settings.seed = next;
    save();
    const url = new URL(location.href);
    url.searchParams.set('seed', String(next));
    location.replace(url.toString());
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // Filled in as boot proceeds; the UI handlers below close over them.
  let engine: Engine | null = null;
  let rig: ReturnType<typeof createCameraRig> | null = null;
  let audio: ReturnType<typeof createAudio> | null = null;
  let detachInput: (() => void) | null = null;
  let audioStarted = false;
  let entered = false;

  const setMood = (id: MoodId, announce: boolean): void => {
    settings.mood = id;
    save();
    engine?.setMood(id);
    ui.setMood(id);
    if (announce) ui.toast(MOODS[id].name);
  };
  const setMuted = (muted: boolean, announce: boolean): void => {
    settings.muted = muted;
    save();
    audio?.setMuted(muted);
    ui.setSound(!muted);
    if (announce) ui.toast(muted ? 'Sound off' : 'Sound on');
  };
  const setStation = (id: StationId, announce: boolean): void => {
    settings.station = id;
    save();
    audio?.setStation(id);
    ui.setStation(id);
    if (announce) {
      const station = STATIONS[id];
      ui.toast(`${station.frequency} ${station.name}`);
    }
  };
  const modeLabel = (): string => (rig && rig.mode === 'free' ? 'Free flight' : 'Tour');
  const hintFor = (): string => {
    if (coarse) {
      return rig && rig.mode === 'free'
        ? 'Hold to fly · Back to tour to ride along'
        : 'Drag to look · hold to fly · ≡ for the menu';
    }
    return rig && rig.mode === 'free'
      ? 'W A S D to fly · Shift to boost · Space returns to the tour'
      : 'Move the mouse or press W A S D to take over · Esc for the menu';
  };

  const enter = (gesture: boolean): void => {
    if (!engine || !rig || !audio || ui.state === 'error') return;
    entered = true;
    ui.setEntered();
    ui.setState('running');
    if (gesture) {
      // The AudioContext may only start inside a user gesture.
      try {
        if (!audioStarted) {
          void Promise.resolve(audio.start()).catch((error: unknown) => console.warn('audio did not start:', describe(error)));
          audioStarted = true;
          engine.setBeatSource(audio.beat);
        } else {
          void Promise.resolve(audio.resume()).catch(() => {});
        }
        audio.setMuted(settings.muted);
      } catch (error) {
        console.warn('audio did not start:', describe(error));
      }
    }
    if (!detachInput) detachInput = rig.attachInput(ui.canvas);
    ui.setMode(modeLabel());
    ui.setFree(rig.mode === 'free');
    ui.setHint(hintFor());
  };

  const openMenu = (): void => {
    if (ui.state !== 'running') return;
    detachInput?.();
    detachInput = null;
    if (document.pointerLockElement) document.exitPointerLock();
    ui.toggle('photo', false);
    ui.setState('title');
  };

  const onAction = (action: string): void => {
    if (action === 'menu') openMenu();
    else if (action === 'mute') setMuted(!settings.muted, true);
    else if (action === 'stats') ui.toggle('stats');
    else if (action === 'photo') ui.toggle('photo');
    else if (action === 'station') setStation(nextStation(settings.station), true);
    else if (action === 'mood') setMood(MOOD_ORDER[(MOOD_ORDER.indexOf(settings.mood) + 1) % MOOD_ORDER.length]!, true);
    else if (action === 'mode') {
      ui.setFree(rig?.mode === 'free');
      ui.setMode(modeLabel());
      ui.toast(modeLabel());
      ui.setHint(hintFor());
    } else if (action.startsWith('viewpoint:') && rig) {
      const view = rig.viewpoints[Number(action.slice('viewpoint:'.length))];
      if (view) ui.toast(view.name);
      ui.setFree(rig.mode === 'free');
      ui.setMode(modeLabel());
    }
  };

  const ui = createUi({
    onEnter: () => enter(true),
    onMood: (id) => setMood(id, false),
    onTier: (tier: QualityTier) => {
      if (tier === (engine?.quality.tier ?? null)) return;
      settings.tier = tier;
      settings.pending = null;
      save();
      const url = new URL(location.href);
      url.searchParams.delete('q');
      location.replace(url.toString());
    },
    onSound: (on) => setMuted(!on, false),
    onStation: (id) => setStation(id, false),
    onCrt: (on) => {
      settings.crt = on;
      save();
      if (engine) engine.uniforms.uCrt.value = on ? CRT_STRENGTH : 0;
      ui.setCrt(on);
    },
    onSeed: (text) => {
      const next = parseSeed(text);
      if (next === null) {
        ui.setSeedInvalid(true);
        return;
      }
      ui.setSeedInvalid(false);
      ui.setSeed(next);
      loadCity(next);
    },
    onNewCity: () => loadCity(rollSeed(Math.random, seed)),
    onTour: () => {
      if (ui.state === 'running') rig?.setMode('tour');
    },
    onFullscreen: (on) => {
      void setFullscreen(document, on);
    },
    onMenu: openMenu,
  });

  // ---- full screen: a switch where the API exists, a home-screen hint where it does not (iPhone),
  // nothing when already launched from the home screen.
  const standalone = isStandalone((q) => matchMedia(q), navigator as Navigator & { standalone?: boolean });
  ui.setFullscreenOffer(fullscreenSupported(document) ? 'api' : standalone ? 'none' : 'hint');
  ui.setFullscreen(isFullscreen(document));
  onFullscreenChange(document, () => ui.setFullscreen(isFullscreen(document)));

  const fail = (html: string, detail?: string): void => {
    ui.showError(html + (detail ? `<br><br><code>${escapeHtml(detail)}</code>` : ''));
    (flags.__SC_ERRORS ??= []).push(`boot: ${detail ?? html}`);
    flags.__SC_READY = true;
  };

  if (!hasWebGL2()) {
    fail('Synthwave City needs <b>WebGL2</b>, and this browser or device is not offering it. '
      + 'Try a current Chrome, Edge, Firefox or Safari, and check that hardware acceleration is switched on.');
    return;
  }

  // ---- tier
  const nav = navigator as Navigator & { deviceMemory?: number };
  const hints: DeviceHints = { coarsePointer: coarse };
  if (typeof nav.deviceMemory === 'number') hints.memory = nav.deviceMemory;
  if (typeof nav.hardwareConcurrency === 'number') hints.cores = nav.hardwareConcurrency;
  const { tier, steppedDown } = resolveTier(settings, hints, params.get('q'));
  if (steppedDown) settings.tier = tier;
  settings.pending = tier;
  save();

  const moodParam = params.get('mood');
  if (moodParam && moodParam in MOODS) settings.mood = moodParam as MoodId;
  ui.setTier(tier);
  ui.setMood(settings.mood);
  ui.setSound(!settings.muted);
  ui.setStation(settings.station);
  ui.setCrt(settings.crt);
  ui.setSeed(seed);

  // ---- build
  try {
    ui.setProgress(0.03, 'Surveying the city');
    await nextPaint();
    const t0 = performance.now();
    const plan = createCityPlan(seed);
    const planMs = performance.now() - t0;
    ui.setProgress(0.08, 'Raising the towers');
    await nextPaint();

    engine = await createEngine({
      canvas: ui.canvas,
      plan,
      quality: QUALITY[tier],
      mood: settings.mood,
      seed,
      onProgress: (fraction, label) => ui.setProgress(0.08 + fraction * 0.9, label),
      onContextLost: () => ui.toggle('lost', true),
      onContextRestored: () => ui.toggle('lost', false),
    });
    engine.uniforms.uCrt.value = settings.crt ? CRT_STRENGTH : 0;
    if (engine.layerIds.length === 0) throw new Error('no layer could be started');

    rig = createCameraRig(plan, { onAction, seed });
    rig.setReducedMotion(reducedMotion.matches);
    engine.setReducedMotion(reducedMotion.matches);
    engine.setCameraDriver(rig);
    audio = createAudio({ seed, volume: settings.volume, muted: settings.muted, station: settings.station });
    installDebugApi(engine, plan, ui.canvas, planMs);

    const t = params.get('t');
    if (t !== null && t !== '') engine.clock.freezeAt(Number(t));
  } catch (error) {
    console.error(error);
    fail('The city could not be started on this device.', describe(error));
    return;
  }

  const live = engine;
  const liveRig = rig;
  const liveAudio = audio;

  // ---- environment
  addEventListener('resize', () => live.resize());
  reducedMotion.addEventListener('change', () => {
    liveRig.setReducedMotion(reducedMotion.matches);
    live.setReducedMotion(reducedMotion.matches);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      live.stop();
      if (audioStarted) void Promise.resolve(liveAudio.suspend()).catch(() => {});
    } else {
      live.start();
      if (audioStarted) void Promise.resolve(liveAudio.resume()).catch(() => {});
    }
  });
  // While the menu is up the rig is detached, so the menu handles its own keys.
  addEventListener('keydown', (event) => {
    if (ui.state !== 'title' || event.repeat) return;
    if (event.code === 'Escape' && entered) enter(true);
  });
  setInterval(() => {
    if (!document.body.classList.contains('stats')) return;
    const s = live.stats;
    ui.setStats([
      `${s.fps.toFixed(0)} fps   ${s.frameMs.toFixed(1)} ms   cpu ${s.cpuMs.toFixed(2)} ms`,
      `${s.drawCalls} draws   ${(s.triangles / 1e6).toFixed(2)} M tris`,
      `scale ${s.renderScale.toFixed(2)}   ${live.quality.tier}   ${live.pipelineKind}   city ${seed}`,
      `radio ${STATIONS[liveAudio.station].frequency} ${liveAudio.station}   audio ${liveAudio.state}`,
      `speed ${liveRig.speed.toFixed(0)} m/s   alt ${live.pose.y.toFixed(0)} m`,
      `layers ${live.layerIds.join(' ')}`,
      ...live.errors.slice(0, 4),
    ].join('\n'));
  }, 400);

  // ---- go
  live.start();
  let frames = 0;
  const settle = (): void => {
    if (++frames < 4) {
      requestAnimationFrame(settle);
      return;
    }
    // The first frames are on screen: this tier works here.
    settings.pending = null;
    save();
    ui.setProgress(1, 'Ready');
    ui.setState('title');
    if (params.get('autostart') === '1') enter(false);
    flags.__SC_READY = true;
  };
  requestAnimationFrame(settle);
}
