import { describe, expect, it } from 'vitest';
import { createCityPlan } from '../../../src/city/index';
import type { Site, SiteKind } from '../../../src/contracts/city';
import { QUALITY } from '../../../src/contracts/quality';
import {
  BEAM_KIND, BEAM_LIMITS, BEAM_STRIDE, EMITTER_SPACING, beamDirection, chooseEmitters, emitterSpacing, packBeams,
  type BeamSet, type EmitterKind,
} from '../../../src/layers/beams/pack';

const plan = createCityPlan(1984);
const SEED = 4242;
const packed = packBeams(plan.sites, 1, SEED);

const site = (kind: SiteKind, over: Partial<Site> = {}): Site => ({
  kind, x: 1000, y: 120, z: 2000, w: 1000, h: 2, d: 0, yaw: 0.3, color: 1, seed: 0.37, ...over,
});
const kindOf = (set: BeamSet, i: number): number => set.shape[i * 4 + 3]!;
const within = (v: number, range: readonly [number, number]): boolean => v >= range[0] - 1e-4 && v <= range[1] + 1e-4;

function countKind(set: BeamSet, kind: number): number {
  let n = 0;
  for (let i = 0; i < set.count; i++) if (kindOf(set, i) === kind) n++;
  return n;
}

describe('beam packer: what becomes a beam', () => {
  it('ignores every site that is not a searchlight, a pillar or a laser', () => {
    const others: SiteKind[] = ['holoPanel', 'holoObject', 'roofLight', 'ticker'];
    const out = packBeams(others.map((k) => site(k)), 1, SEED);
    expect(out.sky.count).toBe(0);
    expect(out.pillars.count).toBe(0);
    expect(out.sites).toEqual({ searchlight: 0, pillar: 0, laser: 0 });
  });

  it('puts searchlights and lasers in the unreflected set and pillars in the reflected one', () => {
    expect(packed.sky.count).toBeGreaterThan(0);
    expect(packed.pillars.count).toBeGreaterThan(0);
    for (let i = 0; i < packed.sky.count; i++) {
      expect([BEAM_KIND.searchlight, BEAM_KIND.laser]).toContain(kindOf(packed.sky, i));
    }
    for (let i = 0; i < packed.pillars.count; i++) expect(kindOf(packed.pillars, i)).toBe(BEAM_KIND.pillar);
  });

  it('makes one beam per pillar, 1 to 3 per searchlight and 5 to 9 per laser fan', () => {
    expect(packBeams([site('pillar', { y: 700, w: 8, h: 2600 })], 1, SEED).pillars.count).toBe(1);
    for (const h of [1, 2, 3]) {
      for (let k = 0; k < 40; k++) {
        const out = packBeams([site('searchlight', { h, seed: (k + 0.5) / 40 })], 1, SEED);
        expect(out.sky.count).toBe(h);
      }
    }
    // On a plaza floor each site is one light of a ring, whatever h says.
    expect(packBeams([site('searchlight', { y: 0.5, h: 3 })], 1, SEED).sky.count).toBe(1);
    for (const h of [5, 7, 9, 40]) {
      const out = packBeams([site('laser', { h, w: 2000 })], 1, SEED);
      expect(out.sky.count).toBe(Math.min(h, BEAM_LIMITS.laser.beams[1]));
    }
  });

  it('fills every array to exactly count * stride', () => {
    for (const set of [packed.sky, packed.pillars]) {
      for (const key of Object.keys(BEAM_STRIDE) as (keyof typeof BEAM_STRIDE)[]) {
        expect(set[key].length).toBe(set.count * BEAM_STRIDE[key]);
        for (const v of set[key]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('is deterministic, and a site packs the same whatever else is in the list', () => {
    const again = packBeams(plan.sites, 1, SEED);
    expect(again.sky.shape).toEqual(packed.sky.shape);
    expect(again.sky.tilt).toEqual(packed.sky.tilt);
    const lasers = plan.sites.filter((s) => s.kind === 'laser');
    const alone = packBeams(lasers.slice(0, 1), 1, SEED);
    const mixed = packBeams([site('roofLight'), ...lasers.slice(0, 1), site('ticker')], 1, SEED);
    expect(mixed.sky.look).toEqual(alone.sky.look);
    expect(mixed.sky.fan).toEqual(alone.sky.fan);
  });
});

describe('beam packer: ranges', () => {
  it('keeps lengths and radii inside the stated limits', () => {
    for (let i = 0; i < packed.sky.count; i++) {
      const o = i * 4;
      const length = packed.sky.shape[o]!, r0 = packed.sky.shape[o + 1]!, r1 = packed.sky.shape[o + 2]!;
      if (kindOf(packed.sky, i) === BEAM_KIND.searchlight) {
        expect(within(length, BEAM_LIMITS.searchlight.length)).toBe(true);
        expect(within(r0, BEAM_LIMITS.searchlight.startRadius)).toBe(true);
        expect(within(r1, BEAM_LIMITS.searchlight.endRadius)).toBe(true);
        expect(r1).toBeGreaterThan(r0);
      } else {
        expect(within(length, BEAM_LIMITS.laser.length)).toBe(true);
        expect(within(r0, BEAM_LIMITS.laser.radius)).toBe(true);
        expect(r1).toBe(r0);
      }
    }
    for (let i = 0; i < packed.pillars.count; i++) {
      const o = i * 4;
      expect(within(packed.pillars.shape[o]!, BEAM_LIMITS.pillar.length)).toBe(true);
      expect(within(packed.pillars.shape[o + 1]!, BEAM_LIMITS.pillar.radius)).toBe(true);
    }
  });

  it('clamps sites whose sizes are out of range', () => {
    const wild = [
      site('searchlight', { w: 90000, h: 1, seed: 0.11 }), site('searchlight', { w: 2, h: 1, seed: 0.12 }),
      site('pillar', { w: 500, h: 99999 }), site('pillar', { w: 0.1, h: 10 }),
      site('laser', { w: 50, h: 1 }), site('laser', { w: 1e6, h: 99 }),
    ];
    const out = packBeams(wild, 1, SEED);
    for (let i = 0; i < out.sky.count; i++) {
      const length = out.sky.shape[i * 4]!;
      const limits = kindOf(out.sky, i) === BEAM_KIND.laser ? BEAM_LIMITS.laser.length : BEAM_LIMITS.searchlight.length;
      expect(within(length, limits)).toBe(true);
    }
    expect(out.pillars.count).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(within(out.pillars.shape[i * 4]!, BEAM_LIMITS.pillar.length)).toBe(true);
      expect(within(out.pillars.shape[i * 4 + 1]!, BEAM_LIMITS.pillar.radius)).toBe(true);
    }
  });

  it('uses palette indices 0 to 7 and positive intensities', () => {
    for (const set of [packed.sky, packed.pillars]) {
      for (let i = 0; i < set.count; i++) {
        const colour = set.look[i * 4]!;
        expect(Number.isInteger(colour) && colour >= 0 && colour <= 7).toBe(true);
        expect(set.look[i * 4 + 2]!).toBeGreaterThan(0);
      }
    }
  });
});

describe('beam packer: motion', () => {
  const tiltOf = (d: readonly number[]): number => Math.acos(Math.min(1, Math.max(-1, d[1]!)));

  it('gives unit directions, searchlights 20 to 60 degrees off vertical, lasers above the horizon', () => {
    let lowest = 0;
    for (let i = 0; i < packed.sky.count; i++) {
      const kind = kindOf(packed.sky, i);
      for (let k = 0; k < 97; k++) {
        const d = beamDirection(packed.sky, i, (k * 0.61803398875) % 1);
        expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 5);
        const tilt = tiltOf(d);
        if (kind === BEAM_KIND.searchlight) expect(within(tilt, BEAM_LIMITS.searchlight.tilt)).toBe(true);
        else {
          expect(tilt).toBeLessThanOrEqual(BEAM_LIMITS.laser.maxTilt);
          lowest = Math.max(lowest, tilt);
        }
      }
    }
    // The fans do open: some beam leans well away from vertical at some moment.
    expect(lowest).toBeGreaterThan(0.6);
  });

  it('points pillars straight up at all times', () => {
    for (let i = 0; i < packed.pillars.count; i++) {
      for (const loop of [0, 0.123, 0.5, 0.999]) {
        const d = beamDirection(packed.pillars, i, loop);
        expect(d[0]).toBeCloseTo(0, 6);
        expect(d[1]).toBeCloseTo(1, 6);
        expect(d[2]).toBeCloseTo(0, 6);
      }
    }
  });

  it('wraps seamlessly: every rate is a whole number of cycles per loop', () => {
    for (const set of [packed.sky, packed.pillars]) {
      for (let i = 0; i < set.count; i++) {
        const o = i * 4;
        for (const rate of [set.tilt[o + 2]!, set.azim[o + 1]!, set.azim[o + 3]!, set.fan[o + 2]!, set.roll[o + 1]!]) {
          expect(Number.isInteger(rate)).toBe(true);
        }
        const a = beamDirection(set, i, 0), b = beamDirection(set, i, 1);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-4);
      }
    }
  });

  it('moves: a searchlight is somewhere else two seconds later', () => {
    let moved = 0, total = 0;
    for (let i = 0; i < packed.sky.count; i++) {
      if (kindOf(packed.sky, i) !== BEAM_KIND.searchlight) continue;
      const a = beamDirection(packed.sky, i, 0.25), b = beamDirection(packed.sky, i, 0.25 + 2 / 4096);
      total++;
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.002) moved++;
    }
    expect(moved / total).toBeGreaterThan(0.8);
  });

  it('spreads a laser fan evenly from -0.5 to 0.5', () => {
    const out = packBeams([site('laser', { h: 7, w: 2000 })], 1, SEED);
    const positions = Array.from({ length: out.sky.count }, (_, i) => out.sky.look[i * 4 + 3]!);
    expect(positions[0]).toBeCloseTo(-0.5, 6);
    expect(positions[6]).toBeCloseTo(0.5, 6);
    for (let i = 1; i < positions.length; i++) expect(positions[i]! - positions[i - 1]!).toBeCloseTo(1 / 6, 5);
  });
});

describe('beam packer: which emitters are lit', () => {
  const count = (kind: SiteKind): number => plan.sites.filter((s) => s.kind === kind).length;
  const wrapDist = (a: Site, b: Site): number => {
    const d = (p: number, q: number): number => {
      const v = Math.abs(p - q) % 6400;
      return Math.min(v, 6400 - v);
    };
    return Math.hypot(d(a.x, b.x), d(a.z, b.z));
  };
  const isRoofLight = (s: Site): boolean => s.kind === 'searchlight' && s.y >= 5;
  const isRingLight = (s: Site): boolean => s.kind === 'searchlight' && s.y < 5;
  const isPlazaPillar = (s: Site): boolean => s.kind === 'pillar' && s.y <= 5;
  const cellKey = (s: Site): string => `${Math.floor(s.x / 160)},${Math.floor(s.z / 160)}`;

  it('never lights a site that is not an emitter, and lights every megatower pillar at every tier', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const lit = chooseEmitters(plan.sites, QUALITY[tier].density, SEED);
      expect(lit.length).toBe(plan.sites.length);
      plan.sites.forEach((s, i) => {
        if (s.kind !== 'searchlight' && s.kind !== 'pillar' && s.kind !== 'laser') expect(lit[i]).toBe(false);
        if (s.kind === 'pillar' && s.y > 5) expect(lit[i]).toBe(true);
      });
    }
    expect(plan.sites.some((s) => s.kind === 'pillar' && s.y > 5)).toBe(true);
  });

  it('keeps lit emitters of one kind at least the spacing apart, on several layer seeds', () => {
    const kinds: [EmitterKind, (s: Site) => boolean][] = [
      ['searchlight', isRoofLight], ['plazaPillar', isPlazaPillar], ['laser', (s) => s.kind === 'laser'],
    ];
    for (const seed of [SEED, 1, 99, 123456]) {
      for (const density of [1, 0.6, 0.35]) {
        const lit = chooseEmitters(plan.sites, density, seed);
        for (const [kind, match] of kinds) {
          const kept = plan.sites.filter((s, i) => lit[i] && match(s));
          expect(kept.length).toBeGreaterThan(0);
          const spacing = emitterSpacing(kind, density);
          for (let a = 0; a < kept.length; a++) {
            for (let b = a + 1; b < kept.length; b++) expect(wrapDist(kept[a]!, kept[b]!)).toBeGreaterThanOrEqual(spacing - 1e-6);
          }
        }
        // A roof light also keeps its distance from the centre of every lit plaza ring.
        const ringCentres = new Map<string, Site>();
        plan.sites.forEach((s, i) => {
          if (!lit[i] || !isRingLight(s)) return;
          const cx = Math.floor(s.x / 160), cz = Math.floor(s.z / 160);
          ringCentres.set(cellKey(s), { ...s, x: (cx + 0.5) * 160, z: (cz + 0.5) * 160 });
        });
        const spacing = emitterSpacing('searchlight', density);
        for (const roof of plan.sites.filter((s, i) => lit[i] && isRoofLight(s))) {
          for (const centre of ringCentres.values()) expect(wrapDist(roof, centre)).toBeGreaterThanOrEqual(spacing - 1e-6);
        }
      }
    }
  });

  it('is maximal: every unlit emitter is within the spacing of a lit one of its kind', () => {
    const lit = chooseEmitters(plan.sites, 1, SEED);
    const lasers = plan.sites.map((s, i) => ({ s, on: lit[i]! })).filter((e) => e.s.kind === 'laser');
    expect(lasers.some((e) => !e.on)).toBe(true);
    for (const off of lasers.filter((e) => !e.on)) {
      expect(lasers.some((e) => e.on && wrapDist(e.s, off.s) < EMITTER_SPACING.laser)).toBe(true);
    }
  });

  it('keeps or drops a plaza ring of searchlights whole', () => {
    for (const density of [1, 0.35]) {
      const lit = chooseEmitters(plan.sites, density, SEED);
      const rings = new Map<string, { total: number; kept: number }>();
      plan.sites.forEach((s, i) => {
        if (!isRingLight(s)) return;
        const ring = rings.get(cellKey(s)) ?? { total: 0, kept: 0 };
        ring.total++;
        if (lit[i]) ring.kept++;
        rings.set(cellKey(s), ring);
      });
      expect(rings.size).toBeGreaterThan(0);
      expect([...rings.values()].some((r) => r.kept > 0)).toBe(true);
      for (const ring of rings.values()) expect(ring.kept === 0 || ring.kept === ring.total).toBe(true);
    }
  });

  it('lights fewer emitters as the quality density falls', () => {
    let last = Infinity;
    for (const tier of ['high', 'medium', 'low'] as const) {
      const out = packBeams(plan.sites, QUALITY[tier].density, SEED);
      const total = out.sky.count + out.pillars.count;
      expect(total).toBeLessThan(last);
      last = total;
    }
    expect(emitterSpacing('laser', 1)).toBe(EMITTER_SPACING.laser);
    expect(emitterSpacing('laser', 0.25)).toBeCloseTo(EMITTER_SPACING.laser * 2, 6);
  });

  it('reports the counts for this seed', () => {
    const summary = {
      sites: { searchlight: count('searchlight'), pillar: count('pillar'), laser: count('laser') },
      used: packed.sites,
      beams: {
        searchlight: countKind(packed.sky, BEAM_KIND.searchlight),
        laser: countKind(packed.sky, BEAM_KIND.laser),
        pillar: packed.pillars.count,
      },
    };
    console.log('beams for seed 1984 at density 1: ' + JSON.stringify(summary));
    expect(summary.beams.searchlight).toBeGreaterThanOrEqual(summary.used.searchlight);
    expect(summary.used.pillar).toBeLessThanOrEqual(summary.sites.pillar);
  });
});
