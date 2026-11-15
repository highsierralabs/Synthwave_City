// Massing (plan T01, M2): every block is cut into lots and every lot gets a stack of boxes.
import {
  BOX_FLAG, BOX_STRIDE, BOX_STYLE, CELL_FIELD, CELL_HEIGHT_UNIT, CELL_STRIDE, DISTRICT, type BoxStyle, type District,
} from '../contracts/city';
import { CELL, CELLS, roadSpec } from '../contracts/constants';
import { clamp } from '../core/math';
import type { Rng } from '../core/random';
import { districtOf, type DistrictMap } from './districts';

export interface BuildingInfo {
  readonly id: number;
  readonly cell: number;
  readonly district: District;
  /** Centre. */
  readonly x: number;
  readonly z: number;
  /** Footprint of the base and of the top segment. */
  readonly baseX: number;
  readonly baseZ: number;
  readonly topX: number;
  readonly topZ: number;
  /** Roof height, not counting a spire. */
  readonly top: number;
  /** Tip of the spire, or 0 when there is none. */
  readonly spireTop: number;
  readonly hasCrown: boolean;
  readonly round: boolean;
  readonly colorA: number;
  readonly colorB: number;
  /** For megatowers: base y, height and footprint of each segment. */
  readonly segments: readonly { y0: number; h: number; sx: number; sz: number }[];
}

export interface Massing {
  readonly boxes: Float32Array;
  readonly boxCount: number;
  readonly buildings: readonly BuildingInfo[];
}

export interface BlockRect { x0: number; x1: number; z0: number; z1: number }

/** The buildable rectangle of a cell: the cell minus the road corridors on its four sides. */
export function blockRect(cx: number, cz: number): BlockRect {
  return {
    x0: cx * CELL + roadSpec(cx).corridorHalf,
    x1: (cx + 1) * CELL - roadSpec(cx + 1).corridorHalf,
    z0: cz * CELL + roadSpec(cz).corridorHalf,
    z1: (cz + 1) * CELL - roadSpec(cz + 1).corridorHalf,
  };
}

/** Cut a length into n pieces of uneven size with a fixed gap between them. Returns [start, size] pairs. */
function split(length: number, n: number, gap: number, rng: Rng): [number, number][] {
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.range(0.8, 1.25);
    weights.push(w);
    total += w;
  }
  const usable = length - gap * (n - 1);
  const out: [number, number][] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = (usable * weights[i]!) / total;
    out.push([at, size]);
    at += size + gap;
  }
  return out;
}

const SHAFT_STYLES: readonly BoxStyle[] = [BOX_STYLE.shaft, BOX_STYLE.glass, BOX_STYLE.slab, BOX_STYLE.strip];
const LOW_STYLES: readonly BoxStyle[] = [BOX_STYLE.podium, BOX_STYLE.slab, BOX_STYLE.shaft, BOX_STYLE.podium];

export function buildMassing(rng: Rng, map: DistrictMap): Massing {
  const data: number[] = [];
  const buildings: BuildingInfo[] = [];
  const cells = map.cells;

  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const cell = cz * CELLS + cx;
      const district = districtOf(cells, cell);
      const f = map.field[cell]!;
      const cellPalette = cells[cell * CELL_STRIDE + CELL_FIELD.palette]!;
      const rect = blockRect(cx, cz);
      const bw = rect.x1 - rect.x0, bd = rect.z1 - rect.z0;
      let cellTop = 0;

      const push = (
        x: number, y0: number, z: number, sx: number, sy: number, sz: number,
        style: BoxStyle, colorA: number, colorB: number, flags: number, building: number,
      ): void => {
        data.push(x, y0, z, sx, sy, sz, style, colorA, colorB, rng.next(), flags, building);
        cellTop = Math.max(cellTop, y0 + sy);
      };
      const colours = (): [number, number] => {
        const a = rng.chance(0.65) ? cellPalette : rng.int(0, 4);
        let b = rng.int(0, 5);
        if (b === a) b = (b + 1) % 5;
        return [a, b];
      };

      if (district === DISTRICT.plaza) {
        // An open square, sometimes with kiosks in the corners. The centre always stays clear.
        if (rng.chance(0.6)) {
          const [a, b] = colours();
          for (const sxn of [-1, 1]) {
            for (const szn of [-1, 1]) {
              if (rng.chance(0.3)) continue;
              const size = rng.range(8, 14);
              const id = buildings.length;
              const x = (rect.x0 + rect.x1) / 2 + sxn * (bw / 2 - size / 2 - rng.range(3, 9));
              const z = (rect.z0 + rect.z1) / 2 + szn * (bd / 2 - size / 2 - rng.range(3, 9));
              const h = rng.range(4, 8);
              push(x, 0, z, size, h, size, BOX_STYLE.kiosk, a, b, BOX_FLAG.roof | BOX_FLAG.street, id);
              buildings.push({
                id, cell, district, x, z, baseX: size, baseZ: size, topX: size, topZ: size, top: h, spireTop: 0,
                hasCrown: false, round: false, colorA: a, colorB: b, segments: [],
              });
            }
          }
        }
      } else if (district === DISTRICT.mega) {
        // One megatower filling the block, stepping in as it rises.
        const id = buildings.length;
        const [a, b] = colours();
        const x = (rect.x0 + rect.x1) / 2, z = (rect.z0 + rect.z1) / 2;
        const total = rng.range(600, 900);
        const n = rng.int(5, 7);
        let sx = bw - 8, sz = bd - 8;
        const baseX = sx, baseZ = sz;
        let y = 0;
        const segments: { y0: number; h: number; sx: number; sz: number }[] = [];
        // Segment heights fall off geometrically.
        const ratio = 0.8;
        const first = (total * (1 - ratio)) / (1 - Math.pow(ratio, n));
        for (let s = 0; s < n; s++) {
          const h = first * Math.pow(ratio, s);
          const flags = BOX_FLAG.landmark | (s === 0 ? BOX_FLAG.street : 0);
          push(x, y, z, sx, h, sz, BOX_STYLE.mega, a, b, flags, id);
          segments.push({ y0: y, h, sx, sz });
          y += h;
          sx *= rng.range(0.78, 0.88);
          sz *= rng.range(0.78, 0.88);
        }
        const crownH = rng.range(10, 18);
        push(x, y, z, sx, crownH, sz, BOX_STYLE.crown, a, b, BOX_FLAG.landmark | BOX_FLAG.roof, id);
        const top = y + crownH;
        const spireH = rng.range(90, 160);
        push(x, top, z, 6, spireH, 6, BOX_STYLE.spire, a, b, BOX_FLAG.landmark, id);
        buildings.push({
          id, cell, district, x, z, baseX, baseZ, topX: sx, topZ: sz, top, spireTop: top + spireH,
          hasCrown: true, round: false, colorA: a, colorB: b, segments,
        });
      } else {
        // Lots.
        let nx: number, nz: number, gap: number;
        if (district === DISTRICT.lowrise) {
          nx = rng.int(2, 4); nz = rng.int(2, 4); gap = rng.range(4, 8);
        } else if (district === DISTRICT.midtown) {
          nx = rng.int(1, 3); nz = rng.int(1, 3); gap = rng.range(5, 10);
          if (nx === 1 && nz === 1) nx = 2;
        } else {
          const u = rng.next();
          nx = u < 0.2 ? 1 : 2;
          nz = u < 0.2 ? 1 : u < 0.6 ? 1 : 2;
          if (u >= 0.2 && u < 0.6 && rng.chance(0.5)) { nx = 1; nz = 2; }
          gap = rng.range(8, 14);
        }
        const xs = split(bw, nx, gap, rng), zs = split(bd, nz, gap, rng);
        for (const [lx, lw] of xs) {
          for (const [lz, ld] of zs) {
            if (district === DISTRICT.lowrise && rng.chance(0.04)) continue; // a gap in the street wall
            const margin = rng.range(0.5, 3);
            let w = lw - margin * 2, d = ld - margin * 2;
            if (w < 10 || d < 10) continue;
            const x = rect.x0 + lx + lw / 2, z = rect.z0 + lz + ld / 2;
            const id = buildings.length;
            const [a, b] = colours();
            const baseX = w, baseZ = d;
            let y = 0;
            let round = false;
            let hasCrown = false;
            let spireTop = 0;

            if (district === DISTRICT.lowrise) {
              const h = 12 + Math.pow(rng.next(), 1.6) * 50;
              if (rng.chance(0.7)) {
                push(x, 0, z, w, h, d, rng.pick(LOW_STYLES), a, b, BOX_FLAG.roof | BOX_FLAG.street, id);
                y = h;
              } else {
                const baseH = h * rng.range(0.35, 0.55);
                push(x, 0, z, w, baseH, d, BOX_STYLE.podium, a, b, BOX_FLAG.street, id);
                w *= rng.range(0.6, 0.85); d *= rng.range(0.6, 0.85);
                push(x, baseH, z, w, h - baseH, d, rng.pick(LOW_STYLES), a, b, BOX_FLAG.roof, id);
                y = h;
              }
            } else {
              const downtown = district === DISTRICT.downtown;
              const fn = downtown ? clamp((f - 0.6) / 0.4, 0, 1) : clamp((f - 0.3) / 0.3, 0, 1);
              const h = downtown
                ? 170 + (0.5 * fn + 0.5 * Math.pow(rng.next(), 1.2)) * 320
                : 55 + (0.35 * fn + 0.65 * Math.pow(rng.next(), 1.3)) * 150;
              const style = rng.pick(SHAFT_STYLES);
              round = rng.chance(downtown ? 0.12 : 0.06);
              let street: number = BOX_FLAG.street;
              if (rng.chance(downtown ? 0.7 : 0.6)) {
                const podH = downtown ? rng.range(12, 24) : rng.range(8, 18);
                push(x, 0, z, w, podH, d, BOX_STYLE.podium, a, b, BOX_FLAG.street, id);
                y = podH;
                street = 0;
                const inset = downtown ? rng.range(4, 10) : rng.range(3, 8);
                w = Math.max(10, w - inset * 2); d = Math.max(10, d - inset * 2);
              }
              if (round) { w = Math.min(w, d); d = w; }
              const roundFlag = round ? BOX_FLAG.round : 0;
              const crown = rng.chance(downtown ? 0.7 : 0.35);
              const crownH = crown ? rng.range(4, 8) : 0;
              const setbacks = downtown ? rng.int(0, 3) : rng.chance(0.3) ? 1 : 0;
              let remaining = h - y - crownH;
              for (let s = 0; s <= setbacks; s++) {
                const last = s === setbacks;
                const part = last ? remaining : remaining * rng.range(0.45, 0.65);
                const flags = roundFlag | (s === 0 ? street : 0) | (last && !crown ? BOX_FLAG.roof : 0);
                push(x, y, z, w, part, d, style, a, b, flags, id);
                y += part;
                remaining -= part;
                if (!last) {
                  const k = rng.range(0.74, 0.88);
                  w = Math.max(8, w * k); d = Math.max(8, d * k);
                }
              }
              if (crown) {
                const cw = Math.max(6, w - 3), cd = Math.max(6, d - 3);
                push(x, y, z, cw, crownH, cd, BOX_STYLE.crown, a, b, roundFlag | BOX_FLAG.roof, id);
                y += crownH;
                hasCrown = true;
                w = cw; d = cd;
              }
              if (rng.chance(downtown ? 0.3 : 0.1)) {
                const sw = rng.range(2.5, 4), sh = rng.range(30, 90);
                push(x, y, z, sw, sh, sw, BOX_STYLE.spire, a, b, 0, id);
                spireTop = y + sh;
              }
            }
            buildings.push({
              id, cell, district, x, z, baseX, baseZ, topX: w, topZ: d, top: y, spireTop, hasCrown, round,
              colorA: a, colorB: b, segments: [],
            });
          }
        }
      }
      cells[cell * CELL_STRIDE + CELL_FIELD.height] = Math.min(255, Math.round(cellTop / CELL_HEIGHT_UNIT));
    }
  }
  const boxes = new Float32Array(data);
  return { boxes, boxCount: boxes.length / BOX_STRIDE, buildings };
}
