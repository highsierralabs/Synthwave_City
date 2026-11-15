import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudio } from '../../../src/audio/index';
import { CEILING, CLAMP_KNEE, clampShape } from '../../../src/audio/mix';

// Vitest runs in node: there is no Web Audio here. These tests cover what the module must do
// without it: create nothing until asked, and fail soft. The live path is checked in a browser
// by shots/T10/live.mjs (plans/T10-audio.md, section 6).

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createAudio', () => {
  it('exposes exactly the surface the app shell is written against', () => {
    const audio = createAudio();
    expect(Object.keys(audio).sort()).toEqual(['beat', 'dispose', 'resume', 'setMuted', 'setStation', 'setVolume', 'start', 'state', 'station', 'suspend']);
    expect(typeof audio.beat.beatPosition).toBe('function');
    expect(typeof audio.beat.energy).toBe('function');
  });

  it('creates no AudioContext until start() is called', () => {
    let constructed = 0;
    vi.stubGlobal('AudioContext', class {
      constructor() {
        constructed++;
      }
    });
    const audio = createAudio({ seed: 7, volume: 0.5, muted: true });
    audio.setVolume(0.3);
    audio.setMuted(false);
    expect(audio.beat.beatPosition()).toBeNull();
    expect(audio.state).toBe('idle');
    expect(constructed).toBe(0);
  });

  it('before start: idle, no beat, energy 1, and suspend or resume change nothing', async () => {
    const audio = createAudio({ seed: 3 });
    expect(audio.state).toBe('idle');
    expect(audio.beat.beatPosition()).toBeNull();
    expect(audio.beat.energy?.()).toBe(1);
    await audio.suspend();
    await audio.resume();
    expect(audio.state).toBe('idle');
    expect(audio.beat.beatPosition()).toBeNull();
  });

  it('before start, a station is only chosen; unknown ids and the same station change nothing', () => {
    const audio = createAudio({ station: 'velvet' });
    expect(audio.station).toBe('velvet');
    audio.setStation('plaza');
    expect(audio.station).toBe('plaza');
    audio.setStation('nowhere' as never);
    expect(audio.station).toBe('plaza');
    expect(audio.state).toBe('idle');
    expect(audio.beat.beatPosition()).toBeNull();
    expect(createAudio().station).toBe('sunset');
    expect(createAudio({ station: 'bogus' as never }).station).toBe('sunset');
  });

  it('without Web Audio, start() resolves and the state says unavailable', async () => {
    expect(typeof AudioContext).toBe('undefined');
    const audio = createAudio();
    await expect(audio.start()).resolves.toBeUndefined();
    expect(audio.state).toBe('unavailable');
    expect(audio.beat.beatPosition()).toBeNull();
    await audio.start();
    await audio.resume();
    audio.setVolume(2);
    audio.setMuted(true);
    expect(audio.state).toBe('unavailable');
  });

  it('a context that cannot be created is reported, not thrown', async () => {
    let constructed = 0;
    vi.stubGlobal('AudioContext', class {
      constructor() {
        constructed++;
        throw new Error('no audio device');
      }
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = createAudio();
    await expect(audio.start()).resolves.toBeUndefined();
    expect(constructed).toBe(1);
    expect(audio.state).toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
    // It does not keep trying.
    await audio.start();
    expect(constructed).toBe(1);
  });

  it('dispose() is final and safe to repeat', async () => {
    const audio = createAudio();
    audio.dispose();
    audio.dispose();
    expect(audio.state).toBe('closed');
    await audio.start();
    await audio.resume();
    expect(audio.state).toBe('closed');
    expect(audio.beat.beatPosition()).toBeNull();
  });
});

describe('the output clamp', () => {
  it('passes anything under the knee untouched', () => {
    for (let x = 0; x <= CLAMP_KNEE; x += 0.01) expect(clampShape(x)).toBe(x);
  });

  it('never reaches the ceiling, which is under -6 dBFS', () => {
    expect(20 * Math.log10(CEILING)).toBeLessThan(-6);
    for (const x of [CLAMP_KNEE, 0.4, 0.5, 0.75, 1, 2, 10, 1000]) {
      expect(clampShape(x)).toBeLessThanOrEqual(CEILING);
      expect(clampShape(x)).toBeGreaterThanOrEqual(CLAMP_KNEE);
    }
    expect(clampShape(1)).toBeLessThan(CEILING);
  });

  it('rises smoothly: no step at the knee, never falling, never steeper than a straight wire', () => {
    let previous = 0;
    for (let x = 0.001; x < 1.5; x += 0.001) {
      const y = clampShape(x);
      expect(y).toBeGreaterThanOrEqual(previous);
      expect(y - previous).toBeLessThanOrEqual(0.001 + 1e-12);
      previous = y;
    }
    const just = 1e-6;
    expect(clampShape(CLAMP_KNEE + just) - clampShape(CLAMP_KNEE)).toBeCloseTo(just, 9);
  });
});
