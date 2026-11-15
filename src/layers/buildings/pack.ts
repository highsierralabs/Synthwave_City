// Instance attributes for the buildings layer, packed once from the city plan (plan T05, M1).
// Pure data: no three, so the unit tests can run it in node.
import { BOX, BOX_FLAG, BOX_STRIDE, BOX_STYLE, type CityPlan, type Site } from '../../contracts/city';
import { hashUnit } from '../../core/random';

/** Floats per instance in each attribute. */
export const POS_SIZE = 3;
export const SIZE_SIZE = 3;
export const STYLE_SIZE = 4;
export const SEED_SIZE = 3;

/** One mesh worth of boxes. Every array holds `count` instances. */
export interface BoxInstances {
  readonly count: number;
  /** Centre x, base y, centre z. */
  readonly pos: Float32Array;
  /** Full size along x, y, z. */
  readonly size: Float32Array;
  /** Style, palette index A, palette index B, flags. */
  readonly style: Float32Array;
  /** Box seed 0..1, building seed 0..1, roof height of the whole building (spires excluded), metres. */
  readonly seed: Float32Array;
}

export interface PackedBoxes {
  /** Boxes drawn with the unit box. */
  readonly square: BoxInstances;
  /** Boxes flagged BOX_FLAG.round, drawn with the unit cylinder. */
  readonly round: BoxInstances;
}

export type BoxSource = Pick<CityPlan, 'seed' | 'boxCount' | 'boxes'>;

function allocate(count: number): BoxInstances {
  return {
    count,
    pos: new Float32Array(count * POS_SIZE),
    size: new Float32Array(count * SIZE_SIZE),
    style: new Float32Array(count * STYLE_SIZE),
    seed: new Float32Array(count * SEED_SIZE),
  };
}

/** Split the plan's boxes into square and round instances: one instance per box, in plan order. */
export function packBoxes(plan: BoxSource): PackedBoxes {
  const { boxes, boxCount } = plan;
  let roundCount = 0;
  let maxBuilding = -1;
  for (let i = 0; i < boxCount; i++) {
    const o = i * BOX_STRIDE;
    if ((boxes[o + BOX.flags]! & BOX_FLAG.round) !== 0) roundCount++;
    const b = boxes[o + BOX.building]!;
    if (b > maxBuilding) maxBuilding = b;
  }
  // Roof height per building: facade gradients run over the whole stack, not over one box.
  const top = new Float32Array(maxBuilding + 1);
  for (let i = 0; i < boxCount; i++) {
    const o = i * BOX_STRIDE;
    if (boxes[o + BOX.style]! === BOX_STYLE.spire) continue;
    const b = boxes[o + BOX.building]!;
    const y1 = boxes[o + BOX.y0]! + boxes[o + BOX.sy]!;
    if (y1 > top[b]!) top[b] = y1;
  }
  const square = allocate(boxCount - roundCount);
  const round = allocate(roundCount);
  let si = 0, ri = 0;
  for (let i = 0; i < boxCount; i++) {
    const o = i * BOX_STRIDE;
    const flags = boxes[o + BOX.flags]!;
    const isRound = (flags & BOX_FLAG.round) !== 0;
    const out = isRound ? round : square;
    const k = isRound ? ri++ : si++;
    const building = boxes[o + BOX.building]!;
    out.pos[k * 3] = boxes[o + BOX.cx]!;
    out.pos[k * 3 + 1] = boxes[o + BOX.y0]!;
    out.pos[k * 3 + 2] = boxes[o + BOX.cz]!;
    out.size[k * 3] = boxes[o + BOX.sx]!;
    out.size[k * 3 + 1] = boxes[o + BOX.sy]!;
    out.size[k * 3 + 2] = boxes[o + BOX.sz]!;
    out.style[k * 4] = boxes[o + BOX.style]!;
    out.style[k * 4 + 1] = boxes[o + BOX.colorA]!;
    out.style[k * 4 + 2] = boxes[o + BOX.colorB]!;
    out.style[k * 4 + 3] = flags;
    out.seed[k * 3] = boxes[o + BOX.seed]!;
    out.seed[k * 3 + 1] = hashUnit(plan.seed, building, 0x5b);
    out.seed[k * 3 + 2] = Math.max(top[building]!, 1);
  }
  return { square, round };
}

export const LIGHT_SITE_SIZE = 4;
export const LIGHT_KIND_SIZE = 2;

export interface LightInstances {
  readonly count: number;
  /** x, y, z, size. */
  readonly site: Float32Array;
  /** Palette index, seed 0..1. */
  readonly kind: Float32Array;
}

/** The aviation lights: one sprite per roofLight site, in plan order. */
export function packRoofLights(sites: readonly Site[]): LightInstances {
  let count = 0;
  for (let i = 0; i < sites.length; i++) if (sites[i]!.kind === 'roofLight') count++;
  const site = new Float32Array(count * LIGHT_SITE_SIZE);
  const kind = new Float32Array(count * LIGHT_KIND_SIZE);
  let k = 0;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]!;
    if (s.kind !== 'roofLight') continue;
    site[k * 4] = s.x;
    site[k * 4 + 1] = s.y;
    site[k * 4 + 2] = s.z;
    site[k * 4 + 3] = s.w;
    kind[k * 2] = s.color;
    kind[k * 2 + 1] = s.seed;
    k++;
  }
  return { count, site, kind };
}
