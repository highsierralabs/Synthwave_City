import { describe, expect, it } from 'vitest';
import { createCityPlan } from '../../../src/city/index';
import { cellDistance } from '../../../src/city/districts';
import { blockRect } from '../../../src/city/massing';
import { panelAltitudes } from '../../../src/city/sites';
import {
  BOX, BOX_FLAG, BOX_STRIDE, BOX_STYLE, CELL_FIELD, CELL_STRIDE, DISTRICT, type CityPlan,
} from '../../../src/contracts/city';
import {
  AVENUE, CELL, CELLS, SKY_LANE_Y_X, SKY_LANE_Y_Z, STREET, TILE, isAvenue, roadSpec,
} from '../../../src/contracts/constants';
import { wrapDelta } from '../../../src/core/math';
import { createRng } from '../../../src/core/random';

const plan = createCityPlan(1984);

function box(p: CityPlan, i: number): Record<keyof typeof BOX, number> {
  const o = i * BOX_STRIDE;
  const out = {} as Record<keyof typeof BOX, number>;
  for (const key of Object.keys(BOX) as (keyof typeof BOX)[]) out[key] = p.boxes[o + BOX[key]]!;
  return out;
}
const districtOf = (p: CityPlan, cell: number): number => p.cells[cell * CELL_STRIDE + CELL_FIELD.district]!;

describe('city plan: determinism and size', () => {
  it('same seed gives the same bytes, another seed differs', () => {
    const again = createCityPlan(1984);
    expect(again.boxCount).toBe(plan.boxCount);
    expect(Buffer.from(again.boxes.buffer).equals(Buffer.from(plan.boxes.buffer))).toBe(true);
    expect(Buffer.from(again.cells.buffer).equals(Buffer.from(plan.cells.buffer))).toBe(true);
    expect(again.sites).toEqual(plan.sites);
    const other = createCityPlan(7);
    expect(Buffer.from(other.cells.buffer).equals(Buffer.from(plan.cells.buffer))).toBe(false);
  });

  it('builds in well under a second', () => {
    const t0 = performance.now();
    createCityPlan(3);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('has a plausible number of everything', () => {
    expect(plan.boxes.length).toBe(plan.boxCount * BOX_STRIDE);
    expect(plan.boxCount).toBeGreaterThan(10000);
    expect(plan.boxCount).toBeLessThan(26000);
    expect(plan.buildingCount).toBeGreaterThan(5000);
    expect(plan.cells.length).toBe(CELLS * CELLS * CELL_STRIDE);
  });
});

describe('city plan: districts', () => {
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < CELLS * CELLS; i++) counts[districtOf(plan, i)]!++;

  it('has every district in sensible proportion', () => {
    expect(counts[DISTRICT.lowrise]).toBeGreaterThan(400);
    expect(counts[DISTRICT.midtown]).toBeGreaterThan(150);
    expect(counts[DISTRICT.downtown]).toBeGreaterThan(40);
    expect(counts[DISTRICT.mega]).toBeGreaterThanOrEqual(10);
    expect(counts[DISTRICT.mega]).toBeLessThanOrEqual(14);
    expect(counts[DISTRICT.plaza]).toBeGreaterThan(30);
    expect(counts[DISTRICT.plaza]).toBeLessThanOrEqual(92);
  });

  it('keeps megatowers apart and plazas from touching', () => {
    const megas: number[] = [];
    for (let i = 0; i < CELLS * CELLS; i++) if (districtOf(plan, i) === DISTRICT.mega) megas.push(i);
    for (let a = 0; a < megas.length; a++) {
      for (let b = a + 1; b < megas.length; b++) expect(cellDistance(megas[a]!, megas[b]!)).toBeGreaterThanOrEqual(7);
    }
    for (let cz = 0; cz < CELLS; cz++) {
      for (let cx = 0; cx < CELLS; cx++) {
        if (districtOf(plan, cz * CELLS + cx) !== DISTRICT.plaza) continue;
        expect(districtOf(plan, cz * CELLS + ((cx + 1) % CELLS))).not.toBe(DISTRICT.plaza);
        expect(districtOf(plan, ((cz + 1) % CELLS) * CELLS + cx)).not.toBe(DISTRICT.plaza);
      }
    }
  });

  it('lists megatowers tallest first, then plazas, then downtown', () => {
    const megas = plan.landmarks.filter((l) => l.kind === 'megatower');
    expect(megas.length).toBe(counts[DISTRICT.mega]);
    for (let i = 1; i < megas.length; i++) expect(megas[i]!.height).toBeLessThanOrEqual(megas[i - 1]!.height);
    expect(megas[0]!.height).toBeGreaterThan(690);
    expect(plan.landmarks[plan.landmarks.length - 1]!.kind).toBe('downtown');
    expect(plan.landmarks[plan.landmarks.length - 1]!.height).toBeGreaterThan(150);
  });
});

describe('city plan: boxes', () => {
  it('no box reaches into a road corridor', () => {
    for (let i = 0; i < plan.boxCount; i++) {
      const b = box(plan, i);
      const cx = Math.floor(b.cx / CELL), cz = Math.floor(b.cz / CELL);
      const r = blockRect(cx, cz);
      expect(b.cx - b.sx / 2).toBeGreaterThanOrEqual(r.x0 - 1e-3);
      expect(b.cx + b.sx / 2).toBeLessThanOrEqual(r.x1 + 1e-3);
      expect(b.cz - b.sz / 2).toBeGreaterThanOrEqual(r.z0 - 1e-3);
      expect(b.cz + b.sz / 2).toBeLessThanOrEqual(r.z1 + 1e-3);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.sx).toBeGreaterThan(0);
      expect(b.sy).toBeGreaterThan(0);
      expect(b.sz).toBeGreaterThan(0);
    }
  });

  it('boxes of one building stack without gaps and stay inside its base', () => {
    let start = 0;
    while (start < plan.boxCount) {
      const first = box(plan, start);
      let end = start + 1;
      while (end < plan.boxCount && box(plan, end).building === first.building) end++;
      let y = 0;
      for (let i = start; i < end; i++) {
        const b = box(plan, i);
        expect(b.y0).toBeCloseTo(y, 2);
        y = b.y0 + b.sy;
        expect(b.sx).toBeLessThanOrEqual(first.sx + 1e-3);
        expect(b.sz).toBeLessThanOrEqual(first.sz + 1e-3);
        expect(b.cx).toBeCloseTo(first.cx, 3);
      }
      expect(first.flags & BOX_FLAG.street).toBe(BOX_FLAG.street);
      start = end;
    }
  });

  it('heights fit their district', () => {
    let megaTop = 0;
    for (let i = 0; i < plan.boxCount; i++) {
      const b = box(plan, i);
      const cell = Math.floor(b.cz / CELL) * CELLS + Math.floor(b.cx / CELL);
      const top = b.y0 + b.sy;
      const d = districtOf(plan, cell);
      if (d === DISTRICT.lowrise) expect(top).toBeLessThanOrEqual(63);
      if (d === DISTRICT.midtown && b.style !== BOX_STYLE.spire) expect(top).toBeLessThanOrEqual(206);
      if (d === DISTRICT.downtown && b.style !== BOX_STYLE.spire) expect(top).toBeLessThanOrEqual(491);
      if (d === DISTRICT.plaza) expect(top).toBeLessThanOrEqual(8);
      if (d === DISTRICT.mega) megaTop = Math.max(megaTop, top);
      expect(top).toBeLessThan(1100);
      expect(b.colorA).toBeGreaterThanOrEqual(0);
      expect(b.colorA).toBeLessThanOrEqual(7);
    }
    expect(megaTop).toBeGreaterThan(700);
  });
});

describe('city plan: lanes', () => {
  it('has the expected count of each kind', () => {
    const count = (kind: string): number => plan.lanes.filter((l) => l.kind === kind).length;
    const avenues = CELLS / 4;
    expect(count('street')).toBe((CELLS - avenues) * STREET.lanes.length * 2 * 2);
    expect(count('avenue')).toBe(avenues * AVENUE.lanes.length * 2 * 2);
    expect(count('sky')).toBe(avenues * (SKY_LANE_Y_X.length + SKY_LANE_Y_Z.length) * 2);
  });

  it('every lane lies inside its road and traffic keeps right', () => {
    for (const lane of plan.lanes) {
      const offset = wrapDelta(lane.fixed, lane.line * CELL, TILE);
      const spec = roadSpec(lane.line);
      expect(Math.abs(offset)).toBeLessThan(lane.kind === 'sky' ? spec.corridorHalf : spec.roadHalf);
      expect(lane.kind === 'street').toBe(!isAvenue(lane.line));
      // Right of +x is +z; right of +z is -x.
      const side = lane.axis === 0 ? lane.dir : -lane.dir;
      expect(Math.sign(offset)).toBe(side);
      if (lane.kind === 'sky') expect((lane.axis === 0 ? SKY_LANE_Y_X : SKY_LANE_Y_Z).includes(lane.y)).toBe(true);
      else expect(lane.y).toBe(0);
    }
  });
});

describe('city plan: sites', () => {
  const kinds = new Map<string, number>();
  for (const s of plan.sites) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);

  it('has every kind, in useful numbers', () => {
    const megas = plan.landmarks.filter((l) => l.kind === 'megatower').map((l) => Math.round(l.height));
    console.log(`plan 1984: ${plan.boxCount} boxes, ${plan.buildingCount} buildings, ${plan.lanes.length} lanes, sites ${JSON.stringify(Object.fromEntries(kinds))}, megatowers ${megas.join(' ')}`);
    expect(kinds.get('holoPanel')).toBeGreaterThan(150);
    expect(kinds.get('holoPanel')).toBeLessThan(900);
    expect(kinds.get('holoObject')).toBeGreaterThan(15);
    expect(kinds.get('searchlight')).toBeGreaterThan(40);
    expect(kinds.get('pillar')).toBeGreaterThan(20);
    expect(kinds.get('laser')).toBeGreaterThan(3);
    expect(kinds.get('roofLight')).toBeGreaterThan(100);
    expect(kinds.get('ticker')).toBeGreaterThan(20);
  });

  it('keeps every hologram volume clear of every box (brute force)', () => {
    for (const s of plan.sites) {
      if (s.kind !== 'holoPanel' && s.kind !== 'holoObject') continue;
      const alongX = Math.abs(Math.sin(s.yaw)) < 0.5;
      const hx = s.kind === 'holoObject' ? s.w : alongX ? s.w / 2 : 1.5;
      const hz = s.kind === 'holoObject' ? s.w : alongX ? 1.5 : s.w / 2;
      const hy = s.kind === 'holoObject' ? s.w : s.h / 2;
      for (let i = 0; i < plan.boxCount; i++) {
        const o = i * BOX_STRIDE;
        const dx = Math.abs(wrapDelta(s.x, plan.boxes[o + BOX.cx]!, TILE));
        if (dx >= hx + plan.boxes[o + BOX.sx]! / 2) continue;
        const dz = Math.abs(wrapDelta(s.z, plan.boxes[o + BOX.cz]!, TILE));
        if (dz >= hz + plan.boxes[o + BOX.sz]! / 2) continue;
        const dy = Math.abs(s.y - (plan.boxes[o + BOX.y0]! + plan.boxes[o + BOX.sy]! / 2));
        expect(dy, `${s.kind} at ${s.x.toFixed(0)},${s.y.toFixed(0)},${s.z.toFixed(0)} touches box ${i}`)
          .toBeGreaterThanOrEqual(hy + plan.boxes[o + BOX.sy]! / 2);
      }
    }
  });

  it('avenue billboards avoid the sky lanes of their own avenue', () => {
    expect(panelAltitudes(0).length).toBeGreaterThanOrEqual(4);
    for (const y of panelAltitudes(0)) for (const lane of SKY_LANE_Y_X) expect(Math.abs(lane - y)).toBeGreaterThanOrEqual(38);
    for (const y of panelAltitudes(1)) for (const lane of SKY_LANE_Y_Z) expect(Math.abs(lane - y)).toBeGreaterThanOrEqual(38);
  });

  it('site fields are in range', () => {
    for (const s of plan.sites) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(TILE);
      expect(s.z).toBeGreaterThanOrEqual(0);
      expect(s.z).toBeLessThan(TILE);
      expect(s.color).toBeGreaterThanOrEqual(0);
      expect(s.color).toBeLessThanOrEqual(7);
      expect(s.seed).toBeGreaterThanOrEqual(0);
      expect(s.seed).toBeLessThan(1);
      expect(Number.isFinite(s.y + s.w + s.h + s.d + s.yaw)).toBe(true);
    }
  });
});

describe('city plan: queries', () => {
  it('heightAt finds roofs and is zero on roads', () => {
    for (let i = 0; i < plan.boxCount; i += 37) {
      const b = box(plan, i);
      expect(plan.heightAt(b.cx, b.cz)).toBeGreaterThanOrEqual(b.y0 + b.sy - 1e-3);
      expect(plan.heightAt(b.cx + TILE * 2, b.cz - TILE)).toBe(plan.heightAt(b.cx, b.cz));
    }
    for (let line = 0; line < CELLS; line++) {
      expect(plan.heightAt(line * CELL, 777)).toBe(0);
      expect(plan.heightAt(777, line * CELL + 5)).toBe(0);
    }
  });

  it('collide pushes a sphere out of boxes and leaves road air alone', () => {
    const rng = createRng(5);
    let pushed = 0;
    for (let n = 0; n < 4000; n++) {
      const i = rng.int(0, plan.boxCount - 1);
      const b = box(plan, i);
      const p = {
        x: b.cx + rng.range(-0.5, 0.5) * b.sx + (n % 2 ? TILE : 0),
        y: b.y0 + rng.range(0.02, 0.98) * b.sy,
        z: b.cz + rng.range(-0.5, 0.5) * b.sz - (n % 3 ? 0 : TILE),
      };
      const before = { ...p };
      // A few passes settle a sphere that was pushed from one box into a neighbour.
      let moved = false;
      for (let pass = 0; pass < 8; pass++) moved = plan.collide(p, 2) || moved;
      if (moved) pushed++;
      expect(plan.collide(p, 1.9), `still inside after settling: box ${i}`).toBe(false);
      expect(Math.abs(p.x - before.x)).toBeLessThan(200);
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    }
    expect(pushed).toBeGreaterThan(3000);

    for (let n = 0; n < 2000; n++) {
      const line = rng.int(0, CELLS - 1);
      const p = { x: line * CELL + rng.range(-9, 9), y: rng.range(3, 900), z: rng.range(-TILE, 2 * TILE) };
      const before = { ...p };
      expect(plan.collide(p, 2.5)).toBe(false);
      expect(p).toEqual(before);
    }
  });

  it('collide keeps the sphere above the road', () => {
    const p = { x: 0, y: -4, z: 0 };
    expect(plan.collide(p, 1.5)).toBe(true);
    expect(p.y).toBe(1.5);
  });
});
