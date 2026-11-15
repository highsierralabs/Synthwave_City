import { describe, expect, it } from 'vitest';
import { AdaptiveScale } from '../../../src/post/adaptive';

/** Run for a number of seconds at a frame time that may depend on the current scale. */
function run(a: AdaptiveScale, seconds: number, frameMs: (scale: number) => number): number {
  let changes = 0;
  let t = 0;
  while (t < seconds) {
    const ms = frameMs(a.scale);
    if (a.update(ms, ms / 1000)) changes++;
    t += ms / 1000;
  }
  return changes;
}

describe('AdaptiveScale', () => {
  it('starts at the maximum and holds it when frames are on time', () => {
    const a = new AdaptiveScale({ min: 0.5, max: 1 });
    expect(a.scale).toBe(1);
    expect(run(a, 30, () => 16.7)).toBe(0);
    expect(a.scale).toBe(1);
  });

  it('steps down under load, to the floor and no further', () => {
    const a = new AdaptiveScale({ min: 0.6, max: 1 });
    run(a, 6, () => 30);
    expect(a.scale).toBeLessThan(1);
    run(a, 60, () => 30);
    expect(a.scale).toBeCloseTo(0.6, 6);
  });

  it('steps back up when there is headroom', () => {
    const a = new AdaptiveScale({ min: 0.5, max: 1 });
    run(a, 8, () => 30);
    const low = a.scale;
    expect(low).toBeLessThan(1);
    run(a, 120, () => 16.7);
    expect(a.scale).toBe(1);
  });

  it('settles instead of oscillating when cost follows scale', () => {
    // A GPU that makes 16.7 ms only at scale 0.8 or below.
    const cost = (scale: number): number => (scale > 0.8 + 1e-9 ? 22 : 16.7);
    const a = new AdaptiveScale({ min: 0.5, max: 1 });
    run(a, 20, cost);
    expect(a.scale).toBeLessThanOrEqual(0.8 + 1e-9);
    // Over the next ten minutes it may probe upwards, but ever more rarely.
    const first = run(a, 120, cost);
    const later = run(a, 480, cost);
    expect(first).toBeLessThanOrEqual(12);
    expect(later / 4).toBeLessThan(Math.max(1, first));
    expect(a.scale).toBeGreaterThanOrEqual(0.7 - 1e-9);
  });

  it('ignores the start-up hitches', () => {
    const a = new AdaptiveScale({ min: 0.5, max: 1 });
    expect(run(a, 2.5, () => 120)).toBe(0);
    expect(a.scale).toBe(1);
    expect(run(a, 20, () => 16.7)).toBe(0);
    expect(a.scale).toBe(1);
  });

  it('ignores frozen time and nonsense input', () => {
    const a = new AdaptiveScale({ min: 0.5, max: 1 });
    expect(a.update(0, 0)).toBe(false);
    expect(a.update(Number.NaN, 0.016)).toBe(false);
    expect(a.update(500, -1)).toBe(false);
    expect(a.scale).toBe(1);
  });
});
