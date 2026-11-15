import { describe, expect, it } from 'vitest';
import { CORNER_LIMITS, CORNER_MARGIN, CORNER_MARGIN_AVENUE, MAX_ROLL, SMOOTH, TOUR_MIN_Y, Tour, cornerLimit, createTourSample } from '../../../src/camera/tour';
import { createCityPlan } from '../../../src/city/index';
import { AVENUE, CELL, STREET, TILE } from '../../../src/contracts/constants';
import { angleDelta, wrapDelta } from '../../../src/core/math';
import { blocked, corridorMargin, emptyPlan } from './helpers';

const plan = createCityPlan(1984);
const DEG = 180 / Math.PI;

interface RunStats {
  hits: number;
  minMargin: number;
  minY: number;
  maxY: number;
  minSpeed: number;
  maxSpeed: number;
  maxStep: number;
  maxYawRate: number;
  maxPitchRate: number;
  maxRoll: number;
  maxPitch: number;
  allFinite: boolean;
  inTile: boolean;
  low: number;
  high: number;
  quarterTurns: number;
  megasPassed: number;
}

/** Fly a tour for a while at a fixed step and measure it. */
function fly(tour: Tour, p: ReturnType<typeof createCityPlan>, seconds: number, hz: number, from = 0): RunStats {
  const s = createTourSample();
  const dt = 1 / hz;
  const megas = p.landmarks.filter((l) => l.kind === 'megatower');
  const near = new Set<number>();
  const r: RunStats = {
    hits: 0, minMargin: Infinity, minY: Infinity, maxY: 0, minSpeed: Infinity, maxSpeed: 0, maxStep: 0,
    maxYawRate: 0, maxPitchRate: 0, maxRoll: 0, maxPitch: 0, allFinite: true, inTile: true, low: 0, high: 0,
    quarterTurns: 0, megasPassed: 0,
  };
  let px = 0, py = 0, pz = 0, pYaw = 0, pPitch = 0, turned = 0, heading = 0;
  const n = Math.round(seconds * hz);
  for (let i = 0; i <= n; i++) {
    tour.sample(from + i * dt, s);
    if (![s.x, s.y, s.z, s.yaw, s.pitch, s.roll, s.vx, s.vy, s.vz, s.speed].every(Number.isFinite)) r.allFinite = false;
    if (s.x < 0 || s.x >= TILE || s.z < 0 || s.z >= TILE) r.inTile = false;
    if (blocked(p, s.x, s.y, s.z, 2)) r.hits++;
    r.minMargin = Math.min(r.minMargin, corridorMargin(s.x, s.z));
    r.minY = Math.min(r.minY, s.y);
    r.maxY = Math.max(r.maxY, s.y);
    r.minSpeed = Math.min(r.minSpeed, s.speed);
    r.maxSpeed = Math.max(r.maxSpeed, s.speed);
    r.maxRoll = Math.max(r.maxRoll, Math.abs(s.roll));
    r.maxPitch = Math.max(r.maxPitch, Math.abs(s.pitch));
    if (s.y < 30) r.low++;
    if (s.y > 480) r.high++;
    for (let m = 0; m < megas.length; m++) {
      if (Math.hypot(wrapDelta(megas[m]!.x, s.x, TILE), wrapDelta(megas[m]!.z, s.z, TILE)) < 150) near.add(m);
    }
    const travel = Math.atan2(-s.vx, -s.vz);
    if (i === 0) heading = travel;
    else {
      const step = Math.hypot(wrapDelta(s.x, px, TILE), s.y - py, wrapDelta(s.z, pz, TILE));
      r.maxStep = Math.max(r.maxStep, step / dt);
      r.maxYawRate = Math.max(r.maxYawRate, Math.abs(angleDelta(pYaw, s.yaw)) / dt);
      r.maxPitchRate = Math.max(r.maxPitchRate, Math.abs(s.pitch - pPitch) / dt);
      turned += Math.abs(angleDelta(heading, travel));
      heading = travel;
    }
    px = s.x;
    py = s.y;
    pz = s.z;
    pYaw = s.yaw;
    pPitch = s.pitch;
  }
  r.low /= n;
  r.high /= n;
  r.quarterTurns = turned / (Math.PI / 2);
  r.megasPassed = near.size;
  return r;
}

describe('tour: corner speed limits', () => {
  it('are ordered street, mixed, avenue and sit in the range the plan asks for', () => {
    expect(CORNER_LIMITS[0]).toBeLessThan(CORNER_LIMITS[1]!);
    expect(CORNER_LIMITS[1]).toBeLessThan(CORNER_LIMITS[2]!);
    expect(CORNER_LIMITS[0]).toBeGreaterThan(17);
    expect(CORNER_LIMITS[2]).toBeLessThan(45);
  });

  it('a street corner cuts in by speed * SMOOTH / 6 at the limit', () => {
    const free = STREET.corridorHalf - CORNER_MARGIN;
    expect(cornerLimit(free, free)).toBeCloseTo((6 * free) / SMOOTH, 1);
    // A wider road on either side allows more speed, by the same amount whichever side it is on.
    const wide = AVENUE.corridorHalf - CORNER_MARGIN_AVENUE;
    expect(cornerLimit(free, wide)).toBeCloseTo(cornerLimit(wide, free), 1);
    expect(cornerLimit(free, wide)).toBeGreaterThan(cornerLimit(free, free));
  });
});

describe('tour: thirty minutes', () => {
  const stats = fly(new Tour(plan, 1984), plan, 30 * 60, 20);

  it('never touches a box (plan.collide, radius 2 m)', () => {
    expect(stats.hits).toBe(0);
  });

  it('stays inside road corridors with at least 3.4 m to the building line', () => {
    expect(stats.minMargin).toBeGreaterThan(3.4);
  });

  it('gives finite, wrapped poses', () => {
    expect(stats.allFinite).toBe(true);
    expect(stats.inTile).toBe(true);
  });

  it('keeps to its altitude and speed range', () => {
    expect(stats.minY).toBeGreaterThanOrEqual(TOUR_MIN_Y);
    expect(stats.maxY).toBeLessThan(1100);
    expect(stats.minSpeed).toBeGreaterThan(12);
    expect(stats.maxSpeed).toBeLessThan(63);
  });

  it('is varied: street level, above the roofs, many turns, more than one megatower', () => {
    expect(stats.low).toBeGreaterThan(0.08);
    expect(stats.high).toBeGreaterThan(0.08);
    expect(stats.quarterTurns).toBeGreaterThan(40);
    expect(stats.megasPassed).toBeGreaterThanOrEqual(2);
  });

  it('holds on other cities and other seeds', () => {
    const other = createCityPlan(7);
    const a = fly(new Tour(other, 7), other, 30 * 60, 20);
    expect(a.hits).toBe(0);
    expect(a.minMargin).toBeGreaterThan(3.4);
    expect(a.maxYawRate * DEG).toBeLessThan(50);
    expect(a.allFinite && a.inTile).toBe(true);
    const b = fly(new Tour(plan, 99), plan, 30 * 60, 20);
    expect(b.hits).toBe(0);
    expect(b.minMargin).toBeGreaterThan(3.4);
    expect(b.maxYawRate * DEG).toBeLessThan(50);
    expect(b.allFinite && b.inTile).toBe(true);
  });
});

describe('tour: motion quality at 60 Hz', () => {
  const stats = fly(new Tour(plan, 1984), plan, 12 * 60, 60);

  it('moves without jumps: no step is longer than the top speed allows', () => {
    expect(stats.maxStep).toBeLessThan(63);
  });

  it('never turns the view faster than 50 degrees a second', () => {
    expect(stats.maxYawRate * DEG).toBeLessThan(50);
    expect(stats.maxPitchRate * DEG).toBeLessThan(15);
  });

  it('banks, but gently, and never looks steeply up or down', () => {
    expect(stats.maxRoll).toBeGreaterThan(0.1);
    expect(stats.maxRoll).toBeLessThanOrEqual(MAX_ROLL);
    expect(stats.maxPitch).toBeLessThan(0.75);
  });

  it('has continuous velocity: it changes by less than 0.4 m/s between frames', () => {
    const tour = new Tour(plan, 1984);
    const s = createTourSample();
    let worst = 0, vx = 0, vy = 0, vz = 0;
    for (let i = 0; i <= 12 * 60 * 60; i++) {
      tour.sample(i / 60, s);
      if (i > 0) worst = Math.max(worst, Math.hypot(s.vx - vx, s.vy - vy, s.vz - vz));
      vx = s.vx;
      vy = s.vy;
      vz = s.vz;
    }
    expect(worst).toBeLessThan(0.4);
  });

  it('its velocity is the derivative of its position', () => {
    const tour = new Tour(plan, 1984);
    const a = createTourSample(), b = createTourSample(), mid = createTourSample();
    const h = 1e-3;
    for (const t of [3, 24.5, 26, 81.3, 140, 333.3, 1000.7]) {
      tour.sample(t - h, a);
      tour.sample(t + h, b);
      tour.sample(t, mid);
      expect(wrapDelta(b.x, a.x, TILE) / (2 * h)).toBeCloseTo(mid.vx, 3);
      expect((b.y - a.y) / (2 * h)).toBeCloseTo(mid.vy, 3);
      expect(wrapDelta(b.z, a.z, TILE) / (2 * h)).toBeCloseTo(mid.vz, 3);
    }
  });
});

describe('tour: a pure function of time', () => {
  it('gives the same pose for the same time, whatever was asked before', () => {
    const a = new Tour(plan, 1984), b = new Tour(plan, 1984);
    const sa = createTourSample(), sb = createTourSample();
    const times = [20, 21.5, 500, 3, 4095.9, 1234.56, 0, 77, 76.99, 2400];
    // b is dragged all over the clock first.
    for (const t of [3000, 10, 1800, 0.5]) b.sample(t, sb);
    for (const t of times) {
      a.sample(t, sa);
      b.sample(t, sb);
      expect(sb).toEqual(sa);
    }
    // And stepping there frame by frame arrives at the same pose as jumping there.
    const c = new Tour(plan, 1984);
    const sc = createTourSample();
    for (let i = 0; i <= 77 * 30; i++) c.sample(i / 30, sc);
    a.sample(77, sa);
    expect(sc).toEqual(sa);
  });

  it('differs with the seed', () => {
    const a = new Tour(plan, 1984), b = new Tour(plan, 5);
    const sa = createTourSample(), sb = createTourSample();
    a.sample(600, sa);
    b.sample(600, sb);
    expect(Math.hypot(wrapDelta(sa.x, sb.x, TILE), wrapDelta(sa.z, sb.z, TILE))).toBeGreaterThan(1);
  });

  it('still answers after six hours, with wrapped coordinates', () => {
    const tour = new Tour(plan, 1984);
    const s = createTourSample();
    tour.sample(6 * 3600, s);
    expect([s.x, s.y, s.z, s.yaw, s.pitch, s.roll].every(Number.isFinite)).toBe(true);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeLessThan(TILE);
    expect(blocked(plan, s.x, s.y, s.z, 2)).toBe(false);
    expect(corridorMargin(s.x, s.z)).toBeGreaterThan(3.4);
  });
});

describe('tour: starting somewhere else', () => {
  it('begins at the point it is given, heading the way it is told', () => {
    const tour = new Tour(plan, 1984);
    const s = createTourSample();
    const cases = [
      { x: 3 * CELL, y: 4, z: 1000, heading: 0 },
      { x: 3 * CELL + 5, y: 90, z: 1000, heading: 2 },
      { x: 777, y: 420, z: 8 * CELL, heading: 1 },
      { x: 6390, y: 900, z: 0, heading: 3 },
    ];
    for (const c of cases) {
      tour.restart(c, 31);
      tour.sample(0, s);
      const even = c.heading % 2 === 0;
      // It is snapped onto the line it runs along, and nowhere else.
      expect(Math.abs(wrapDelta(s.x, even ? Math.round(c.x / CELL) * CELL : c.x, TILE))).toBeLessThan(0.01);
      expect(Math.abs(wrapDelta(s.z, even ? c.z : Math.round(c.z / CELL) * CELL, TILE))).toBeLessThan(0.01);
      expect(s.y).toBeCloseTo(c.y, 6);
      expect(Math.abs(angleDelta(Math.atan2(-s.vx, -s.vz), (c.heading * Math.PI) / 2))).toBeLessThan(1e-6);
      const run = fly(tour, plan, 600, 20);
      expect(run.hits).toBe(0);
      expect(run.minMargin).toBeGreaterThan(3.4);
      expect(run.allFinite).toBe(true);
    }
  });

  it('works on a plan with no landmarks at all', () => {
    const bare = emptyPlan();
    const run = fly(new Tour(bare, 3), bare, 600, 20);
    expect(run.allFinite).toBe(true);
    expect(run.minMargin).toBeGreaterThan(3.4);
  });
});
