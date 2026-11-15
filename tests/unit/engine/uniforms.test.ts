import { describe, expect, it } from 'vitest';
import { createFixturePlan } from '../../../dev/fixturePlan';
import { CELL_STRIDE } from '../../../src/contracts/city';
import { CELLS } from '../../../src/contracts/constants';
import { MOODS } from '../../../src/contracts/moods';
import { PALETTE } from '../../../src/contracts/palette';
import { QUALITY } from '../../../src/contracts/quality';
import { MoodDriver, createSharedUniforms } from '../../../src/engine/uniforms';

describe('shared uniforms', () => {
  const plan = createFixturePlan(1);

  it('start from the mood and the tier', () => {
    const u = createSharedUniforms(plan, QUALITY.medium, MOODS.sunset);
    expect(u.uFar.value.x).toBe(QUALITY.medium.fadeStart);
    expect(u.uFar.value.y).toBe(QUALITY.medium.fadeEnd);
    expect(u.uPalette.value.length).toBe(8);
    expect(u.uPalette.value[1]!.z).toBeCloseTo(PALETTE[1]![2], 6);
    expect(plan.cells.length).toBe(CELLS * CELLS * CELL_STRIDE);
    expect(u.uReflAmount.value).toBe(0);
  });

  it('ease towards a new mood and arrive', () => {
    const u = createSharedUniforms(plan, QUALITY.high, MOODS.sunset);
    const driver = new MoodDriver(u, 'sunset');
    driver.set('midnight', false);
    const start = u.uSkyTop.value.x;
    driver.update(0.1);
    const mid = u.uSkyTop.value.x;
    expect(Math.abs(mid - MOODS.midnight.skyTop[0])).toBeLessThan(Math.abs(start - MOODS.midnight.skyTop[0]));
    for (let i = 0; i < 200; i++) driver.update(0.1);
    expect(u.uSkyTop.value.x).toBeCloseTo(MOODS.midnight.skyTop[0], 5);
    expect(u.uStars.value).toBeCloseTo(MOODS.midnight.stars, 4);
    expect(u.uSunDir.value.length()).toBeCloseTo(1, 6);
    expect(u.uPalette.value[0]!.z).toBeCloseTo(PALETTE[0]![2] * MOODS.midnight.tint[2], 4);
  });

  it('set immediate jumps', () => {
    const u = createSharedUniforms(plan, QUALITY.high, MOODS.sunset);
    const driver = new MoodDriver(u, 'sunset');
    driver.set('miami', true);
    expect(u.uExposure.value).toBeCloseTo(MOODS.miami.exposure, 6);
    expect(u.uFog.value.x).toBeCloseTo(MOODS.miami.fog[0], 9);
  });
});
