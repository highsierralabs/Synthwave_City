import { describe, expect, it } from 'vitest';
import { createCityPlan } from '../../../src/city/index';
import {
  AVENUE, CELL, LOOP_SECONDS, SKY_LANE_MAX_WEAVE, SKY_LANE_OFFSET, SKY_LANE_Y_X, SKY_LANE_Y_Z, TILE,
} from '../../../src/contracts/constants';
import { QUALITY } from '../../../src/contracts/quality';
import { wrapDelta } from '../../../src/core/math';
import {
  BIG_SHIP_FLOOR, CRAFT, CRAFT_STRIDE, HERO, HERO_FIELD, HERO_LIMITS, HERO_STRIDE, LANE_TUBE_HALF_HEIGHT, LANE_TUBE_HALF_WIDTH,
  LAP_SPEED, PHASE_JITTER, ROOF_CLEARANCE, SHAPE, SHAPE_COUNT, SHAPE_LIMITS, avenueLines, craftState, heroState, packCraft,
  planHeroes, skyLanes, type CraftState, type HeroState,
} from '../../../src/layers/airtraffic/pack';

const plan = createCityPlan(1984);
const sky = skyLanes(plan.lanes);
const SEED = 4242;
const full = packCraft(plan.lanes, 1, SEED);
const field = (i: number, f: number): number => full.data[i * CRAFT_STRIDE + f]!;
const state = (): CraftState => ({ x: 0, y: 0, z: 0, along: 0, lateral: 0 });
const LONGEST_HULL = Math.max(...SHAPE_LIMITS.map((l) => 2 * l.halfLength * l.maxScale));

describe('air traffic: the packer', () => {
  it('is deterministic, and the seed matters', () => {
    const again = packCraft(plan.lanes, 1, SEED);
    expect(again.count).toBe(full.count);
    expect(Buffer.from(again.data.buffer).equals(Buffer.from(full.data.buffer))).toBe(true);
    const other = packCraft(plan.lanes, 1, SEED + 1);
    expect(Buffer.from(other.data.buffer).equals(Buffer.from(full.data.buffer))).toBe(false);
  });

  it('fills the sky with 8,000 to 12,000 craft at full density, and fewer on lower tiers', () => {
    expect(sky.length).toBe(160);
    for (const seed of [SEED, 1, 2, 3, 1984]) {
      const count = packCraft(plan.lanes, 1, seed).count;
      expect(count).toBeGreaterThanOrEqual(8000);
      expect(count).toBeLessThanOrEqual(12000);
    }
    const medium = packCraft(plan.lanes, QUALITY.medium.density, SEED);
    const low = packCraft(plan.lanes, QUALITY.low.density, SEED);
    expect(medium.count / full.count).toBeGreaterThan(0.55);
    expect(medium.count / full.count).toBeLessThan(0.65);
    expect(low.count / full.count).toBeGreaterThan(0.3);
    expect(low.count / full.count).toBeLessThan(0.4);
    expect(packCraft([], 1, SEED).count).toBe(0);
  });

  it('is sorted by shape, with every shape present', () => {
    expect(full.shapeStart.length).toBe(SHAPE_COUNT + 1);
    expect(full.shapeStart[0]).toBe(0);
    expect(full.shapeStart[SHAPE_COUNT]).toBe(full.count);
    for (let s = 0; s < SHAPE_COUNT; s++) {
      expect(full.shapeStart[s + 1]!).toBeGreaterThan(full.shapeStart[s]!);
      for (let i = full.shapeStart[s]!; i < full.shapeStart[s + 1]!; i++) expect(field(i, CRAFT.shape)).toBe(s);
    }
    // Mostly cars.
    expect(full.shapeStart[SHAPE.car + 1]! - full.shapeStart[SHAPE.car]!).toBeGreaterThan(full.count * 0.5);
  });

  it('gives every craft loop-periodic motion at 25 to 70 m/s, faster in higher lanes', () => {
    const speedBySlot = [0, 0, 0, 0];
    const countBySlot = [0, 0, 0, 0];
    for (let i = 0; i < full.count; i++) {
      const laps = field(i, CRAFT.laps);
      expect(Number.isInteger(laps)).toBe(true);
      expect(Number.isInteger(field(i, CRAFT.weaveCycles))).toBe(true);
      expect(Number.isInteger(field(i, CRAFT.bobCycles))).toBe(true);
      expect(field(i, CRAFT.weaveCycles)).toBeGreaterThan(0);
      expect(field(i, CRAFT.bobCycles)).toBeGreaterThan(0);
      const speed = laps * LAP_SPEED;
      expect(speed).toBeGreaterThanOrEqual(25);
      expect(speed).toBeLessThanOrEqual(70);
      expect(Math.abs(field(i, CRAFT.dir))).toBe(1);
      const seed = field(i, CRAFT.seed);
      expect(seed * 4096).toBe(Math.floor(seed * 4096));
      expect(field(i, CRAFT.trail)).toBeGreaterThanOrEqual(30);
      expect(field(i, CRAFT.trail)).toBeLessThanOrEqual(120);
      const lim = SHAPE_LIMITS[field(i, CRAFT.shape)]!;
      expect(field(i, CRAFT.scale)).toBeGreaterThanOrEqual(lim.minScale - 1e-6);
      expect(field(i, CRAFT.scale)).toBeLessThanOrEqual(lim.maxScale + 1e-6);
      for (const c of [CRAFT.engineColor, CRAFT.accentColor]) {
        expect(Number.isInteger(field(i, c))).toBe(true);
        expect(field(i, c)).toBeGreaterThanOrEqual(0);
        expect(field(i, c)).toBeLessThanOrEqual(7);
      }
      const slot = sky[full.laneOf[i]!]!.slot;
      speedBySlot[slot]! += speed;
      countBySlot[slot]!++;
    }
    const mean = speedBySlot.map((s, k) => s / countBySlot[k]!);
    expect(mean[1]!).toBeGreaterThan(mean[0]!);
    expect(mean[2]!).toBeGreaterThan(mean[1]!);
    expect(mean[3]!).toBeGreaterThan(mean[2]!);
  });
});

describe('air traffic: craft stay in their lane tube', () => {
  it('lane tubes of crossing streams do not overlap, and a tube fits the avenue corridor', () => {
    for (const yx of SKY_LANE_Y_X) {
      for (const yz of SKY_LANE_Y_Z) expect(Math.abs(yx - yz)).toBeGreaterThan(2 * LANE_TUBE_HALF_HEIGHT);
    }
    expect(SKY_LANE_OFFSET + LANE_TUBE_HALF_WIDTH).toBeLessThanOrEqual(AVENUE.corridorHalf);
    expect(SKY_LANE_OFFSET - LANE_TUBE_HALF_WIDTH).toBeLessThan(0.01 + SKY_LANE_OFFSET);
  });

  it('by construction: offsets, sway and hull stay inside the tube and off the centre line', () => {
    for (let i = 0; i < full.count; i++) {
      const lane = sky[full.laneOf[i]!]!;
      const lim = SHAPE_LIMITS[field(i, CRAFT.shape)]!;
      const scale = field(i, CRAFT.scale);
      const side = Math.abs(wrapDelta(field(i, CRAFT.fixed), lane.fixed, TILE));
      const lateral = side + field(i, CRAFT.weaveAmp);
      // The contract's limit on the weave, then the hull on top of it.
      expect(lateral).toBeLessThanOrEqual(SKY_LANE_MAX_WEAVE + 1e-4);
      expect(lateral).toBeLessThanOrEqual(lim.lateral + 1e-4);
      expect(lateral + lim.halfWidth * scale).toBeLessThanOrEqual(LANE_TUBE_HALF_WIDTH);
      // It never reaches the avenue's centre line, where the opposite stream begins.
      expect(lateral + lim.halfWidth * scale).toBeLessThan(SKY_LANE_OFFSET);
      const vertical = Math.abs(field(i, CRAFT.y) - lane.y) + field(i, CRAFT.bobAmp);
      expect(vertical + lim.halfHeight * scale).toBeLessThanOrEqual(LANE_TUBE_HALF_HEIGHT);
      expect(field(i, CRAFT.axis)).toBe(lane.axis);
      expect(field(i, CRAFT.dir)).toBe(lane.dir);
    }
  });

  it('in motion: sampled positions are inside the avenue corridor and over open road', () => {
    const s = state();
    for (let i = 0; i < full.count; i += 7) {
      const lane = sky[full.laneOf[i]!]!;
      const lim = SHAPE_LIMITS[field(i, CRAFT.shape)]!;
      const reach = lim.halfWidth * field(i, CRAFT.scale);
      for (let k = 0; k < 12; k++) {
        craftState(full.data, i, (k * 0.0831 + i * 0.000173) % 1, s);
        const cross = lane.axis === 0 ? s.z : s.x;
        const fromCentre = Math.abs(wrapDelta(cross, lane.line * CELL, TILE));
        expect(fromCentre + reach).toBeLessThanOrEqual(AVENUE.corridorHalf);
        expect(fromCentre - reach).toBeGreaterThan(0);
        expect(Math.abs(s.y - lane.y)).toBeLessThanOrEqual(LANE_TUBE_HALF_HEIGHT);
        // The plan agrees: nothing is built under either flank of the craft.
        for (const off of [-reach, reach]) {
          const x = lane.axis === 0 ? s.x : s.x + off;
          const z = lane.axis === 0 ? s.z + off : s.z;
          expect(plan.heightAt(x, z)).toBe(0);
        }
      }
    }
  });
});

describe('air traffic: spacing and the loop seam', () => {
  it('craft in a lane share one speed and keep a gap longer than the longest hull', () => {
    const byLane = new Map<number, number[]>();
    for (let i = 0; i < full.count; i++) {
      const list = byLane.get(full.laneOf[i]!) ?? [];
      list.push(i);
      byLane.set(full.laneOf[i]!, list);
    }
    expect(byLane.size).toBe(sky.length);
    let smallest = Infinity;
    for (const list of byLane.values()) {
      const laps = field(list[0]!, CRAFT.laps);
      for (const i of list) expect(field(i, CRAFT.laps)).toBe(laps);
      const phases = list.map((i) => field(i, CRAFT.phase)).sort((a, b) => a - b);
      const spacing = TILE / list.length;
      expect(spacing).toBeGreaterThanOrEqual(70);
      expect(spacing).toBeLessThanOrEqual(160);
      for (let k = 0; k < phases.length; k++) {
        const next = k + 1 < phases.length ? phases[k + 1]! : phases[0]! + 1;
        const gap = (next - phases[k]!) * TILE;
        smallest = Math.min(smallest, gap);
        expect(gap).toBeGreaterThanOrEqual(spacing * (1 - 2 * PHASE_JITTER) - 0.01);
      }
    }
    expect(smallest).toBeGreaterThan(LONGEST_HULL + 5);
  });

  it('is continuous across the loop seam', () => {
    const a = state();
    const b = state();
    const dtSeconds = 1 / 120;
    const eps = dtSeconds / LOOP_SECONDS;
    for (let i = 0; i < full.count; i += 3) {
      craftState(full.data, i, 1 - eps, a);
      craftState(full.data, i, eps, b);
      const speed = field(i, CRAFT.laps) * LAP_SPEED;
      const moved = Math.hypot(wrapDelta(b.x, a.x, TILE), b.y - a.y, wrapDelta(b.z, a.z, TILE));
      // Two frames at 120 Hz: the craft moved about speed * 2 dt, as it does anywhere else in the loop.
      expect(moved).toBeGreaterThan(speed * 2 * dtSeconds * 0.9);
      expect(moved).toBeLessThan(speed * 2 * dtSeconds * 1.1 + 0.05);
      // And the motion is exactly periodic.
      craftState(full.data, i, 0, a);
      craftState(full.data, i, 1, b);
      expect(Math.abs(wrapDelta(b.x, a.x, TILE))).toBeLessThan(1e-6);
      expect(Math.abs(b.y - a.y)).toBeLessThan(1e-6);
      expect(Math.abs(wrapDelta(b.z, a.z, TILE))).toBeLessThan(1e-6);
    }
  });

  it('moves each craft the way its lane points', () => {
    const a = state();
    const b = state();
    for (let i = 0; i < full.count; i += 11) {
      craftState(full.data, i, 0.25, a);
      craftState(full.data, i, 0.25 + 1 / LOOP_SECONDS, b);
      expect(Math.sign(wrapDelta(b.along, a.along, TILE))).toBe(field(i, CRAFT.dir));
    }
  });
});

describe('air traffic: hero ships', () => {
  const heroes = planHeroes(plan.cells, plan.landmarks, SEED);
  const h = (i: number, f: number): number => heroes.data[i * HERO_STRIDE + f]!;
  const laneLevels = [...SKY_LANE_Y_X, ...SKY_LANE_Y_Z];

  it('plans two of each type, deterministically', () => {
    expect(heroes.count).toBe(6);
    const types = [0, 0, 0];
    for (let i = 0; i < heroes.count; i++) types[h(i, HERO_FIELD.type)]!++;
    expect(types).toEqual([2, 2, 2]);
    const again = planHeroes(plan.cells, plan.landmarks, SEED);
    expect(Buffer.from(again.data.buffer).equals(Buffer.from(heroes.data.buffer))).toBe(true);
    for (let i = 0; i < heroes.count; i++) {
      expect(Number.isInteger(h(i, HERO_FIELD.laps))).toBe(true);
      expect(h(i, HERO_FIELD.laps)).toBe(HERO_LIMITS[h(i, HERO_FIELD.type)]!.laps);
      expect(h(i, HERO_FIELD.fixed) % (CELL * 4)).toBe(0);
    }
  });

  it('keeps the wide ships on one axis and on different avenues, so they never meet', () => {
    const wide = [...Array(heroes.count).keys()].filter((i) => h(i, HERO_FIELD.type) !== HERO.patrol);
    const axes = new Set(wide.map((i) => h(i, HERO_FIELD.axis)));
    expect(axes.size).toBe(1);
    expect(new Set(wide.map((i) => h(i, HERO_FIELD.fixed))).size).toBe(wide.length);
  });

  it('flies the wide ships above every sky lane and every roof under them', () => {
    const lines = avenueLines(plan.cells);
    const s: HeroState = { x: 0, y: 0, z: 0, along: 0 };
    for (let i = 0; i < heroes.count; i++) {
      const type = h(i, HERO_FIELD.type);
      if (type === HERO.patrol) continue;
      const lim = HERO_LIMITS[type]!;
      const underside = h(i, HERO_FIELD.y) - lim.below - lim.bobAmp;
      expect(underside).toBeGreaterThanOrEqual(BIG_SHIP_FLOOR);
      for (const level of laneLevels) expect(underside).toBeGreaterThan(level + LANE_TUBE_HALF_HEIGHT);
      const info = lines.find((l) => l.axis === h(i, HERO_FIELD.axis) && l.line * CELL === h(i, HERO_FIELD.fixed))!;
      expect(underside).toBeGreaterThanOrEqual(info.tallest + ROOF_CLEARANCE);
      // Against the real boxes: sweep the whole route under the ship's full width.
      const alongZ = h(i, HERO_FIELD.axis) === 1;
      let tallest = 0;
      for (let along = 0; along < TILE; along += 8) {
        for (let off = -lim.halfWidth; off <= lim.halfWidth; off += 3) {
          const x = alongZ ? h(i, HERO_FIELD.fixed) + off : along;
          const z = alongZ ? along : h(i, HERO_FIELD.fixed) + off;
          tallest = Math.max(tallest, plan.heightAt(x, z));
        }
      }
      expect(underside).toBeGreaterThan(tallest + 10);
      for (let k = 0; k < 40; k++) {
        heroState(heroes.data, i, k / 40, s);
        expect(Math.abs(s.y - h(i, HERO_FIELD.y))).toBeLessThanOrEqual(lim.bobAmp + 1e-9);
      }
    }
  });

  it('threads the patrol craft through the canyon between lane levels', () => {
    const patrols = [...Array(heroes.count).keys()].filter((i) => h(i, HERO_FIELD.type) === HERO.patrol);
    expect(patrols.length).toBe(2);
    const lim = HERO_LIMITS[HERO.patrol]!;
    expect(lim.halfWidth).toBeLessThan(AVENUE.corridorHalf);
    for (const i of patrols) {
      const y = h(i, HERO_FIELD.y);
      for (const level of laneLevels) {
        const clear = level > y ? level - LANE_TUBE_HALF_HEIGHT - (y + lim.above + lim.bobAmp) : y - lim.below - lim.bobAmp - (level + LANE_TUBE_HALF_HEIGHT);
        expect(clear).toBeGreaterThan(2);
      }
    }
    // Two patrols never meet: different altitudes.
    expect(Math.abs(h(patrols[0]!, HERO_FIELD.y) - h(patrols[1]!, HERO_FIELD.y))).toBeGreaterThan(lim.above + lim.below + 2 * lim.bobAmp);
  });

  it('moves hero ships periodically over the loop', () => {
    const a: HeroState = { x: 0, y: 0, z: 0, along: 0 };
    const b: HeroState = { x: 0, y: 0, z: 0, along: 0 };
    for (let i = 0; i < heroes.count; i++) {
      heroState(heroes.data, i, 0, a);
      heroState(heroes.data, i, 1, b);
      expect(Math.abs(wrapDelta(b.x, a.x, TILE)) + Math.abs(b.y - a.y) + Math.abs(wrapDelta(b.z, a.z, TILE))).toBeLessThan(1e-6);
      expect(Number.isInteger(HERO_LIMITS[h(i, HERO_FIELD.type)]!.bobCycles)).toBe(true);
    }
  });

  it('copes with other cities', () => {
    for (const seed of [1, 7, 99]) {
      const other = createCityPlan(seed);
      const pack = planHeroes(other.cells, other.landmarks, seed);
      expect(pack.count).toBe(6);
      const lines = avenueLines(other.cells);
      for (let i = 0; i < pack.count; i++) {
        const o = i * HERO_STRIDE;
        const type = pack.data[o + HERO_FIELD.type]!;
        if (type === HERO.patrol) continue;
        const lim = HERO_LIMITS[type]!;
        const info = lines.find((l) => l.axis === pack.data[o + HERO_FIELD.axis] && l.line * CELL === pack.data[o + HERO_FIELD.fixed])!;
        expect(pack.data[o + HERO_FIELD.y]! - lim.below - lim.bobAmp).toBeGreaterThanOrEqual(info.tallest + ROOF_CLEARANCE);
      }
    }
  });
});
