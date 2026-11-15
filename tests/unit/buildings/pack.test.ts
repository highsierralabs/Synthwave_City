import { describe, expect, it } from 'vitest';
import { BOX, BOX_FLAG, BOX_STRIDE, BOX_STYLE, type Site } from '../../../src/contracts/city';
import {
  LIGHT_KIND_SIZE, LIGHT_SITE_SIZE, POS_SIZE, SEED_SIZE, SIZE_SIZE, STYLE_SIZE, packBoxes, packRoofLights,
  type BoxInstances, type BoxSource,
} from '../../../src/layers/buildings/pack';

interface TestBox {
  cx: number; y0: number; cz: number; sx: number; sy: number; sz: number;
  style: number; colorA: number; colorB: number; seed: number; flags: number; building: number;
}

/** A small hand-made plan: a podium tower with a spire, a round tower, a kiosk. */
const BOXES: readonly TestBox[] = [
  { cx: 100, y0: 0, cz: 200, sx: 60, sy: 16, sz: 50, style: BOX_STYLE.podium, colorA: 0, colorB: 1, seed: 0.11, flags: BOX_FLAG.street, building: 0 },
  { cx: 100, y0: 16, cz: 200, sx: 40, sy: 180, sz: 36, style: BOX_STYLE.glass, colorA: 0, colorB: 1, seed: 0.22, flags: 0, building: 0 },
  { cx: 100, y0: 196, cz: 200, sx: 37, sy: 6, sz: 33, style: BOX_STYLE.crown, colorA: 0, colorB: 1, seed: 0.33, flags: BOX_FLAG.roof, building: 0 },
  { cx: 100, y0: 202, cz: 200, sx: 3, sy: 70, sz: 3, style: BOX_STYLE.spire, colorA: 0, colorB: 1, seed: 0.44, flags: 0, building: 0 },
  { cx: 400, y0: 0, cz: 300, sx: 30, sy: 120, sz: 30, style: BOX_STYLE.shaft, colorA: 2, colorB: 4, seed: 0.55, flags: BOX_FLAG.street | BOX_FLAG.round, building: 1 },
  { cx: 400, y0: 120, cz: 300, sx: 27, sy: 5, sz: 27, style: BOX_STYLE.crown, colorA: 2, colorB: 4, seed: 0.66, flags: BOX_FLAG.roof | BOX_FLAG.round, building: 1 },
  { cx: 700, y0: 0, cz: 900, sx: 10, sy: 6, sz: 10, style: BOX_STYLE.kiosk, colorA: 3, colorB: 5, seed: 0.77, flags: BOX_FLAG.roof | BOX_FLAG.street, building: 2 },
];

function makePlan(list: readonly TestBox[], seed = 1984): BoxSource {
  const boxes = new Float32Array(list.length * BOX_STRIDE);
  list.forEach((b, i) => {
    const o = i * BOX_STRIDE;
    for (const key of Object.keys(BOX) as (keyof typeof BOX)[]) boxes[o + BOX[key]] = b[key];
  });
  return { seed, boxCount: list.length, boxes };
}

/** Read instance k of a packed set back into the shape of a TestBox, plus the extra seed fields. */
function unpack(set: BoxInstances, k: number): { box: Omit<TestBox, 'building'>; buildingSeed: number; top: number } {
  return {
    box: {
      cx: set.pos[k * 3]!, y0: set.pos[k * 3 + 1]!, cz: set.pos[k * 3 + 2]!,
      sx: set.size[k * 3]!, sy: set.size[k * 3 + 1]!, sz: set.size[k * 3 + 2]!,
      style: set.style[k * 4]!, colorA: set.style[k * 4 + 1]!, colorB: set.style[k * 4 + 2]!, flags: set.style[k * 4 + 3]!,
      seed: set.seed[k * 3]!,
    },
    buildingSeed: set.seed[k * 3 + 1]!,
    top: set.seed[k * 3 + 2]!,
  };
}

describe('buildings: attribute packer', () => {
  const plan = makePlan(BOXES);
  const packed = packBoxes(plan);

  it('writes exactly one instance per plan box, split by the round flag', () => {
    const round = BOXES.filter((b) => (b.flags & BOX_FLAG.round) !== 0).length;
    expect(packed.round.count).toBe(round);
    expect(packed.square.count).toBe(BOXES.length - round);
    expect(packed.square.count + packed.round.count).toBe(plan.boxCount);
  });

  it('sizes every array for its instance count', () => {
    for (const set of [packed.square, packed.round]) {
      expect(set.pos.length).toBe(set.count * POS_SIZE);
      expect(set.size.length).toBe(set.count * SIZE_SIZE);
      expect(set.style.length).toBe(set.count * STYLE_SIZE);
      expect(set.seed.length).toBe(set.count * SEED_SIZE);
    }
  });

  it('copies position, size, style, colours, flags and seed of each box, in plan order', () => {
    let si = 0, ri = 0;
    for (const b of BOXES) {
      const isRound = (b.flags & BOX_FLAG.round) !== 0;
      const got = unpack(isRound ? packed.round : packed.square, isRound ? ri++ : si++).box;
      const { building: _building, ...want } = b;
      for (const key of Object.keys(want) as (keyof typeof want)[]) {
        expect(got[key], key).toBeCloseTo(want[key], 5);
      }
    }
  });

  it('gives every box of a building the same building seed, and different buildings different ones', () => {
    const seeds = [0, 1, 2, 3].map((k) => unpack(packed.square, k).buildingSeed);
    expect(new Set(seeds).size).toBe(1);
    const other = unpack(packed.round, 0).buildingSeed;
    const kiosk = unpack(packed.square, 4).buildingSeed;
    expect(other).not.toBe(seeds[0]);
    expect(kiosk).not.toBe(seeds[0]);
    expect(kiosk).not.toBe(other);
    for (const s of [seeds[0]!, other, kiosk]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
  });

  it('records the roof height of the whole building, ignoring the spire', () => {
    for (let k = 0; k < 4; k++) expect(unpack(packed.square, k).top).toBeCloseTo(202, 4);
    expect(unpack(packed.round, 0).top).toBeCloseTo(125, 4);
    expect(unpack(packed.round, 1).top).toBeCloseTo(125, 4);
    expect(unpack(packed.square, 4).top).toBeCloseTo(6, 4);
  });

  it('is deterministic, and the building seeds follow the plan seed', () => {
    const again = packBoxes(makePlan(BOXES));
    expect(Array.from(again.square.seed)).toEqual(Array.from(packed.square.seed));
    expect(Array.from(again.round.pos)).toEqual(Array.from(packed.round.pos));
    const reseeded = packBoxes(makePlan(BOXES, 7));
    expect(unpack(reseeded.square, 0).buildingSeed).not.toBe(unpack(packed.square, 0).buildingSeed);
  });

  it('handles an empty plan and a plan with no round boxes', () => {
    const empty = packBoxes(makePlan([]));
    expect(empty.square.count).toBe(0);
    expect(empty.round.count).toBe(0);
    const square = packBoxes(makePlan(BOXES.filter((b) => (b.flags & BOX_FLAG.round) === 0)));
    expect(square.round.count).toBe(0);
    expect(square.square.count).toBe(5);
  });
});

describe('buildings: aviation lights', () => {
  const site = (kind: Site['kind'], x: number, seed: number): Site => ({
    kind, x, y: 300, z: 40, w: 1.6, h: 0, d: 0, yaw: 0, color: 6, seed,
  });
  const sites: Site[] = [
    site('holoPanel', 1, 0.1), site('roofLight', 2, 0.2), site('pillar', 3, 0.3), site('roofLight', 4, 0.4),
  ];

  it('packs one sprite per roofLight site and nothing else', () => {
    const lights = packRoofLights(sites);
    expect(lights.count).toBe(2);
    expect(lights.site.length).toBe(2 * LIGHT_SITE_SIZE);
    expect(lights.kind.length).toBe(2 * LIGHT_KIND_SIZE);
    expect(Array.from(lights.site.slice(0, 4))).toEqual([2, 300, 40, Math.fround(1.6)]);
    expect(lights.site[4]).toBe(4);
    expect(lights.kind[0]).toBe(6);
    expect(lights.kind[1]).toBeCloseTo(0.2, 6);
    expect(lights.kind[3]).toBeCloseTo(0.4, 6);
  });

  it('returns empty arrays when there are no roof lights', () => {
    const lights = packRoofLights([site('ticker', 1, 0.5)]);
    expect(lights.count).toBe(0);
    expect(lights.site.length).toBe(0);
  });
});
