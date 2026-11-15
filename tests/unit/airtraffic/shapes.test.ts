import { describe, expect, it } from 'vitest';
import { HERO, HERO_LIMITS, HERO_TYPES, SHAPE_COUNT, SHAPE_LIMITS } from '../../../src/layers/airtraffic/pack';
import {
  CRAFT_LIGHTS, CRAFT_LIGHT_TABLE, CRAFT_TRAIL_TABLE, GLOW, HullBuilder, PART, buildCraftHull, buildHeroHull, heroLights,
  rect, type HullMesh,
} from '../../../src/layers/airtraffic/shapes';

/** Six times the signed volume enclosed by a run of triangles: positive when they are wound outwards. */
function signedVolume(mesh: HullMesh, start: number, count: number): number {
  const p = mesh.positions;
  let v = 0;
  for (let t = start; t < start + count; t += 3) {
    const a = mesh.indices[t]! * 3, b = mesh.indices[t + 1]! * 3, c = mesh.indices[t + 2]! * 3;
    v += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!)
      + p[a + 1]! * (p[b + 2]! * p[c]! - p[b]! * p[c + 2]!)
      + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return v;
}

function extents(mesh: HullMesh, type: number | null): { x: number; yMin: number; yMax: number; z: number } {
  const e = { x: 0, yMin: 0, yMax: 0, z: 0 };
  for (let i = 0; i < mesh.parts.length; i++) {
    if (type !== null && mesh.types[i] !== type) continue;
    e.x = Math.max(e.x, Math.abs(mesh.positions[i * 3]!));
    e.yMin = Math.min(e.yMin, mesh.positions[i * 3 + 1]!);
    e.yMax = Math.max(e.yMax, mesh.positions[i * 3 + 1]!);
    e.z = Math.max(e.z, Math.abs(mesh.positions[i * 3 + 2]!));
  }
  return e;
}

function checkMesh(mesh: HullMesh): void {
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.parts.length).toBe(mesh.positions.length / 3);
  expect(mesh.types.length).toBe(mesh.parts.length);
  for (const i of mesh.indices) expect(i).toBeLessThan(mesh.parts.length);
  for (const v of mesh.positions) expect(Number.isFinite(v)).toBe(true);
  let covered = 0;
  for (const [start, count] of mesh.pieces) {
    expect(count).toBeGreaterThan(0);
    // Every piece is wound outwards, the open ones included.
    expect(signedVolume(mesh, start, count)).toBeGreaterThan(0);
    // One part id per piece, so a flat varying cannot pick up a neighbour's id.
    const part = mesh.parts[mesh.indices[start]!]!;
    for (let t = start; t < start + count; t++) expect(mesh.parts[mesh.indices[t]!]).toBe(part);
    covered += count;
  }
  expect(covered).toBe(mesh.indices.length);
}

describe('air traffic: the hull builder', () => {
  it('winds a box outwards and closes it', () => {
    const b = new HullBuilder();
    b.box(PART.body, -1, 1, -2, 2, -3, 3);
    const mesh = b.build();
    expect(mesh.indices.length / 3).toBe(12);
    expect(signedVolume(mesh, 0, mesh.indices.length) / 6).toBeCloseTo(2 * 4 * 6, 5);
    expect(mesh.pieces[0]![2]).toBe(true);
  });

  it('mirrors a loft without flipping its winding', () => {
    const b = new HullBuilder();
    b.loftPair(PART.fin, [[0, rect(2, 3, 0, 1)], [4, rect(2, 5, 0, 1)]]);
    const mesh = b.build();
    expect(mesh.pieces.length).toBe(2);
    for (const [start, count] of mesh.pieces) expect(signedVolume(mesh, start, count)).toBeGreaterThan(0);
    const xs = [...mesh.positions].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(-5);
    expect(Math.max(...xs)).toBe(5);
  });

  it('rejects rings that do not match and z that does not increase', () => {
    const b = new HullBuilder();
    expect(() => b.loft(PART.body, [[0, rect(0, 1, 0, 1)], [0, rect(0, 1, 0, 1)]])).toThrow();
    expect(() => b.loft(PART.body, [[0, rect(0, 1, 0, 1)], [1, [[0, 0], [1, 0], [0, 1]]]])).toThrow();
  });
});

describe('air traffic: craft hulls', () => {
  it('are well-formed, cheap, and inside the limits the packer assumes', () => {
    for (let s = 0; s < SHAPE_COUNT; s++) {
      const mesh = buildCraftHull(s);
      checkMesh(mesh);
      // Thousands are drawn twice a frame: keep them lean.
      expect(mesh.indices.length / 3).toBeLessThanOrEqual(56);
      const lim = SHAPE_LIMITS[s]!;
      const e = extents(mesh, null);
      // The mesh is float32, hence the hair of tolerance.
      expect(e.x).toBeLessThanOrEqual(lim.halfWidth + 1e-5);
      expect(e.yMax).toBeLessThanOrEqual(lim.halfHeight + 1e-5);
      expect(-e.yMin).toBeLessThanOrEqual(lim.halfHeight + 1e-5);
      expect(e.z).toBeLessThanOrEqual(lim.halfLength + 1e-5);
      // And the limits are not wildly loose.
      expect(e.x).toBeGreaterThan(lim.halfWidth * 0.8);
      expect(e.z).toBeGreaterThan(lim.halfLength * 0.8);
    }
  });

  it('have a light table and a trail table that match the hulls', () => {
    expect(CRAFT_LIGHT_TABLE.length).toBe(SHAPE_COUNT * CRAFT_LIGHTS * 4);
    expect(CRAFT_TRAIL_TABLE.length).toBe(SHAPE_COUNT * 4);
    for (let s = 0; s < SHAPE_COUNT; s++) {
      const lim = SHAPE_LIMITS[s]!;
      let lit = 0;
      for (let k = 0; k < CRAFT_LIGHTS; k++) {
        const o = (s * CRAFT_LIGHTS + k) * 4;
        const size = CRAFT_LIGHT_TABLE[o + 3]!;
        expect(size).toBeGreaterThanOrEqual(0);
        if (size === 0) continue;
        lit++;
        // A light sits on the hull, not out in the next lane.
        expect(Math.abs(CRAFT_LIGHT_TABLE[o]!)).toBeLessThanOrEqual(lim.halfWidth);
        expect(Math.abs(CRAFT_LIGHT_TABLE[o + 1]!)).toBeLessThanOrEqual(lim.halfHeight + 0.2);
        expect(Math.abs(CRAFT_LIGHT_TABLE[o + 2]!)).toBeLessThanOrEqual(lim.halfLength + 0.2);
      }
      expect(lit).toBeGreaterThanOrEqual(4);
      // Engines at the back, the headlamp at the front (z points backwards).
      expect(CRAFT_LIGHT_TABLE[s * CRAFT_LIGHTS * 4 + 2]!).toBeGreaterThan(0);
      expect(CRAFT_LIGHT_TABLE[(s * CRAFT_LIGHTS + 2) * 4 + 2]!).toBeLessThan(0);
      // The trail starts at the tail, between the engines.
      expect(CRAFT_TRAIL_TABLE[s * 4 + 1]!).toBeCloseTo(CRAFT_LIGHT_TABLE[s * CRAFT_LIGHTS * 4 + 2]!, 5);
      expect(CRAFT_TRAIL_TABLE[s * 4 + 2]!).toBeCloseTo(Math.abs(CRAFT_LIGHT_TABLE[s * CRAFT_LIGHTS * 4]!), 5);
    }
  });
});

describe('air traffic: hero hulls', () => {
  const mesh = buildHeroHull();

  it('are well-formed and carry all three types', () => {
    checkMesh(mesh);
    const seen = new Set(mesh.types);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(mesh.indices.length / 3).toBeLessThan(2000);
    // A triangle never mixes types: the vertex shader drops a ship's foreign vertices whole.
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const type = mesh.types[mesh.indices[t]!];
      expect(mesh.types[mesh.indices[t + 1]!]).toBe(type);
      expect(mesh.types[mesh.indices[t + 2]!]).toBe(type);
    }
  });

  it('fit the extents the route planner clears', () => {
    for (let type = 0; type < HERO_TYPES; type++) {
      const lim = HERO_LIMITS[type]!;
      const e = extents(mesh, type);
      expect(e.x).toBeLessThanOrEqual(lim.halfWidth + 1e-4);
      expect(e.z).toBeLessThanOrEqual(lim.halfLength + 1e-4);
      expect(e.yMax).toBeLessThanOrEqual(lim.above + 1e-4);
      expect(-e.yMin).toBeLessThanOrEqual(lim.below + 1e-4);
    }
    // 60 to 200 m long, as the plan asks.
    for (let type = 0; type < HERO_TYPES; type++) {
      const length = 2 * extents(mesh, type).z;
      expect(length).toBeGreaterThanOrEqual(60);
      expect(length).toBeLessThanOrEqual(205);
    }
  });

  it('have lights of sane kinds, and only the patrol craft has a searchlight', () => {
    const lights = heroLights();
    const modes = new Set<number>(Object.values(GLOW));
    for (let type = 0; type < HERO_TYPES; type++) expect(lights.filter((l) => l.type === type).length).toBeGreaterThan(8);
    for (const l of lights) {
      expect(modes.has(l.mode)).toBe(true);
      expect(l.size).toBeGreaterThan(0);
      expect(l.color).toBeGreaterThanOrEqual(0);
      expect(l.color).toBeLessThanOrEqual(7);
      if (l.mode === GLOW.cone || l.mode === GLOW.pool || l.mode === GLOW.searchlamp) expect(l.type).toBe(HERO.patrol);
    }
    expect(lights.filter((l) => l.mode === GLOW.cone).length).toBe(1);
    expect(lights.filter((l) => l.mode === GLOW.pool).length).toBe(1);
    expect(lights.some((l) => l.mode === GLOW.policeA)).toBe(true);
    expect(lights.some((l) => l.mode === GLOW.policeB)).toBe(true);
  });
});
