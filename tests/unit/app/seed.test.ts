import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, MAX_ROLLED, MAX_SEED, chooseSeed, isSeed, parseSeed, rollSeed } from '../../../src/app/seed';

describe('seed', () => {
  it('reads whole numbers from 1 to the 32-bit limit', () => {
    expect(parseSeed('7')).toBe(7);
    expect(parseSeed('  1984 ')).toBe(1984);
    expect(parseSeed('007')).toBe(7);
    expect(parseSeed('4294967295')).toBe(MAX_SEED);
  });

  it('refuses everything else', () => {
    for (const bad of ['', ' ', '0', '000', '-5', '+5', '7.9', '7.', '1e3', '0x10', 'hello', '12a', '4294967296', '99999999999', '١٢٣']) {
      expect(parseSeed(bad), bad).toBeNull();
    }
    expect(parseSeed(null)).toBeNull();
    expect(parseSeed(undefined)).toBeNull();
  });

  it('checks stored values', () => {
    expect(isSeed(1)).toBe(true);
    expect(isSeed(MAX_SEED)).toBe(true);
    for (const bad of [0, -1, 1.5, MAX_SEED + 1, Number.NaN, '7', null, undefined]) expect(isSeed(bad), String(bad)).toBe(false);
  });

  it('rolls short seeds, never the current one', () => {
    expect(rollSeed(() => 0, 5)).toBe(1);
    expect(rollSeed(() => 0.999999999, 5)).toBe(MAX_ROLLED);
    // A source stuck on the current seed still gets out.
    expect(rollSeed(() => 0, 1)).toBe(2);
    let x = 0.123;
    const lcg = (): number => (x = (x * 9301 + 0.49297) % 1);
    for (let i = 0; i < 2000; i++) {
      const s = rollSeed(lcg, 42);
      expect(Number.isInteger(s) && s >= 1 && s <= MAX_ROLLED && s !== 42).toBe(true);
    }
  });

  it('prefers the address, then storage, then the default', () => {
    expect(chooseSeed('7', 99)).toBe(7);
    expect(chooseSeed(null, 99)).toBe(99);
    expect(chooseSeed('garbage', 99)).toBe(99);
    expect(chooseSeed(null, null)).toBe(DEFAULT_SEED);
    expect(chooseSeed('0', 0)).toBe(DEFAULT_SEED);
  });
});
