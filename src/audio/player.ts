// The live side: one AudioContext made inside a gesture, the lookahead timer, suspend and resume,
// tab hide and show, and the beat the picture follows. Everything musical lives in song.ts, and the
// sound in mix.ts and voices.ts; this file only keeps them running against the audio clock.
//
// Radio (M6). Every station keeps time from the moment the music first started, as if all five had
// been broadcasting all along: tuning to one lands somewhere in its song, at the start of the bar in
// progress, after a short burst of tuning noise. A switch builds a fresh mixer for the new station
// on the same AudioContext and fades the old one out, so nothing that was ringing is cut short.
import type { BeatSource } from '../contracts/audio';
import { createMix, type Mix } from './mix';
import { BEATS_PER_BAR, createSong, type Song } from './song';
import { DEFAULT_STATION, isStationId, STATIONS, stationSeed, type StationId } from './stations';
import { beatAt, createClockSmoother, createScheduler, timeAt, type Emit, type Scheduler } from './transport';
import { playEvent, tuning } from './voices';

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
  /** The station to play. Default `sunset`. */
  station?: StationId | undefined;
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
  /**
   * Tune to another station. Before `start()` it only chooses what will play. While playing, a
   * short burst of tuning noise covers the change and the station comes in mid-song. An unknown id
   * or the current station changes nothing.
   */
  setStation(id: StationId): void;
  readonly station: StationId;
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
  station: StationId;
  bpm: number;
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
/** Seconds of tuning noise between two stations. */
export const TUNE_SECONDS = 0.45;
/** How long a mixer that was tuned away from keeps running while its fade completes. */
const RETIRE_MS = 600;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createPlayer(options: AudioOptions = {}): Player {
  const seed = options.seed ?? 1;
  let stationId: StationId = isStationId(options.station) ? options.station : DEFAULT_STATION;
  let song: Song = createSong(stationSeed(stationId, seed), STATIONS[stationId].song);
  let bpm = STATIONS[stationId].sound.bpm;
  let scheduler: Scheduler = createScheduler(song);
  const smoother = createClockSmoother();

  let volume = clamp01(options.volume ?? DEFAULT_VOLUME);
  let muted = options.muted ?? false;

  let ctx: AudioContext | null = null;
  let mix: Mix | null = null;
  /** Audio-clock time of beat 0 of every station's song: when the music first started. */
  let startTime = 0;
  /** Nothing is scheduled before this time; the tuning noise plays until then. */
  let quietUntil = 0;
  const retiring: { mix: Mix; timer: ReturnType<typeof setTimeout> }[] = [];
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
    if (mix) playEvent(mix, event, timeAt(beat, startTime, bpm), (duration * 60) / bpm);
  };

  function tick(): void {
    if (!ctx || !running()) return;
    ticks++;
    const now = Math.max(ctx.currentTime, quietUntil);
    scheduler.advance(beatAt(now, startTime, bpm), beatAt(now + LOOKAHEAD, startTime, bpm), emit);
  }

  function retire(old: Mix, time: number): void {
    old.fadeOut(time);
    const entry = {
      mix: old,
      timer: setTimeout(() => {
        old.dispose();
        retiring.splice(retiring.indexOf(entry), 1);
      }, RETIRE_MS),
    };
    retiring.push(entry);
  }

  /** Point the player at `id`: its song, its tempo and, once there is a context, its mixer. */
  function tune(id: StationId): void {
    stationId = id;
    const station = STATIONS[id];
    song = createSong(stationSeed(id, seed), station.song);
    bpm = station.sound.bpm;
    if (!ctx || !mix) {
      // Not started: the new station starts from its first bar, like the first one would have.
      scheduler = createScheduler(song);
      return;
    }
    const now = ctx.currentTime;
    const live = running();
    // Come in at the start of the bar in progress once the noise is over; the scheduler drops what
    // has passed and starts a chord that still has a beat to ring.
    quietUntil = live ? now + TUNE_SECONDS : now;
    const inBar = beatAt(Math.max(quietUntil, startTime), startTime, bpm);
    scheduler = createScheduler(song, Math.floor(inBar / BEATS_PER_BAR) * BEATS_PER_BAR);
    retire(mix, now);
    mix = createMix(ctx, { seed, sound: station.sound });
    mix.setLevel(level(), now);
    if (live) {
      mix.fadeIn(now, 0.02);
      tuning(mix, now, TUNE_SECONDS);
      open = true;
      tick();
    } else {
      // Suspended or hidden: stay silent; the next opening fades the new mixer in.
      open = false;
    }
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
      mix = createMix(ctx, { seed, sound: STATIONS[stationId].sound });
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
      const position = beatAt(heard, startTime, bpm);
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
    setStation(id: StationId): void {
      if (disposed || !isStationId(id) || id === stationId) return;
      tune(id);
    },
    get station(): StationId {
      return stationId;
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
      for (const entry of retiring) {
        clearTimeout(entry.timer);
        entry.mix.dispose();
      }
      retiring.length = 0;
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
        station: stationId,
        bpm,
      };
    },
  };
}
