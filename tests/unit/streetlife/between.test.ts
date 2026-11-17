// Plan T06, M6 and M7: people in the alleys and on the plazas, and motorcycles in the traffic.
import { describe, expect, it } from 'vitest';
import { BOX, BOX_STRIDE, CELL_FIELD, CELL_STRIDE, DISTRICT, type CityPlan } from '../../../src/contracts/city';
import { CELL, CELLS, LOOP_SECONDS, TILE } from '../../../src/contracts/constants';
import { createCityPlan } from '../../../src/city';
import { wrap } from '../../../src/core/math';
import { createRng } from '../../../src/core/random';
import { BIKE_DIMS, CAR_DIMS, buildCarMesh } from '../../../src/layers/streetlife/mesh';
import {
  ALLEY_GROUND, ALLEY_MIN_WIDTH, ALLEY_TEXELS, ALLEYS_PER_AXIS, BIKE_CHANCE, BLOCK_REACH, BLOCK_SLOTS, EMERGENCY_CHANCE,
  PLAZA_CROSS_CENTRE, TAXI_CHANCE, VEHICLE, blockWalkerAt, buildAlleyTable, buildBlockField, buildLaneTable, carClass,
  cellRect, glslHash33, laneId, type AlleyTable, type BlockWalker,
} from '../../../src/layers/streetlife/pack';

const plans = [createCityPlan(1), createCityPlan(2049)];
const tables = plans.map((plan) => buildAlleyTable(plan));

interface Footprint { x0: number; x1: number; z0: number; z1: number }

/** Street-level box footprints per cell, in that cell's own coordinates. */
function footprints(plan: CityPlan, below: number): Footprint[][] {
  const out: Footprint[][] = Array.from({ length: CELLS * CELLS }, () => []);
  for (let b = 0; b < plan.boxCount; b++) {
    const o = b * BOX_STRIDE;
    if (plan.boxes[o + BOX.y0]! >= below) continue;
    const x = plan.boxes[o + BOX.cx]!, z = plan.boxes[o + BOX.cz]!;
    const hx = plan.boxes[o + BOX.sx]! / 2, hz = plan.boxes[o + BOX.sz]! / 2;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    out[cz * CELLS + cx]!.push({ x0: x - hx - cx * CELL, x1: x + hx - cx * CELL, z0: z - hz - cz * CELL, z1: z + hz - cz * CELL });
  }
  return out;
}

function district(plan: CityPlan, cell: number): number {
  return plan.cells[cell * CELL_STRIDE + CELL_FIELD.district]!;
}

function alleysOf(table: AlleyTable, cell: number, axis: 0 | 1): { centre: number; half: number }[] {
  const cx = cell % CELLS, cz = Math.floor(cell / CELLS);
  const at = (cz * table.width + cx * ALLEY_TEXELS + axis * 2) * 4;
  const n = table.data[at + 3]!;
  return Array.from({ length: n }, (_, k) => ({ centre: table.data[at + k]!, half: table.data[at + 4 + k]! }));
}

/** Every shown block walker for a set of cameras and loop phases. */
function sample(plan: CityPlan, table: AlleyTable, cameras: number, loops: readonly number[], seed: number): BlockWalker[] {
  const rng = createRng(seed);
  const out: BlockWalker[] = [];
  for (let c = 0; c < cameras; c++) {
    const camX = rng.range(0, TILE), camZ = rng.range(0, TILE);
    for (const loop of loops) {
      for (let dz = -BLOCK_REACH; dz <= BLOCK_REACH; dz++) {
        for (let dx = -BLOCK_REACH; dx <= BLOCK_REACH; dx++) {
          for (let p = 0; p < BLOCK_SLOTS; p++) {
            const w = blockWalkerAt(table, plan.cells, camX, camZ, loop, dx, dz, p, BLOCK_SLOTS);
            if (w.show) out.push(w);
          }
        }
      }
    }
  }
  return out;
}

describe('alleys', () => {
  it('are found between the lots of most blocks, and only where no building stands', () => {
    plans.forEach((plan, i) => {
      const table = tables[i]!;
      const boxes = footprints(plan, ALLEY_GROUND);
      let withAlleys = 0, built = 0;
      for (let cell = 0; cell < CELLS * CELLS; cell++) {
        const d = district(plan, cell);
        const a0 = alleysOf(table, cell, 0), a1 = alleysOf(table, cell, 1);
        if (d === DISTRICT.plaza || d === DISTRICT.mega) {
          expect(a0.length + a1.length).toBe(0);
          continue;
        }
        built++;
        if (a0.length + a1.length > 0) withAlleys++;
        for (const [axis, list] of [[0, a0], [1, a1]] as const) {
          expect(list.length).toBeLessThanOrEqual(ALLEYS_PER_AXIS);
          for (const { centre, half } of list) {
            expect(half * 2).toBeGreaterThanOrEqual(ALLEY_MIN_WIDTH - 1e-6);
            // No street-level box reaches into the band, anywhere along the block.
            for (const f of boxes[cell]!) {
              const lo = axis === 0 ? f.z0 : f.x0, hi = axis === 0 ? f.z1 : f.x1;
              expect(hi <= centre - half + 1e-4 || lo >= centre + half - 1e-4).toBe(true);
            }
          }
        }
      }
      expect(table.count).toBeGreaterThan(1000);
      expect(withAlleys / built).toBeGreaterThan(0.6);
    });
  });

  it('is deterministic', () => {
    expect(buildAlleyTable(plans[0]!).data).toEqual(tables[0]!.data);
  });
});

describe('people between the buildings', () => {
  it('packs one instance per slot of each cell around the camera', () => {
    const side = 2 * BLOCK_REACH + 1;
    expect(buildBlockField(BLOCK_SLOTS).length).toBe(side * side * BLOCK_SLOTS * 4);
    expect(buildBlockField(0).length).toBe(0);
  });

  it('never stand in a building or a road, at any camera or time', () => {
    plans.forEach((plan, i) => {
      const boxes = footprints(plan, 2.5);
      const walkers = sample(plan, tables[i]!, 12, [0, 0.37, 0.81], 7 + i);
      const modes = new Set(walkers.map((w) => w.mode));
      expect(modes).toEqual(new Set(['alley', 'ring', 'cross', 'stand']));
      // The worst cases, asserted once (an expect per box per person takes tens of seconds).
      let outside = 0, nearest = Infinity;
      for (const w of walkers) {
        const lx = wrap(w.x, TILE) - w.cx * CELL, lz = wrap(w.z, TILE) - w.cz * CELL;
        const rect = cellRect(w.cx, w.cz);
        // Inside its block, so off the sidewalks and the roads.
        if (lx < rect.x0 || lx > rect.x1 || lz < rect.z0 || lz > rect.z1) outside++;
        for (const f of boxes[w.cz * CELLS + w.cx]!) {
          const gx = Math.max(f.x0 - lx, 0, lx - f.x1), gz = Math.max(f.z0 - lz, 0, lz - f.z1);
          nearest = Math.min(nearest, Math.hypot(gx, gz));
        }
      }
      expect(outside).toBe(0);
      // At least half a metre from every wall: a body is about 0.3 m either side of its centre.
      expect(nearest).toBeGreaterThanOrEqual(0.5);
    });
  });

  it('on a plaza keep off its centre, its light pillar and its searchlights', () => {
    plans.forEach((plan, i) => {
      const walkers = sample(plan, tables[i]!, 12, [0.2, 0.6], 70 + i).filter((w) => w.mode !== 'alley');
      expect(walkers.length).toBeGreaterThan(100);
      const fixtures = plan.sites.filter((s) => s.kind === 'pillar' || s.kind === 'searchlight');
      let centre = Infinity, margin = Infinity;
      for (const w of walkers) {
        const rect = cellRect(w.cx, w.cz);
        const mx = w.cx * CELL + (rect.x0 + rect.x1) / 2, mz = w.cz * CELL + (rect.z0 + rect.z1) / 2;
        const x = wrap(w.x, TILE), z = wrap(w.z, TILE);
        centre = Math.min(centre, Math.hypot(x - mx, z - mz));
        for (const s of fixtures) {
          if (Math.abs(s.x - x) > 40 || Math.abs(s.z - z) > 40) continue;
          const clear = s.kind === 'pillar' ? s.w + 0.5 : 1.5;
          margin = Math.min(margin, Math.hypot(x - s.x, z - s.z) - clear);
        }
      }
      expect(centre).toBeGreaterThanOrEqual(PLAZA_CROSS_CENTRE - 1e-6);
      expect(margin).toBeGreaterThanOrEqual(0);
    });
  });

  it('come back to where they started at the end of the loop, and walk at a human pace', () => {
    const plan = plans[0]!, table = tables[0]!;
    const rng = createRng(3);
    let moving = 0;
    for (let c = 0; c < 6; c++) {
      const camX = rng.range(0, TILE), camZ = rng.range(0, TILE);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let p = 0; p < BLOCK_SLOTS; p++) {
            const a = blockWalkerAt(table, plan.cells, camX, camZ, 0, dx, dz, p, BLOCK_SLOTS);
            if (!a.show) continue;
            const b = blockWalkerAt(table, plan.cells, camX, camZ, 1, dx, dz, p, BLOCK_SLOTS);
            expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBeLessThan(1e-6);
            if (a.laps === 0) continue;
            moving++;
            expect(Number.isInteger(a.laps)).toBe(true);
            const speed = (a.laps * a.lapLength) / LOOP_SECONDS;
            expect(speed).toBeGreaterThan(0.5);
            expect(speed).toBeLessThan(1.8);
          }
        }
      }
    }
    expect(moving).toBeGreaterThan(200);
  });

  it('thin out with the tier and vanish where it has no crowds', () => {
    const plan = plans[0]!, table = tables[0]!;
    const count = (perCell: number): number => {
      let n = 0;
      for (let dz = -BLOCK_REACH; dz <= BLOCK_REACH; dz++) {
        for (let dx = -BLOCK_REACH; dx <= BLOCK_REACH; dx++) {
          for (let p = 0; p < perCell; p++) if (blockWalkerAt(table, plan.cells, 3200, 3200, 0.3, dx, dz, p, perCell).show) n++;
        }
      }
      return n;
    };
    const full = count(BLOCK_SLOTS), thin = count(Math.round(BLOCK_SLOTS * 0.6));
    expect(full).toBeGreaterThan(0);
    expect(thin).toBeLessThan(full);
    expect(count(0)).toBe(0);
  });
});

describe('motorcycles', () => {
  const table = buildLaneTable(plans[0]!.lanes, 1, 1);

  it('make up about a tenth of the traffic, and are never taxis or emergency vehicles', () => {
    let total = 0, bikes = 0;
    for (const rec of table.records) {
      for (let i = 0; i < rec.count; i++) {
        total++;
        const klass = carClass(rec, i);
        if (klass === VEHICLE.bike) bikes++;
        const r2 = glslHash33(laneId(rec), i, 2);
        if (r2[1] < EMERGENCY_CHANCE + TAXI_CHANCE) expect(klass).toBe(VEHICLE.car);
      }
    }
    const expected = BIKE_CHANCE * (1 - EMERGENCY_CHANCE - TAXI_CHANCE);
    expect(Math.abs(bikes / total - expected)).toBeLessThan(0.01);
  });

  it('are a narrow shape that stands on its wheels and fits its stated size', () => {
    const mesh = buildCarMesh();
    let minY = Infinity, maxY = 0, maxX = 0, maxZ = 0, wheelBottom = Infinity;
    for (let v = 0; v < mesh.vertices; v++) {
      const [x, y, z] = [mesh.bike[v * 3]!, mesh.bike[v * 3 + 1]!, mesh.bike[v * 3 + 2]!];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      maxX = Math.max(maxX, Math.abs(x));
      maxZ = Math.max(maxZ, Math.abs(z));
      if (mesh.part[v] === 2) wheelBottom = Math.min(wheelBottom, y);
    }
    expect(minY).toBe(0);
    expect(wheelBottom).toBe(0);
    expect(maxY).toBeCloseTo(BIKE_DIMS[1], 6);
    expect(maxX).toBeLessThanOrEqual(BIKE_DIMS[0] + 1e-6);
    expect(maxZ).toBeLessThanOrEqual(BIKE_DIMS[2]);
    expect(maxZ).toBeLessThan(CAR_DIMS[2] / 2);
  });
});
