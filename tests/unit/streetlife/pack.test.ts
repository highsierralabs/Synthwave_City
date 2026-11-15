import { describe, expect, it } from 'vitest';
import type { Lane } from '../../../src/contracts/city';
import { AVENUE, CELL, CELLS, LOOP_SECONDS, STREET, TILE, roadSpec } from '../../../src/contracts/constants';
import { QUALITY } from '../../../src/contracts/quality';
import { wrap, wrapDelta } from '../../../src/core/math';
import { createRng } from '../../../src/core/random';
import { buildCarMesh } from '../../../src/layers/streetlife/mesh';
import {
  CROWD_BLOCKS_AFTER, CROWD_BLOCKS_BEFORE, CROWD_END, CROWD_LINES, CROWD_PER_FACE, HANDOVER_END, JITTER_MAX, LANE_ROWS,
  MIN_GAP, MIN_SPACING, ROWS_PER_AXIS, SKIP_CHANCE, buildCarField, buildCrowdField, buildLaneTable, carCoordinate,
  carPresent, carRandom, glslHash33, imod, jitterRange, slotCar, trafficDensity, walkerAt, type LaneRecord,
} from '../../../src/layers/streetlife/pack';

/** The ground lanes exactly as architecture.md section 4.4 lays them out (traffic keeps right), plus sky lanes to skip. */
function gridLanes(): Lane[] {
  const lanes: Lane[] = [];
  for (const axis of [0, 1] as const) {
    for (let line = 0; line < CELLS; line++) {
      const spec = roadSpec(line);
      const kind = spec === AVENUE ? 'avenue' : 'street';
      spec.lanes.forEach((offset, slot) => {
        for (const dir of [1, -1] as const) {
          const side = axis === 0 ? dir : -dir;
          lanes.push({ kind, axis, fixed: wrap(line * CELL + side * offset, TILE), y: 0, dir, line, slot });
        }
      });
      if (spec === AVENUE) lanes.push({ kind: 'sky', axis, fixed: wrap(line * CELL + 9, TILE), y: 130, dir: 1, line, slot: 0 });
    }
  }
  return lanes;
}

const LANES = gridLanes();
const GROUND = LANES.filter((l) => l.kind !== 'sky').length;
const SEED = 1984;

/** Smallest centre-to-centre distance between neighbouring cars of a lane, on the circle of the tile. */
function smallestGap(rec: LaneRecord, loop: number, jitter?: (index: number) => number): number {
  const at: number[] = [];
  for (let i = 0; i < rec.count; i++) at.push(carCoordinate(rec, i, loop, jitter ? jitter(i) : undefined));
  at.sort((a, b) => a - b);
  let gap = at[0]! + TILE - at[at.length - 1]!;
  for (let i = 1; i < at.length; i++) gap = Math.min(gap, at[i]! - at[i - 1]!);
  return gap;
}

describe('lane table', () => {
  const table = buildLaneTable(LANES, 1, SEED);

  it('has one record per ground lane and skips sky lanes', () => {
    expect(GROUND).toBe(360);
    expect(table.records.length).toBe(GROUND);
    const keys = new Set(table.records.map((r) => `${r.line}:${r.row}`));
    expect(keys.size).toBe(GROUND);
    expect(table.data.length).toBe(CELLS * LANE_ROWS * 4);
  });

  it('stores each lane where the shaders look for it', () => {
    for (const rec of table.records) {
      const at = (rec.row * CELLS + rec.line) * 4;
      expect(table.data[at]).toBe(rec.offset);
      expect(table.data[at + 1]).toBe(rec.dir * rec.laps);
      expect(table.data[at + 2]).toBe(rec.count);
      expect(table.data[at + 3]).toBe(rec.phase);
      // Row = axis * 6 + side * 3 + slot, and the offset is the lane's distance from the centre line.
      const spec = roadSpec(rec.line);
      const slot = rec.row % 3;
      expect(Math.abs(rec.offset)).toBe(spec.lanes[slot]);
      expect(Math.floor(rec.row / ROWS_PER_AXIS)).toBe(rec.axis);
      expect(Math.floor((rec.row % ROWS_PER_AXIS) / 3)).toBe(rec.offset > 0 ? 1 : 0);
      // Traffic keeps right: travelling +x the lane is on the +z side, travelling +z on the -x side.
      expect(Math.sign(rec.offset)).toBe(rec.axis === 0 ? rec.dir : -rec.dir);
    }
    // Streets leave their third lane row empty.
    const empty = (row: number, line: number): boolean => table.data[(row * CELLS + line) * 4 + 2] === 0;
    expect(empty(2, 1)).toBe(true);
    expect(empty(2, 0)).toBe(false);
  });

  it('packs every lane within the spacing bounds, with whole laps and faster inner lanes', () => {
    for (const rec of table.records) {
      expect(Number.isInteger(rec.laps)).toBe(true);
      expect(rec.laps).toBeGreaterThan(0);
      expect(Number.isInteger(rec.count)).toBe(true);
      expect(rec.spacing).toBeGreaterThanOrEqual(MIN_SPACING);
      expect(rec.spacing).toBeLessThanOrEqual(46.5);
      expect(rec.spacing * rec.count).toBeCloseTo(TILE, 9);
    }
    for (const rec of table.records) {
      const outer = table.records.find((r) => r.line === rec.line && r.row === rec.row + 1 && r.row % 3 !== 0);
      if (outer) expect(rec.laps).toBeGreaterThan(outer.laps);
    }
    expect(table.minSpacing).toBeGreaterThanOrEqual(MIN_SPACING);
    // Busy: tens of thousands of slots at full density, and far fewer on the low tier.
    expect(table.slots).toBeGreaterThan(45_000);
    expect(table.slots).toBeLessThan(70_000);
    const low = buildLaneTable(LANES, QUALITY.low.density, SEED);
    expect(low.slots / table.slots).toBeGreaterThan(0.3);
    expect(low.slots / table.slots).toBeLessThan(0.4);
  });

  it('thins the traffic gently on the lower tiers', () => {
    expect(trafficDensity(QUALITY.high.density)).toBe(1);
    expect(trafficDensity(QUALITY.medium.density)).toBeGreaterThan(QUALITY.medium.density);
    expect(trafficDensity(QUALITY.medium.density)).toBeLessThan(1);
    expect(trafficDensity(QUALITY.low.density)).toBeGreaterThan(0.55);
    expect(trafficDensity(QUALITY.low.density)).toBeLessThan(trafficDensity(QUALITY.medium.density));
    expect(trafficDensity(4)).toBe(1);
    // Even the low tier keeps a car every 80 m or so in every lane.
    const low = buildLaneTable(LANES, trafficDensity(QUALITY.low.density), SEED);
    expect(low.maxSpacing).toBeLessThan(82);
    expect(buildCarField(low, HANDOVER_END).count).toBeLessThan(7000);
  });

  it('is deterministic', () => {
    const again = buildLaneTable(LANES, 1, SEED);
    expect(again.data).toEqual(table.data);
    expect(buildLaneTable(LANES, 1, SEED + 1).data).not.toEqual(table.data);
  });

  it('rejects a lane it has no row for', () => {
    expect(() => buildLaneTable([{ ...LANES[0]!, slot: 3 }], 1, SEED)).toThrow();
    expect(() => buildLaneTable([LANES[0]!, LANES[0]!], 1, SEED)).toThrow();
  });
});

describe('cars in a lane', () => {
  it('never come closer than the minimum gap, at any loop phase and any density', () => {
    const rng = createRng(11);
    for (const density of [1, QUALITY.medium.density, QUALITY.low.density]) {
      const table = buildLaneTable(LANES, density, SEED);
      for (const rec of table.records) {
        for (const loop of [0, 1 / LOOP_SECONDS, 0.25, rng.next(), rng.next(), 1 - 1e-9]) {
          expect(smallestGap(rec, loop)).toBeGreaterThanOrEqual(MIN_GAP - 1e-6);
        }
      }
    }
  });

  it('keeps the gap whatever the hash returns', () => {
    const table = buildLaneTable(LANES, 1, SEED);
    // The worst case: neighbours pushed towards each other as far as the jitter allows.
    const worst = (i: number): number => (i % 2 === 0 ? 1 : 0);
    for (const rec of table.records) {
      expect(smallestGap(rec, 0.37, worst)).toBeGreaterThanOrEqual(MIN_GAP - 1e-6);
      expect(jitterRange(rec.spacing)).toBeLessThanOrEqual(JITTER_MAX);
      expect(rec.spacing * (1 - jitterRange(rec.spacing))).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    }
    expect(jitterRange(MIN_GAP)).toBe(0);
    expect(jitterRange(1000)).toBe(JITTER_MAX);
  });

  it('move the way their lane points, at laps * TILE / LOOP metres per second', () => {
    const table = buildLaneTable(LANES, 1, SEED);
    const dt = 0.5;
    for (const rec of table.records) {
      const a = carCoordinate(rec, 3, 0.2);
      const b = carCoordinate(rec, 3, 0.2 + dt / LOOP_SECONDS);
      const moved = wrapDelta(b, a, TILE);
      expect(moved).toBeCloseTo((rec.dir * rec.laps * TILE * dt) / LOOP_SECONDS, 6);
      expect(Math.abs(moved) / dt).toBeGreaterThan(9);
      expect(Math.abs(moved) / dt).toBeLessThan(34);
    }
  });

  it('are in the same place at the end of the loop as at the start', () => {
    const table = buildLaneTable(LANES, 1, SEED);
    for (const rec of table.records) {
      for (const i of [0, 1, rec.count - 1]) {
        const start = carCoordinate(rec, i, 0);
        expect(Math.abs(wrapDelta(carCoordinate(rec, i, 1), start, TILE))).toBeLessThan(1e-6);
        // One frame before the seam the car is one frame's travel short of it.
        const before = carCoordinate(rec, i, 1 - 0.01 / LOOP_SECONDS);
        expect(wrapDelta(start, before, TILE) * rec.dir).toBeCloseTo((rec.laps * TILE * 0.01) / LOOP_SECONDS, 5);
      }
    }
  });

  it('leave about SKIP_CHANCE of the slots empty', () => {
    const table = buildLaneTable(LANES, 1, SEED);
    let present = 0;
    for (const rec of table.records) for (let i = 0; i < rec.count; i++) if (carPresent(rec, i)) present++;
    expect(present / table.slots).toBeGreaterThan(1 - SKIP_CHANCE - 0.02);
    expect(present / table.slots).toBeLessThan(1 - SKIP_CHANCE + 0.02);
    expect(present).toBeGreaterThan(40_000);
  });
});

describe('the GLSL hash mirror', () => {
  it('returns three numbers in [0, 1) and depends on every argument', () => {
    const base = glslHash33(5, 7, 1);
    for (const v of base) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(glslHash33(5, 7, 1)).toEqual(base);
    expect(glslHash33(6, 7, 1)).not.toEqual(base);
    expect(glslHash33(5, 8, 1)).not.toEqual(base);
    expect(glslHash33(5, 7, 2)).not.toEqual(base);
    // sc_bits maps -0 to +0.
    expect(glslHash33(-0, 7, 1)).toEqual(glslHash33(0, 7, 1));
  });

  it('is uniform enough to jitter with', () => {
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) sum += glslHash33(i % 97, i, 1)[0];
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });

  it('imod is exact for whole numbers, negative ones included', () => {
    expect(imod(183, 183)).toBe(0);
    expect(imod(-1, 183)).toBe(182);
    expect(imod(-183, 183)).toBe(0);
    expect(imod(400, 183)).toBe(34);
  });
});

describe('the near-car instance grid', () => {
  const table = buildLaneTable(LANES, 1, SEED);
  const field = buildCarField(table, HANDOVER_END);

  it('has the size it reports and stays small', () => {
    expect(field.slots.length).toBe(field.count * 4);
    expect(field.count).toBe(2 * (2 * field.lines + 1) * ROWS_PER_AXIS * (2 * field.reach + 1));
    // The point of the grid: a fraction of the cars in the tile.
    expect(field.count).toBeLessThan(table.slots / 4);
  });

  it('draws every car within the handover radius exactly once', () => {
    const rng = createRng(3);
    for (let trial = 0; trial < 6; trial++) {
      const camX = trial === 0 ? 0.25 : rng.range(0, TILE);
      const camZ = trial === 0 ? TILE - 0.25 : rng.range(0, TILE);
      const loop = rng.next();
      const drawn = new Set<string>();
      for (let s = 0; s < field.count; s++) {
        const o = s * 4;
        const car = slotCar(table, camX, camZ, loop, field.slots[o]!, field.slots[o + 1]!, field.slots[o + 2]!, field.slots[o + 3]!);
        if (!car) continue;
        if (Math.hypot(car.along, car.across) > HANDOVER_END) continue;
        const key = `${car.rec.line}:${car.rec.row}:${car.index}`;
        expect(drawn.has(key)).toBe(false);
        drawn.add(key);
        // The slot and the lane model agree on where that car is.
        const along = car.rec.axis === 0 ? camX : camZ;
        expect(Math.abs(wrapDelta(carCoordinate(car.rec, car.index, loop), along + car.along, TILE))).toBeLessThan(1e-6);
      }
      // Every car of every lane that is inside the radius was found.
      let expected = 0;
      for (const rec of table.records) {
        const camAlong = rec.axis === 0 ? camX : camZ;
        const camAcross = rec.axis === 0 ? camZ : camX;
        const across = wrapDelta(rec.line * CELL + rec.offset, camAcross, TILE);
        if (Math.abs(across) > HANDOVER_END) continue;
        for (let i = 0; i < rec.count; i++) {
          const along = wrapDelta(carCoordinate(rec, i, loop), camAlong, TILE);
          if (Math.hypot(along, across) > HANDOVER_END) continue;
          expected++;
          expect(drawn.has(`${rec.line}:${rec.row}:${i}`)).toBe(true);
        }
      }
      expect(drawn.size).toBe(expected);
      expect(expected).toBeGreaterThan(1500);
    }
  });

  it('covers the radius on the sparse low tier too', () => {
    const low = buildLaneTable(LANES, QUALITY.low.density, SEED);
    const lowField = buildCarField(low, HANDOVER_END);
    expect(lowField.count).toBeLessThan(field.count);
    expect(lowField.reach * low.minSpacing).toBeGreaterThanOrEqual(HANDOVER_END);
    // No car can be drawn twice: the slots along a lane never wrap round the whole lane.
    for (const rec of low.records) expect(2 * lowField.reach + 1).toBeLessThan(rec.count);
    for (const rec of table.records) expect(2 * field.reach + 1).toBeLessThan(rec.count);
  });

  it('uses the hashed jitter the lane model uses', () => {
    const rec = table.records[17]!;
    expect(carCoordinate(rec, 5, 0.1)).toBe(carCoordinate(rec, 5, 0.1, carRandom(rec, 5)[0]));
  });
});

describe('crowds', () => {
  it('packs one instance per person, block face, side, road and axis', () => {
    const field = buildCrowdField(CROWD_PER_FACE);
    const faces = 2 * (2 * CROWD_LINES + 1) * 2 * (CROWD_BLOCKS_BEFORE + CROWD_BLOCKS_AFTER + 1);
    expect(field.length).toBe(faces * CROWD_PER_FACE * 4);
    expect(buildCrowdField(0).length).toBe(0);
  });

  it('keeps everyone on a sidewalk: nobody stands in a road, at any time', () => {
    const rng = createRng(21);
    const field = buildCrowdField(12);
    let checked = 0;
    for (let trial = 0; trial < 8; trial++) {
      const camX = rng.range(0, TILE);
      const camZ = rng.range(0, TILE);
      for (const loop of [0, rng.next(), rng.next(), 1 - 1e-9]) {
        for (let o = 0; o < field.length; o += 4) {
          const w = walkerAt(camX, camZ, loop, field[o]!, field[o + 1]!, field[o + 2]!, field[o + 3]!);
          // Distance to the nearest road centre line on each axis, against that road's carriageway.
          for (const coord of [w.x, w.z]) {
            const line = Math.round(coord / CELL);
            const spec = roadSpec(line);
            expect(Math.abs(coord - line * CELL)).toBeGreaterThan(spec.roadHalf + 0.5);
          }
          // And on the sidewalk of the road it walks along, clear of the building line.
          const across = (field[o]! >= 2 ? w.x : w.z);
          const line = Math.round(across / CELL);
          expect(Math.abs(across - line * CELL)).toBeLessThan(roadSpec(line).corridorHalf - 0.5);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40_000);
  });

  it('reaches everyone within the crowd radius, and walks at a human pace', () => {
    const field = buildCrowdField(4);
    const camX = 1234.5, camZ = 4321.25;
    // The grid of block faces covers a square that contains the crowd circle.
    expect((CROWD_LINES + 0.5) * CELL - STREET.corridorHalf).toBeGreaterThan(CROWD_END);
    expect((Math.min(CROWD_BLOCKS_BEFORE, CROWD_BLOCKS_AFTER + 1) - 0.5) * CELL).toBeGreaterThan(CROWD_END);
    let moving = 0;
    for (let o = 0; o < field.length; o += 4) {
      const a = walkerAt(camX, camZ, 0.3, field[o]!, field[o + 1]!, field[o + 2]!, field[o + 3]!);
      const b = walkerAt(camX, camZ, 0.3 + 0.2 / LOOP_SECONDS, field[o]!, field[o + 1]!, field[o + 2]!, field[o + 3]!);
      const speed = Math.hypot(b.x - a.x, b.z - a.z) / 0.2;
      if (a.standing) expect(speed).toBe(0);
      else {
        moving++;
        expect(speed).toBeGreaterThan(0.6);
        expect(speed).toBeLessThan(1.9);
      }
    }
    expect(moving).toBeGreaterThan(field.length / 4 / 2);
  });
});

describe('the vehicle mesh', () => {
  const mesh = buildCarMesh();

  it('is small and well formed', () => {
    expect(mesh.triangles).toBeLessThanOrEqual(48);
    expect(mesh.index.length).toBe(mesh.triangles * 3);
    expect(mesh.position.length).toBe(mesh.vertices * 3);
    expect(mesh.alt.length).toBe(mesh.vertices * 3);
    expect(mesh.part.length).toBe(mesh.vertices);
    for (const i of mesh.index) expect(i).toBeLessThan(mesh.vertices);
    for (const v of mesh.position) expect(Number.isFinite(v)).toBe(true);
  });

  it('winds every face outwards in both shapes', () => {
    for (const shape of [mesh.position, mesh.alt]) {
      // Each part is convex; a face must look away from the centre of its own part.
      const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
      const partOf = (v: number): number => mesh.part[v]! * 1000 + (mesh.part[v]! === 2 ? Math.sign(mesh.position[v * 3]! - 0.02) : 0);
      for (let v = 0; v < mesh.vertices; v++) {
        const s = sums.get(partOf(v)) ?? { x: 0, y: 0, z: 0, n: 0 };
        s.x += shape[v * 3]!; s.y += shape[v * 3 + 1]!; s.z += shape[v * 3 + 2]!; s.n++;
        sums.set(partOf(v), s);
      }
      for (let t = 0; t < mesh.triangles; t++) {
        const [a, b, c] = [mesh.index[t * 3]!, mesh.index[t * 3 + 1]!, mesh.index[t * 3 + 2]!];
        const s = sums.get(partOf(a))!;
        const p = (v: number): [number, number, number] => [shape[v * 3]!, shape[v * 3 + 1]!, shape[v * 3 + 2]!];
        const [pa, pb, pc] = [p(a), p(b), p(c)];
        const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        const out = [pa[0] - s.x / s.n, pa[1] - s.y / s.n, pa[2] - s.z / s.n];
        expect(n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]!).toBeGreaterThan(0);
      }
    }
  });

  it('stands on the road and fits its lane', () => {
    let minY = Infinity, maxZ = 0;
    for (let v = 0; v < mesh.vertices; v++) {
      for (const shape of [mesh.position, mesh.alt]) {
        minY = Math.min(minY, shape[v * 3 + 1]!);
        maxZ = Math.max(maxZ, Math.abs(shape[v * 3 + 2]!));
      }
    }
    expect(minY).toBe(0);
    // A lane is 4 m wide; a bus is the van stretched by 1.24 across.
    expect(maxZ * 1.24 * 2).toBeLessThan(STREET.lanes[1]! - STREET.lanes[0]!);
  });
});
