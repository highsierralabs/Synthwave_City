import { describe, expect, it } from 'vitest';
import { BEATS_PER_LOOP, LOOP_SECONDS, TILE } from '../../../src/contracts/constants';
import { LoopClock, MAX_DT } from '../../../src/core/clock';
import { angleDelta, clamp, damp, lerp, smoothstep, wrap, wrapDelta } from '../../../src/core/math';
import { createRng, hash32, hashUnit } from '../../../src/core/random';

describe('math', () => {
  it('wrap keeps values in [0, period)', () => {
    expect(wrap(-1, TILE)).toBe(TILE - 1);
    expect(wrap(TILE, TILE)).toBe(0);
    expect(wrap(TILE * 3 + 5, TILE)).toBe(5);
    expect(wrap(-TILE * 2 - 5, TILE)).toBe(TILE - 5);
  });

  it('wrapDelta is the shortest signed difference, like sc_wrap in GLSL', () => {
    expect(wrapDelta(10, TILE - 10, TILE)).toBe(20);
    expect(wrapDelta(TILE - 10, 10, TILE)).toBe(-20);
    expect(wrapDelta(100, 100 + TILE * 4, TILE)).toBe(0);
    const rng = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const a = rng.range(-3 * TILE, 3 * TILE);
      const b = rng.range(0, TILE);
      const d = wrapDelta(a, b, TILE);
      expect(d).toBeGreaterThanOrEqual(-TILE / 2);
      expect(d).toBeLessThan(TILE / 2);
      // b + d is a copy of a.
      expect(Math.abs(wrap(b + d - a + TILE / 2, TILE) - TILE / 2)).toBeLessThan(1e-6);
    }
  });

  it('small helpers', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(lerp(2, 4, 0.5)).toBe(3);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(damp(1, 0)).toBe(0);
    expect(damp(1e9, 1)).toBeCloseTo(1, 9);
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2, 9);
    expect(Math.abs(angleDelta(3.1, -3.1))).toBeLessThan(0.1);
  });
});

describe('random', () => {
  it('is deterministic and seed-dependent', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const xs = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(xs);
  });
  it('stays in range and is roughly uniform', () => {
    const rng = createRng(1);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 20000).toBeGreaterThan(0.48);
    expect(sum / 20000).toBeLessThan(0.52);
    for (let i = 0; i < 500; i++) {
      const n = rng.int(3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
  it('forks do not depend on how much the parent was used', () => {
    const a = createRng(9);
    const before = a.fork(1).next();
    a.next();
    a.next();
    expect(a.fork(1).next()).toBe(before);
    expect(a.fork(2).next()).not.toBe(before);
  });
  it('hashes are stable', () => {
    expect(hash32(1)).toBe(hash32(1));
    expect(hash32(1)).not.toBe(hash32(2));
    expect(hashUnit(1, 2, 3)).toBeLessThan(1);
    expect(hashUnit(1, 2, 3)).not.toBe(hashUnit(3, 2, 1));
  });
});

describe('LoopClock', () => {
  it('advances from timestamps and takes a zero first step', () => {
    const clock = new LoopClock();
    clock.advance(1000);
    expect(clock.dt).toBe(0);
    clock.advance(1016);
    expect(clock.dt).toBeCloseTo(0.016, 6);
    expect(clock.time).toBeCloseTo(0.016, 6);
  });
  it('clamps long gaps so a hidden tab does not fast-forward', () => {
    const clock = new LoopClock();
    clock.advance(0);
    clock.advance(60000);
    expect(clock.dt).toBe(MAX_DT);
  });
  it('never steps backwards on a timestamp that goes back', () => {
    const clock = new LoopClock();
    clock.advance(500);
    clock.advance(400);
    expect(clock.dt).toBe(0);
  });
  it('wraps at the loop end with a positive dt', () => {
    const clock = new LoopClock(LOOP_SECONDS - 0.01);
    clock.step(0.05);
    expect(clock.dt).toBe(0.05);
    expect(clock.time).toBeCloseTo(0.04, 6);
    expect(clock.loop).toBeGreaterThanOrEqual(0);
    expect(clock.loop).toBeLessThan(1);
  });
  it('beat is continuous modulo whole beats across the wrap', () => {
    const clock = new LoopClock(LOOP_SECONDS - 0.001);
    const before = clock.beat;
    clock.step(0.002);
    const after = clock.beat + BEATS_PER_LOOP;
    expect(after - before).toBeCloseTo((0.002 * BEATS_PER_LOOP) / LOOP_SECONDS, 6);
  });
  it('freezes and resumes', () => {
    const clock = new LoopClock();
    clock.freezeAt(12);
    clock.advance(100);
    clock.advance(200);
    expect(clock.time).toBe(12);
    expect(clock.dt).toBe(0);
    clock.unfreeze();
    clock.advance(300);
    clock.advance(310);
    expect(clock.time).toBeCloseTo(12.01, 6);
  });
});
