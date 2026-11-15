import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED, CAMERA_RADIUS, MAX_ALTITUDE, createFlightState, moveAndSlide, stepFlight, stepTowards, topSpeed,
  type FlightState,
} from '../../../src/camera/flight';
import { createCityPlan } from '../../../src/city/index';
import { AVENUE_EVERY, CELL, TILE } from '../../../src/contracts/constants';
import { wrapDelta } from '../../../src/core/math';
import { blocked, emptyPlan } from './helpers';

const plan = createCityPlan(1984);
const mega = plan.landmarks.find((l) => l.kind === 'megatower')!;
const downtown = plan.landmarks.find((l) => l.kind === 'downtown')!;

/** The x of a megatower's east wall near the ground, found by walking out from its centre. */
function eastWall(): number {
  let inside = mega.x;
  while (plan.heightAt(inside + 0.5, mega.z) > 0) inside += 0.5;
  let outside = inside + 0.5;
  for (let i = 0; i < 40; i++) {
    const mid = (inside + outside) / 2;
    if (plan.heightAt(mid, mega.z) > 0) inside = mid;
    else outside = mid;
  }
  return inside;
}

function at(x: number, y: number, z: number, yaw = 0, pitch = 0): FlightState {
  const s = createFlightState();
  s.x = x;
  s.y = y;
  s.z = z;
  s.yaw = yaw;
  s.pitch = pitch;
  return s;
}

const avenueX = Math.round(downtown.cellX / AVENUE_EVERY) * AVENUE_EVERY * CELL;
const RUN_START = { x: avenueX, y: 1100, z: downtown.z + 900 };

/**
 * Fly with fixed controls for a time at a frame rate, above every roof so nothing is in the way.
 * The second half is boosted. The look turns at a steady rate, as a held stick would.
 */
function run(hz: number, seconds: number, turnRate: number): FlightState {
  const s = at(RUN_START.x, RUN_START.y, RUN_START.z, 0.2, 0.05);
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) {
    s.yaw += turnRate / hz;
    stepFlight(plan, s, 1, 0.4, -0.3, i >= n / 2, 1 / hz);
  }
  return s;
}

function apart(a: FlightState, b: { x: number; y: number; z: number }): number {
  return Math.hypot(wrapDelta(a.x, b.x, TILE), a.y - b.y, wrapDelta(a.z, b.z, TILE));
}

describe('free flight: frame-rate independence', () => {
  it('flies the same path at 30, 60 and 144 Hz', () => {
    const a = run(30, 6, 0), b = run(60, 6, 0), c = run(144, 6, 0);
    const flown = apart(b, RUN_START);
    // Six seconds, the second half boosted: well over a kilometre.
    expect(flown).toBeGreaterThan(1200);
    // 30 Hz and 60 Hz take identical physics steps; 144 Hz differs only through the altitude term.
    expect(apart(a, b)).toBeLessThan(0.01);
    expect(apart(c, b)).toBeLessThan(flown * 0.001);
    expect(Math.hypot(c.vx - b.vx, c.vy - b.vy, c.vz - b.vz)).toBeLessThan(0.5);
  });

  it('stays within 1.5% of the distance flown while turning, where the frame size shows most', () => {
    // The look arrives once per frame, so a slower frame rate turns in coarser steps.
    const a = run(30, 5, 0.5), b = run(60, 5, 0.5), c = run(144, 5, 0.5);
    const flown = apart(b, RUN_START);
    expect(flown).toBeGreaterThan(500);
    expect(apart(a, b)).toBeLessThan(flown * 0.015);
    expect(apart(c, b)).toBeLessThan(flown * 0.015);
  });

  it('a 100 ms frame lands where six 60 Hz frames do', () => {
    const slow = at(RUN_START.x, 300, RUN_START.z, 0.2, 0.3), fast = at(RUN_START.x, 300, RUN_START.z, 0.2, 0.3);
    stepFlight(plan, slow, 1, 0, 0, true, 0.1);
    for (let i = 0; i < 6; i++) stepFlight(plan, fast, 1, 0, 0, true, 0.1 / 6);
    expect(apart(slow, fast)).toBeLessThan(1e-6);
  });

  it('does not move when dt is zero', () => {
    const s = at(1000, 300, 1000);
    s.vx = 30;
    stepFlight(plan, s, 1, 0, 0, false, 0);
    expect(s.x).toBe(1000);
    expect(s.vx).toBe(30);
  });

  it('reaches its top speed and no more, and is faster higher up', () => {
    const bare = emptyPlan();
    const s = at(100, 50, 100);
    for (let i = 0; i < 600; i++) stepFlight(bare, s, 1, 0, 0, false, 1 / 60);
    expect(Math.hypot(s.vx, s.vy, s.vz)).toBeCloseTo(topSpeed(50, false), 1);
    expect(topSpeed(0, false)).toBe(BASE_SPEED);
    expect(topSpeed(600, false)).toBeGreaterThan(topSpeed(50, false));
    expect(topSpeed(50, true)).toBeGreaterThan(3 * topSpeed(50, false));
  });

  it('coasts to a stop when the controls are released', () => {
    const bare = emptyPlan();
    const s = at(100, 50, 100);
    s.vz = -40;
    for (let i = 0; i < 300; i++) stepFlight(bare, s, 0, 0, 0, false, 1 / 60);
    expect(Math.hypot(s.vx, s.vy, s.vz)).toBeLessThan(0.01);
    // Stopping distance is speed / RESPONSE.
    expect(100 - s.z).toBeCloseTo(40 / 3, 1);
  });
});

describe('free flight: collision', () => {
  const wall = eastWall();

  it('found a real wall to test against', () => {
    expect(wall - mega.x).toBeGreaterThan(30);
    expect(blocked(plan, wall - 3, 30, mega.z, 1)).toBe(true);
    expect(blocked(plan, wall + 3, 30, mega.z, 1)).toBe(false);
  });

  it('flies at a wall and slides along it', () => {
    // Heading -x and -z at 45 degrees, into the megatower's east face.
    const s = at(wall + 9, 30, mega.z + 40, Math.PI / 4, 0);
    let minX = Infinity, touched = false;
    for (let i = 0; i < 90; i++) {
      if (stepFlight(plan, s, 1, 0, 0, false, 1 / 60)) touched = true;
      minX = Math.min(minX, s.x);
      expect(blocked(plan, s.x, s.y, s.z, CAMERA_RADIUS * 0.98)).toBe(false);
    }
    expect(touched).toBe(true);
    // It stopped a radius short of the wall...
    expect(minX).toBeGreaterThan(wall + CAMERA_RADIUS - 0.01);
    expect(s.x).toBeLessThan(wall + CAMERA_RADIUS + 0.05);
    // ...lost its speed into the wall and kept its speed along it.
    expect(Math.abs(s.vx)).toBeLessThan(0.01);
    expect(s.vz).toBeLessThan(-25);
    expect(mega.z + 40 - s.z).toBeGreaterThan(25);
  });

  it('does not tunnel through a wall at boost speed with a long frame', () => {
    const s = at(wall + 40, 30, mega.z, Math.PI / 2, 0);
    s.vx = -900;
    for (let i = 0; i < 5; i++) {
      stepFlight(plan, s, 1, 0, 0, true, 0.1);
      expect(s.x).toBeGreaterThan(wall + CAMERA_RADIUS - 0.01);
      expect(blocked(plan, s.x, s.y, s.z, CAMERA_RADIUS * 0.98)).toBe(false);
    }
    expect(s.vx).toBeGreaterThan(-0.01);
  });

  it('cannot go below eye height or above the ceiling', () => {
    const low = at((mega.cellX + 1) * CELL, 10, mega.z + 400, 0, -1.2);
    for (let i = 0; i < 120; i++) stepFlight(plan, low, 1, 0, -1, false, 1 / 60);
    expect(low.y).toBeCloseTo(CAMERA_RADIUS, 6);
    const high = at(1000, MAX_ALTITUDE - 5, 1000, 0, 1.2);
    for (let i = 0; i < 120; i++) stepFlight(plan, high, 1, 0, 1, true, 1 / 60);
    expect(high.y).toBe(MAX_ALTITUDE);
    expect(high.vy).toBeLessThanOrEqual(0);
  });

  it('keeps x and z wrapped, without a jump in velocity', () => {
    const bare = emptyPlan();
    const s = at(TILE - 1, 100, 5, -Math.PI / 2, 0);
    let last = s.x, lastV = 0;
    for (let i = 0; i < 120; i++) {
      stepFlight(bare, s, 1, 0, 0, false, 1 / 60);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(TILE);
      const step = wrapDelta(s.x, last, TILE);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(2);
      expect(s.vx - lastV).toBeLessThan(3);
      last = s.x;
      lastV = s.vx;
    }
    expect(s.x).toBeLessThan(200);
  });

  it('moveAndSlide reports a touch and leaves the sphere outside', () => {
    const s = at(wall + 5, 30, mega.z);
    s.vx = -10;
    expect(moveAndSlide(plan, s, -10, 0, 0)).toBe(true);
    expect(s.x).toBeCloseTo(wall + CAMERA_RADIUS, 3);
    expect(s.vx).toBeCloseTo(0, 6);
  });
});

describe('flying to a point', () => {
  it('arrives without overshooting and stops there', () => {
    const bare = emptyPlan();
    const s = at(100, 50, 100);
    let maxSpeed = 0;
    for (let i = 0; i < 600; i++) {
      stepTowards(bare, s, 160, 80, 100, 1.6, 120, 1 / 60);
      expect(s.x).toBeLessThan(160.001);
      maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vy, s.vz));
    }
    expect(s.x).toBeCloseTo(160, 2);
    expect(s.y).toBeCloseTo(80, 2);
    expect(Math.hypot(s.vx, s.vy, s.vz)).toBeLessThan(0.01);
    expect(maxSpeed).toBeLessThan(60);
  });

  it('takes the short way round the tile and caps its speed from far away', () => {
    const bare = emptyPlan();
    const s = at(TILE - 20, 50, 100);
    stepTowards(bare, s, 30, 50, 100, 1.6, 120, 0.5);
    expect(s.vx).toBeGreaterThan(0);
    const far = at(100, 50, 100);
    let maxSpeed = 0;
    for (let i = 0; i < 600; i++) {
      stepTowards(bare, far, 100, 1400, 100, 1.6, 120, 1 / 60);
      maxSpeed = Math.max(maxSpeed, Math.abs(far.vy));
    }
    expect(maxSpeed).toBeLessThan(1.6 * 120 * 0.55);
    expect(maxSpeed).toBeGreaterThan(60);
  });

  it('is the same at any frame rate', () => {
    const bare = emptyPlan();
    const a = at(100, 50, 100), b = at(100, 50, 100);
    a.vz = b.vz = 30;
    for (let i = 0; i < 30; i++) stepTowards(bare, a, 150, 60, 90, 1.6, 120, 1 / 30);
    for (let i = 0; i < 144; i++) stepTowards(bare, b, 150, 60, 90, 1.6, 120, 1 / 144);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
    expect(a.vz).toBeCloseTo(b.vz, 6);
  });
});
