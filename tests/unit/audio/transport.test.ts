import { describe, expect, it } from 'vitest';
import { BEATS_PER_BAR, Voice, createSong, type NoteEvent } from '../../../src/audio/song';
import {
  BEATS_PER_SECOND, LATE_PAD_MIN_BEATS, SECONDS_PER_BEAT, beatAt, createClockSmoother, createScheduler, timeAt,
} from '../../../src/audio/transport';
import { BEATS_PER_LOOP, BPM, LOOP_SECONDS } from '../../../src/contracts/constants';
import { createRng } from '../../../src/core/random';

interface Got { event: NoteEvent; beat: number; duration: number; now: number }

/** Every event of the song with an onset in [from, to), as "beat voice midi" strings. */
function expected(seed: number, from: number, to: number): string[] {
  const song = createSong(seed);
  const out: string[] = [];
  for (let bar = Math.floor(from / BEATS_PER_BAR); bar * BEATS_PER_BAR < to; bar++) {
    for (const e of song.bar(bar).events) {
      const beat = bar * BEATS_PER_BAR + e.beat;
      if (beat >= from && beat < to) out.push(`${beat} ${e.voice} ${e.midi}`);
    }
  }
  return out.sort();
}
const key = (g: Got): string => `${g.beat} ${g.event.voice} ${g.event.midi}`;

describe('transport: beats and seconds', () => {
  it('the tempo is BPM', () => {
    expect(SECONDS_PER_BEAT * BPM).toBeCloseTo(60, 12);
    expect(BEATS_PER_SECOND * SECONDS_PER_BEAT).toBeCloseTo(1, 12);
    expect(beatAt(60, 0)).toBeCloseTo(BPM, 9);
    expect(beatAt(LOOP_SECONDS, 0)).toBeCloseTo(BEATS_PER_LOOP, 6);
  });

  it('beatAt and timeAt are inverses and count from the start time', () => {
    expect(beatAt(3.5, 3.5)).toBe(0);
    expect(timeAt(0, 3.5)).toBe(3.5);
    for (const start of [0, 0.15, 12.25]) {
      for (const beat of [0, 0.25, 1, 17.5, 4096]) expect(beatAt(timeAt(beat, start), start)).toBeCloseTo(beat, 9);
    }
  });
});

describe('transport: the lookahead scheduler', () => {
  it('hands out every event exactly once, never late and never past the horizon, at a steady tick', () => {
    const song = createSong(1);
    const scheduler = createScheduler(song);
    const got: Got[] = [];
    const lookahead = 0.2 * BEATS_PER_SECOND;
    const end = 40 * BEATS_PER_BAR;
    // Start before the first beat, as the player does with its lead-in.
    for (let now = -0.3; now < end; now += 0.025 * BEATS_PER_SECOND) {
      const horizon = Math.min(end, now + lookahead);
      scheduler.advance(now, horizon, (event, beat, duration) => {
        expect(beat).toBeGreaterThanOrEqual(now);
        expect(beat).toBeLessThan(horizon);
        expect(duration).toBe(event.duration);
        got.push({ event, beat, duration, now });
      });
    }
    scheduler.advance(end, end, () => { throw new Error('nothing is left'); });
    expect(got.map(key).sort()).toEqual(expected(1, 0, end));
    expect(scheduler.stats).toEqual({ emitted: got.length, late: 0, dropped: 0 });
    expect(scheduler.cursor).toBe(end);
  });

  it('gives the same result with an uneven tick, as long as no tick is longer than the lookahead', () => {
    const rng = createRng(99);
    const scheduler = createScheduler(createSong(3));
    const got: string[] = [];
    const lookahead = 0.2 * BEATS_PER_SECOND;
    const end = 24 * BEATS_PER_BAR;
    let now = 0;
    while (now < end) {
      scheduler.advance(now, Math.min(end, now + lookahead), (event, beat) => got.push(`${beat} ${event.voice} ${event.midi}`));
      now += rng.range(0.005, 0.19) * BEATS_PER_SECOND;
    }
    scheduler.advance(end, end, () => {});
    // The last stretch before `end` is covered by the final horizons.
    expect(got.sort()).toEqual(expected(3, 0, end));
    expect(scheduler.stats.dropped).toBe(0);
    expect(scheduler.stats.late).toBe(0);
  });

  it('does nothing when the horizon has not moved on', () => {
    const scheduler = createScheduler(createSong(1));
    let calls = 0;
    scheduler.advance(0, 2, () => calls++);
    const first = calls;
    expect(first).toBeGreaterThan(0);
    scheduler.advance(0.5, 2, () => calls++);
    scheduler.advance(0.5, 1, () => calls++);
    expect(calls).toBe(first);
    expect(scheduler.cursor).toBe(2);
  });

  it('can start in the middle of the song', () => {
    const start = 26 * BEATS_PER_BAR;
    const scheduler = createScheduler(createSong(2), start);
    const got: string[] = [];
    scheduler.advance(start - 1, start + 8, (event, beat) => got.push(`${beat} ${event.voice} ${event.midi}`));
    expect(got.sort()).toEqual(expected(2, start, start + 8));
  });

  it('after a stall, drops what was missed instead of playing it in a burst', () => {
    const song = createSong(1);
    // Bars 24 and on are a chorus: plenty going on.
    const start = 24 * BEATS_PER_BAR;
    const scheduler = createScheduler(song, start);
    const lookahead = 0.2 * BEATS_PER_SECOND;
    scheduler.advance(start, start + lookahead, () => {});
    const before = { ...scheduler.stats };

    // The timer does not fire for a bar and a half while the audio clock runs on.
    const now = start + 6.1;
    const got: Got[] = [];
    scheduler.advance(now, now + lookahead, (event, beat, duration) => got.push({ event, beat, duration, now }));

    const missed = expected(1, start + lookahead, now).length;
    const due = expected(1, now, now + lookahead).length;
    const onTime = got.filter((g) => g.beat > now);
    const late = got.filter((g) => g.beat === now);
    expect(missed).toBeGreaterThan(40);
    expect(onTime.length).toBe(due);
    // Only pad notes are restarted, shortened to end when they were going to end anyway.
    expect(late.length).toBeGreaterThan(0);
    expect(late.length).toBeLessThanOrEqual(4);
    for (const g of late) {
      expect(g.event.voice).toBe(Voice.pad);
      expect(g.duration).toBeGreaterThanOrEqual(LATE_PAD_MIN_BEATS);
      expect(g.duration).toBeLessThan(g.event.duration);
      const originalEnd = Math.floor(now / BEATS_PER_BAR) * BEATS_PER_BAR + g.event.duration;
      expect(g.beat + g.duration).toBeCloseTo(originalEnd, 9);
    }
    expect(scheduler.stats.late - before.late).toBe(late.length);
    expect(scheduler.stats.dropped - before.dropped).toBe(missed - late.length);
    expect(scheduler.stats.emitted - before.emitted).toBe(onTime.length);
    expect(got.length).toBeLessThan(missed / 2);
  });

  it('does not restart a pad chord that is nearly over', () => {
    const song = createSong(1);
    const start = 24 * BEATS_PER_BAR;
    const scheduler = createScheduler(song, start);
    // Stall from the bar line to its last half beat: the chord that began there has under a beat left.
    const now = start + 3.6;
    const got: Got[] = [];
    scheduler.advance(now, now + 0.1, (event, beat, duration) => got.push({ event, beat, duration, now }));
    expect(got.filter((g) => g.event.voice === Voice.pad).length).toBe(0);
    expect(scheduler.stats.late).toBe(0);
    expect(scheduler.stats.dropped).toBeGreaterThan(20);
  });
});

describe('transport: the clock smoother', () => {
  it('follows a clock that moves in steps, without running backwards or far from the truth', () => {
    const smoother = createClockSmoother();
    let previous = -Infinity;
    let worst = 0;
    // The audio clock advances every 10 ms; the picture samples it at about 60 Hz with jitter.
    const rng = createRng(4);
    for (let wall = 0; wall < 20; wall += 0.0167 + rng.range(-0.004, 0.004)) {
      const context = Math.floor(wall / 0.01) * 0.01;
      const estimate = smoother.read(context, wall + 123.4);
      expect(estimate).toBeGreaterThanOrEqual(previous);
      previous = estimate;
      worst = Math.max(worst, Math.abs(estimate - wall));
    }
    expect(worst).toBeLessThan(0.021);
    expect(previous).toBeGreaterThan(19.9);
  });

  it('is smoother than the raw clock', () => {
    const smoother = createClockSmoother();
    let rawError = 0;
    let smoothError = 0;
    let n = 0;
    for (let wall = 1; wall < 6; wall += 1 / 240) {
      const context = Math.floor(wall / 0.02) * 0.02;
      rawError += Math.abs(context - wall);
      smoothError += Math.abs(smoother.read(context, wall) - wall);
      n++;
    }
    expect(smoothError / n).toBeLessThan(rawError / n / 2);
  });

  it('holds still while the audio clock is stopped, apart from a bounded carry', () => {
    const smoother = createClockSmoother(0.05);
    expect(smoother.read(10, 100)).toBe(10);
    expect(smoother.read(10, 100.02)).toBeCloseTo(10.02, 9);
    // Suspended for a minute: the estimate is capped, not a minute ahead.
    expect(smoother.read(10, 160)).toBeCloseTo(10.05, 9);
    // The clock starts again from where it stopped; the estimate waits for it rather than jumping back.
    expect(smoother.read(10.01, 160.01)).toBeCloseTo(10.05, 9);
    expect(smoother.read(10.06, 160.06)).toBeCloseTo(10.06, 9);
  });
});
