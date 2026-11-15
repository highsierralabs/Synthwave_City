// The live side: one AudioContext made inside a gesture, the lookahead timer, suspend and resume,
// tab hide and show, and the beat the picture follows. Everything musical lives in song.ts, and the
// sound in mix.ts and voices.ts; this file only keeps them running against the audio clock.
import type { BeatSource } from '../contracts/audio';
import { createMix, type Mix } from './mix';
import { createSong } from './song';
import { BEATS_PER_SECOND, beatAt, createClockSmoother, createScheduler, SECONDS_PER_BEAT, timeAt, type Emit } from './transport';
import { playEvent } from './voices';

/**
 * `idle`: `start()` has not been called, and there is no AudioContext.
 * `running`: sound is being produced (it may still be muted).
 * `suspended`: started, but not producing sound: `suspend()` was called, the tab is hidden, the
 *   browser interrupted the context, or it is still waiting for a user gesture.
 * `unavailable`: this browser has no Web Audio, or the context could not be created.
 * `closed`: `dispose()` was called.
 */
export type AudioState = 'idle' | 'running' | 'suspended' | 'unavailable' | 'closed';

export interface AudioOptions {
  /** Picks the song. The same seed always plays the same music. Default 1. */
  seed?: number | undefined;
  /** 0..1, default 0.8. */
  volume?: number | undefined;
  /** Default false. */
  muted?: boolean | undefined;
}

export interface AudioSystem {
  /**
   * Create the AudioContext and start the music. Call it inside a user gesture handler, or the
   * browser leaves the context suspended; in that case call `start()` or `resume()` again from a
   * gesture. Safe to call twice. The promise resolves once the attempt has settled and never rejects.
   */
  start(): Promise<void>;
  /** Fade out and stop the audio clock. The music picks up where it stopped. */
  suspend(): Promise<void>;
  resume(): Promise<void>;
  /** 0..1; values outside are clamped. The gain is the square of the value, so the control feels even. */
  setVolume(volume: number): void;
  /** Silence without stopping: the beat keeps running. */
  setMuted(muted: boolean): void;
  /** Beat position from the audio clock; null whenever `state` is not `running`. */
  readonly beat: BeatSource;
  readonly state: AudioState;
  /** Stop everything and close the context. The object is finished afterwards. */
  dispose(): void;
}

/** What the measurement pages read. Not part of the public surface. */
export interface PlayerDebug {
  contextState: string;
  currentTime: number;
  startTime: number;
  sampleRate: number;
  latency: number;
  activeVoices: number;
  startedVoices: number;
  droppedVoices: number;
  emitted: number;
  late: number;
  dropped: number;
  ticks: number;
}

export interface Player {
  readonly system: AudioSystem;
  debug(): PlayerDebug | null;
}

export const DEFAULT_VOLUME = 0.8;
/** How often the scheduler runs. */
export const TICK_MS = 25;
/** How far ahead of the audio clock notes are scheduled, seconds. */
export const LOOKAHEAD = 0.2;
/** Silence before the first beat, so the first notes are never late. */
const LEAD_IN = 0.15;
/** Time constant of the first fade-in: about two seconds to full level. */
const FIRST_FADE = 0.6;
const RESUME_FADE = 0.08;
/** The fade-out is given this long before the context is suspended. */
const SUSPEND_DELAY_MS = 70;
/** How long `start()` and `resume()` wait for the browser before reporting back. */
const SETTLE_MS = 400;
/** Never trust a reported output latency beyond this. */
const MAX_LATENCY = 0.3;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createPlayer(options: AudioOptions = {}): Player {
  const seed = options.seed ?? 1;
  const song = createSong(seed);
  const scheduler = createScheduler(song);
  const smoother = createClockSmoother();

  let volume = clamp01(options.volume ?? DEFAULT_VOLUME);
  let muted = options.muted ?? false;

  let ctx: AudioContext | null = null;
  let mix: Mix | null = null;
  let startTime = 0;
  let latency = 0;
  let ticks = 0;
  let unavailable = false;
  let disposed = false;
  let paused = false;
  let hidden = false;
  /** The first fade-in has been started. */
  let faded = false;
  /** The output is open, or opening. */
  let open = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let suspendTimer: ReturnType<typeof setTimeout> | null = null;

  const wanted = (): boolean => ctx !== null && !disposed && !paused && !hidden;
  const running = (): boolean => wanted() && ctx !== null && ctx.state === 'running';
  const level = (): number => (muted ? 0 : volume * volume);

  const emit: Emit = (event, beat, duration) => {
    if (mix) playEvent(mix, event, timeAt(beat, startTime), duration * SECONDS_PER_BEAT);
  };

  function tick(): void {
    if (!ctx || !running()) return;
    ticks++;
    const now = ctx.currentTime;
    scheduler.advance(beatAt(now, startTime), beatAt(now + LOOKAHEAD, startTime), emit);
  }

  function stopTimer(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function clearSuspendTimer(): void {
    if (suspendTimer !== null) clearTimeout(suspendTimer);
    suspendTimer = null;
  }

  /** The context is running and is meant to be: open the output and keep the scheduler fed. */
  function onRunning(): void {
    if (!ctx || !mix || !running()) return;
    const reported = ctx.outputLatency;
    latency = Number.isFinite(reported) && reported > 0 ? Math.min(reported, MAX_LATENCY) : 0;
    if (!open) {
      // The first opening is the slow fade-in, timed from the first beat; later ones are quick.
      mix.fadeIn(faded ? ctx.currentTime : Math.max(ctx.currentTime, startTime), faded ? RESUME_FADE : FIRST_FADE);
      faded = true;
      open = true;
    }
    if (timer === null) timer = setInterval(tick, TICK_MS);
    tick();
  }

  /** Resolves when `promise` does, or after `ms`, whichever is first. Never rejects. */
  function settle(promise: Promise<void>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(done, ms);
      promise.then(done, done);
    });
  }

  /** Bring the context in line with what is wanted: running, or faded out and then suspended. */
  async function apply(): Promise<void> {
    const context = ctx;
    if (!context || !mix || disposed) return;
    if (wanted()) {
      clearSuspendTimer();
      if (context.state !== 'running') await settle(context.resume(), SETTLE_MS);
      onRunning();
      return;
    }
    stopTimer();
    mix.fadeOut(context.currentTime);
    open = false;
    clearSuspendTimer();
    suspendTimer = setTimeout(() => {
      suspendTimer = null;
      if (!wanted() && !disposed && context.state === 'running') context.suspend().catch(() => {});
    }, SUSPEND_DELAY_MS);
  }

  function onVisibility(): void {
    hidden = document.visibilityState === 'hidden';
    void apply();
  }

  function onStateChange(): void {
    // The browser can stop the context on its own (an incoming call on a phone) and start it again.
    if (running()) onRunning();
    else stopTimer();
  }

  function create(): boolean {
    if (typeof AudioContext === 'undefined') return false;
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      mix = createMix(ctx, { seed });
    } catch (error) {
      console.warn('audio is unavailable:', error);
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
      mix = null;
      return false;
    }
    mix.setLevel(level(), 0);
    startTime = ctx.currentTime + LEAD_IN;
    ctx.addEventListener('statechange', onStateChange);
    if (typeof document !== 'undefined') {
      hidden = document.visibilityState === 'hidden';
      document.addEventListener('visibilitychange', onVisibility);
    }
    return true;
  }

  const beat: BeatSource = {
    beatPosition(): number | null {
      if (!ctx || !running()) return null;
      const heard = smoother.read(ctx.currentTime, performance.now() / 1000) - latency;
      const position = (heard - startTime) * BEATS_PER_SECOND;
      return position > 0 ? position : 0;
    },
    energy(): number {
      const position = beat.beatPosition();
      return position === null ? 1 : song.energyAt(position);
    },
  };

  const system: AudioSystem = {
    start(): Promise<void> {
      if (disposed || unavailable) return Promise.resolve();
      if (!ctx && !create()) {
        unavailable = true;
        return Promise.resolve();
      }
      paused = false;
      return apply();
    },
    suspend(): Promise<void> {
      paused = true;
      return apply();
    },
    resume(): Promise<void> {
      paused = false;
      return apply();
    },
    setVolume(value: number): void {
      volume = Number.isFinite(value) ? clamp01(value) : volume;
      if (ctx && mix) mix.setLevel(level(), ctx.currentTime);
    },
    setMuted(value: boolean): void {
      muted = value;
      if (ctx && mix) mix.setLevel(level(), ctx.currentTime);
    },
    beat,
    get state(): AudioState {
      if (disposed) return 'closed';
      if (unavailable) return 'unavailable';
      if (!ctx) return 'idle';
      return running() ? 'running' : 'suspended';
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopTimer();
      clearSuspendTimer();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (ctx) {
        ctx.removeEventListener('statechange', onStateChange);
        if (mix) mix.dispose();
        ctx.close().catch(() => {});
      }
      ctx = null;
      mix = null;
    },
  };

  return {
    system,
    debug(): PlayerDebug | null {
      if (!ctx || !mix) return null;
      return {
        contextState: ctx.state,
        currentTime: ctx.currentTime,
        startTime,
        sampleRate: ctx.sampleRate,
        latency,
        activeVoices: mix.voices.active,
        startedVoices: mix.voices.started,
        droppedVoices: mix.voices.dropped,
        emitted: scheduler.stats.emitted,
        late: scheduler.stats.late,
        dropped: scheduler.stats.dropped,
        ticks,
      };
    },
  };
}
