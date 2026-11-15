// Time for the music: beats against the audio clock, and the lookahead scheduler's bookkeeping.
// Pure: the caller supplies every clock reading, so all of this runs under Vitest.
import { BPM } from '../contracts/constants';
import { BEATS_PER_BAR, Voice, type NoteEvent, type Song } from './song';

export const SECONDS_PER_BEAT = 60 / BPM;
export const BEATS_PER_SECOND = BPM / 60;

/** Beats since the music started, for a reading of the audio clock. */
export function beatAt(contextTime: number, startTime: number): number {
  return (contextTime - startTime) * BEATS_PER_SECOND;
}

/** The audio-clock time of a beat. */
export function timeAt(beat: number, startTime: number): number {
  return startTime + beat * SECONDS_PER_BEAT;
}

export interface SchedulerStats {
  /** Events handed out on time. */
  emitted: number;
  /** Pad chords handed out late and shortened, because they were still due to be sounding. */
  late: number;
  /** Events skipped because their time had already passed. */
  dropped: number;
}

/** Receives an event, the beat it starts at (counted from the start of the song) and its length in beats. */
export type Emit = (event: NoteEvent, beat: number, duration: number) => void;

export interface Scheduler {
  /**
   * Hand out every event that starts before `horizonBeat` and has not been handed out yet.
   * `nowBeat` is the present. After a stall (a throttled timer, a blocked main thread) the events
   * that fell in the gap are dropped instead of played in a burst; only a pad chord with at least
   * `LATE_PAD_MIN_BEATS` left to ring is started late, so a stall does not leave a bar without harmony.
   */
  advance(nowBeat: number, horizonBeat: number, emit: Emit): void;
  /** Everything before this beat has been dealt with. */
  readonly cursor: number;
  readonly stats: SchedulerStats;
}

export const LATE_PAD_MIN_BEATS = 1;

export function createScheduler(song: Song, startBeat = 0): Scheduler {
  let cursor = startBeat;
  const stats: SchedulerStats = { emitted: 0, late: 0, dropped: 0 };
  return {
    get cursor(): number {
      return cursor;
    },
    stats,
    advance(nowBeat: number, horizonBeat: number, emit: Emit): void {
      if (!(horizonBeat > cursor)) return;
      const firstBar = Math.max(0, Math.floor(cursor / BEATS_PER_BAR));
      const lastBar = Math.floor(horizonBeat / BEATS_PER_BAR);
      for (let bar = firstBar; bar <= lastBar; bar++) {
        const base = bar * BEATS_PER_BAR;
        if (base >= horizonBeat) break;
        const events = song.bar(bar).events;
        for (let i = 0; i < events.length; i++) {
          const event = events[i]!;
          const beat = base + event.beat;
          if (beat < cursor || beat >= horizonBeat) continue;
          if (beat >= nowBeat) {
            emit(event, beat, event.duration);
            stats.emitted++;
          } else if (event.voice === Voice.pad && beat + event.duration - nowBeat >= LATE_PAD_MIN_BEATS) {
            emit(event, nowBeat, beat + event.duration - nowBeat);
            stats.late++;
          } else {
            stats.dropped++;
          }
        }
      }
      cursor = horizonBeat;
    },
  };
}

export interface ClockSmoother {
  /**
   * A steadier reading of the audio clock. `contextTime` is `AudioContext.currentTime`, which only
   * moves once per audio callback, so between callbacks the wall clock carries the estimate on.
   * Never runs backwards.
   */
  read(contextTime: number, wallSeconds: number): number;
}

export function createClockSmoother(maxCarry = 0.05): ClockSmoother {
  let lastContext = Number.NaN;
  let lastWall = 0;
  let out = Number.NEGATIVE_INFINITY;
  return {
    read(contextTime: number, wallSeconds: number): number {
      if (contextTime !== lastContext) {
        lastContext = contextTime;
        lastWall = wallSeconds;
      }
      const carry = wallSeconds - lastWall;
      const estimate = contextTime + (carry > 0 ? Math.min(carry, maxCarry) : 0);
      if (estimate > out) out = estimate;
      return out;
    },
  };
}
