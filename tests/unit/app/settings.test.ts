import { describe, expect, it } from 'vitest';
import {
  DEFAULTS, STORAGE_KEY, loadSettings, pickTier, resolveTier, saveSettings, validate, type StorageLike,
} from '../../../src/app/settings';

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('settings', () => {
  it('garbage in storage gives defaults', () => {
    for (const bad of ['', 'not json', '[]', 'null', '42', '{"tier":"ultra","mood":7,"volume":"loud","muted":"yes"}']) {
      expect(loadSettings(memoryStorage(bad))).toEqual(DEFAULTS);
    }
    expect(loadSettings(null)).toEqual(DEFAULTS);
    expect(validate(undefined)).toEqual(DEFAULTS);
  });

  it('keeps valid fields and clamps volume', () => {
    const s = validate({ tier: 'medium', mood: 'miami', muted: true, volume: 7, crt: true, seed: 77, station: 'plaza', pending: 'high', extra: 1 });
    expect(s).toEqual({ tier: 'medium', mood: 'miami', muted: true, volume: 1, crt: true, seed: 77, station: 'plaza', pending: 'high' });
    expect(validate({ volume: -3 }).volume).toBe(0);
    expect(validate({ volume: Number.NaN }).volume).toBe(DEFAULTS.volume);
    for (const bad of [0, -3, 2.5, 4294967296, '7', null]) expect(validate({ seed: bad }).seed).toBe(DEFAULTS.seed);
    expect(DEFAULTS.seed).toBe(1984);
    for (const bad of ['', 'Plaza', 'kiss', 4, null]) expect(validate({ station: bad }).station).toBe('sunset');
    expect(DEFAULTS.station).toBe('sunset');
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const s = { ...DEFAULTS, tier: 'low' as const, mood: 'midnight' as const, muted: true, volume: 0.25 };
    expect(saveSettings(storage, s)).toBe(true);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('survives storage that throws', () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(loadSettings(broken)).toEqual(DEFAULTS);
    expect(saveSettings(broken, { ...DEFAULTS })).toBe(false);
    expect(saveSettings(null, { ...DEFAULTS })).toBe(false);
  });
});

describe('tier choice', () => {
  it('is cautious on phones and generous on big desktops', () => {
    expect(pickTier({ coarsePointer: true, memory: 4, cores: 8 })).toBe('low');
    expect(pickTier({ coarsePointer: true, memory: 8, cores: 8 })).toBe('medium');
    expect(pickTier({ coarsePointer: false, memory: 4, cores: 12 })).toBe('low');
    expect(pickTier({ coarsePointer: false, memory: 8, cores: 6 })).toBe('medium');
    expect(pickTier({ coarsePointer: false, memory: 16, cores: 24 })).toBe('high');
    expect(pickTier({ coarsePointer: false })).toBe('high');
  });

  it('uses the stored tier, and a URL override beats it', () => {
    const hints = { coarsePointer: false, memory: 16, cores: 16 };
    expect(resolveTier({ ...DEFAULTS, tier: 'medium' }, hints, null)).toEqual({ tier: 'medium', steppedDown: false });
    expect(resolveTier({ ...DEFAULTS, tier: 'medium' }, hints, 'low')).toEqual({ tier: 'low', steppedDown: false });
    expect(resolveTier({ ...DEFAULTS, tier: 'medium' }, hints, 'nonsense')).toEqual({ tier: 'medium', steppedDown: false });
  });

  it('steps down one tier after a boot that never reached a frame', () => {
    const hints = { coarsePointer: false, memory: 16, cores: 16 };
    expect(resolveTier({ ...DEFAULTS, tier: 'high', pending: 'high' }, hints, null)).toEqual({ tier: 'medium', steppedDown: true });
    expect(resolveTier({ ...DEFAULTS, pending: 'high' }, hints, null)).toEqual({ tier: 'medium', steppedDown: true });
    // Already at the bottom: nowhere to go.
    expect(resolveTier({ ...DEFAULTS, tier: 'low', pending: 'low' }, hints, null)).toEqual({ tier: 'low', steppedDown: false });
    // A pending flag for another tier is not a crash of this one.
    expect(resolveTier({ ...DEFAULTS, tier: 'medium', pending: 'high' }, hints, null)).toEqual({ tier: 'medium', steppedDown: false });
  });
});
