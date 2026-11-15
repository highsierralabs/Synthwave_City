import { describe, expect, it } from 'vitest';
import { createCityPlan } from '../../../src/city/index';
import { BOX, BOX_STRIDE } from '../../../src/contracts/city';
import { AVENUE, CAMERA_FAR, CELL, CELLS, STREET, TILE, roadSpec } from '../../../src/contracts/constants';
import { QUALITY } from '../../../src/contracts/quality';
import {
  GROUND, LAMP, LAMP_PATTERN, LAMP_STRIDE, POST_LATTICE, axisFrame, blockDistance, buildDisc, buildLamps, buildPost,
  curbDistance, lampColor, lampCount, lampHead, lampSpacing, periodsDivideTile, surfaceAt, type Surface,
} from '../../../src/layers/ground/layout';
import { GROUND_FRAG, LIGHT, POST_VERT, SPRITE_VERT } from '../../../src/layers/ground/shaders';

/** Widths of each surface met while walking across one cell along x, at mid-block in z. */
function scan(cellX: number, step = 0.05): Record<Surface, number> {
  const widths: Record<Surface, number> = { road: 0, junction: 0, sidewalk: 0, block: 0 };
  const z = 2.5 * CELL;
  for (let u = step / 2; u < CELL; u += step) widths[surfaceAt(cellX * CELL + u, z)] += step;
  return widths;
}

describe('surface classifier', () => {
  it('carriageway, sidewalk and block widths add up to CELL', () => {
    for (let cell = 0; cell < 8; cell++) {
      const lo = roadSpec(cell), hi = roadSpec(cell + 1);
      const w = scan(cell);
      expect(w.road).toBeCloseTo(lo.roadHalf + hi.roadHalf, 1);
      expect(w.sidewalk).toBeCloseTo(lo.sidewalk + hi.sidewalk, 1);
      expect(w.block).toBeCloseTo(CELL - lo.corridorHalf - hi.corridorHalf, 1);
      expect(w.junction).toBe(0);
      expect(w.road + w.sidewalk + w.block).toBeCloseTo(CELL, 6);
      const f = axisFrame(cell * CELL + 1);
      expect(f.curbLo + (f.blockLo - f.curbLo) + (f.blockHi - f.blockLo) + (f.curbHi - f.blockHi) + (CELL - f.curbHi)).toBe(CELL);
    }
  });

  it('names the pieces of a street and an avenue', () => {
    const z = 2.5 * CELL;
    // Line 0 is an avenue, line 1 a street.
    expect(surfaceAt(AVENUE.roadHalf - 0.1, z)).toBe('road');
    expect(surfaceAt(AVENUE.roadHalf + 0.1, z)).toBe('sidewalk');
    expect(surfaceAt(AVENUE.corridorHalf + 0.1, z)).toBe('block');
    expect(surfaceAt(CELL - STREET.corridorHalf + 0.1, z)).toBe('sidewalk');
    expect(surfaceAt(CELL - STREET.roadHalf + 0.1, z)).toBe('road');
    expect(surfaceAt(CELL + STREET.roadHalf - 0.1, z)).toBe('road');
    expect(surfaceAt(0, 0)).toBe('junction');
    expect(surfaceAt(CELL + 3, 2 * CELL - 3)).toBe('junction');
    // The curb corner is rounded: just inside the square corner is still carriageway.
    expect(surfaceAt(AVENUE.roadHalf + 0.3, AVENUE.roadHalf + 0.3)).toBe('road');
    expect(surfaceAt(AVENUE.roadHalf + 2, AVENUE.roadHalf + 2)).toBe('sidewalk');
  });

  it('is periodic with the tile and continuous across cell boundaries', () => {
    for (const [x, z] of [[13, 200], [700.5, 1234.25], [3199, 17], [6399.5, 6399.5]] as const) {
      expect(surfaceAt(x + TILE, z - TILE)).toBe(surfaceAt(x, z));
      expect(curbDistance(x - 2 * TILE, z + TILE)).toBeCloseTo(curbDistance(x, z), 6);
    }
    // Either side of a road centre line the curb is the same distance away.
    for (const line of [0, 1, 4, 7]) {
      for (const z of [50, 81, 155, 159.5, 162, 170]) {
        expect(curbDistance(line * CELL - 1e-6, z)).toBeCloseTo(curbDistance(line * CELL + 1e-6, z), 4);
        expect(curbDistance(z, line * CELL - 1e-6)).toBeCloseTo(curbDistance(z, line * CELL + 1e-6), 4);
      }
    }
  });

  it('every building of the city plan stands on block floor, never on a road or a sidewalk', () => {
    const plan = createCityPlan(1984);
    expect(plan.boxCount).toBeGreaterThan(1000);
    let worst = -Infinity;
    for (let i = 0; i < plan.boxCount; i++) {
      const o = i * BOX_STRIDE;
      const cx = plan.boxes[o + BOX.cx]!, cz = plan.boxes[o + BOX.cz]!;
      const hx = plan.boxes[o + BOX.sx]! / 2, hz = plan.boxes[o + BOX.sz]! / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) worst = Math.max(worst, blockDistance(cx + sx * hx, cz + sz * hz));
      // All four corners in the same block as the centre.
      expect(Math.floor((cx - hx) / CELL)).toBe(Math.floor((cx + hx) / CELL));
      expect(Math.floor((cz - hz) / CELL)).toBe(Math.floor((cz + hz) / CELL));
    }
    expect(worst).toBeLessThanOrEqual(1e-3);
  });
});

describe('street lamps', () => {
  const plan = createCityPlan(1984);

  it('stand on the sidewalk with the head over the carriageway, clear of every building', () => {
    for (const spacing of [GROUND.lampSpacing, GROUND.lampSpacingSparse]) {
      const lamps = buildLamps(spacing, TILE);
      const n = lamps.length / LAMP_STRIDE;
      expect(n).toBe(lampCount(spacing, TILE));
      expect(n).toBe(2 * 2 * CELLS * (TILE / spacing));
      const head = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < n; i++) {
        const o = i * LAMP_STRIDE;
        const x = lamps[o + LAMP.x]!, z = lamps[o + LAMP.z]!;
        expect(surfaceAt(x, z)).toBe('sidewalk');
        expect(plan.heightAt(x, z)).toBe(0);
        expect(Math.hypot(lamps[o + LAMP.dirX]!, lamps[o + LAMP.dirZ]!)).toBe(1);
        lampHead(lamps, i, head);
        expect(surfaceAt(head.x, head.z)).toBe('road');
        expect(plan.heightAt(head.x, head.z)).toBe(0);
        expect(head.y).toBeGreaterThan(6);
      }
    }
  });

  it('keep clear of the traffic lanes', () => {
    // The head hangs outside the outermost lane centre by at least half a car.
    for (const spec of [STREET, AVENUE]) {
      const headOffset = spec.roadHalf + GROUND.lampSetback - GROUND.lampArm;
      expect(headOffset).toBeGreaterThan(spec.lanes[spec.lanes.length - 1]! - 0.5);
      expect(headOffset).toBeLessThan(spec.roadHalf);
    }
  });

  it('repeat with the lamp pattern, so the post lattice matches the full set', () => {
    const key = (x: number, z: number, c: number): string => `${x.toFixed(3)},${z.toFixed(3)},${c}`;
    for (const spacing of [GROUND.lampSpacing, GROUND.lampSpacingSparse]) {
      const pattern = buildLamps(spacing, LAMP_PATTERN);
      const all = buildLamps(spacing, TILE);
      const full = new Set<string>();
      for (let o = 0; o < all.length; o += LAMP_STRIDE) full.add(key(all[o + LAMP.x]!, all[o + LAMP.z]!, all[o + LAMP.color]!));
      // Shift the pattern by any whole number of periods: every lamp is still a lamp of the tile.
      for (const [kx, kz] of [[0, 0], [3, 7], [9, 9]] as const) {
        for (let o = 0; o < pattern.length; o += LAMP_STRIDE) {
          const x = pattern[o + LAMP.x]! + kx * LAMP_PATTERN, z = pattern[o + LAMP.z]! + kz * LAMP_PATTERN;
          expect(full.has(key(x, z, pattern[o + LAMP.color]!))).toBe(true);
        }
      }
      expect((pattern.length / LAMP_STRIDE) * (TILE / LAMP_PATTERN) ** 2).toBe(all.length / LAMP_STRIDE);
    }
    // The lattice reaches further than the distance at which posts have faded out.
    expect(POST_LATTICE * LAMP_PATTERN - LAMP_PATTERN / 2).toBeGreaterThan(GROUND.postFadeEnd);
  });

  it('alternate colour by street, and thin out on the lower tiers', () => {
    expect(lampColor(0)).toBe(GROUND.lampColorEven);
    expect(lampColor(1)).toBe(GROUND.lampColorOdd);
    expect(lampColor(-1)).toBe(GROUND.lampColorOdd);
    expect(lampColor(CELLS)).toBe(lampColor(0));
    expect(lampSpacing(QUALITY.high.density)).toBe(GROUND.lampSpacing);
    expect(lampSpacing(QUALITY.medium.density)).toBe(GROUND.lampSpacingSparse);
    expect(lampSpacing(QUALITY.low.density)).toBe(GROUND.lampSpacingSparse);
  });
});

describe('patterns and meshes', () => {
  it('every period divides the cell, so nothing jumps when the camera wraps', () => {
    expect(periodsDivideTile()).toBe(true);
    expect(Number.isInteger(CELL / GROUND.floorGrid)).toBe(true);
  });

  it('the disc is closed, faces up and reaches past the far plane', () => {
    const disc = buildDisc(CAMERA_FAR * 1.75);
    const p = disc.positions;
    let reach = 0;
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i + 1]).toBe(0);
      reach = Math.max(reach, Math.hypot(p[i]!, p[i + 2]!));
    }
    expect(reach).toBeCloseTo(CAMERA_FAR * 1.75, 1);
    let area = 0;
    for (let i = 0; i < disc.indices.length; i += 3) {
      const a = disc.indices[i]! * 3, b = disc.indices[i + 1]! * 3, c = disc.indices[i + 2]! * 3;
      // y component of the face normal: positive when the triangle faces up.
      const ny = (p[b + 2]! - p[a + 2]!) * (p[c]! - p[a]!) - (p[b]! - p[a]!) * (p[c + 2]! - p[a + 2]!);
      expect(ny).toBeGreaterThan(0);
      area += ny / 2;
    }
    // A 48-gon inscribed in the outer circle: no holes, no overlaps.
    const r = CAMERA_FAR * 1.75;
    expect(area / (24 * r * r * Math.sin((2 * Math.PI) / 48))).toBeCloseTo(1, 4);
  });

  it('the post is a small mesh with a lit head at the end of its arm', () => {
    const post = buildPost();
    expect(post.indices.length / 3).toBeLessThanOrEqual(40);
    expect(Math.max(...post.indices)).toBe(post.positions.length / 3 - 1);
    let headX = 0, lit = 0;
    for (let i = 0; i < post.parts.length; i++) {
      if (post.parts[i] === 1) { headX += post.positions[i * 3]!; lit++; }
    }
    expect(lit).toBe(8);
    expect(headX / lit).toBeCloseTo(GROUND.lampArm, 6);
  });

  it('the shaders carry the same numbers as the TypeScript layout', () => {
    const define = (src: string, name: string): number => {
      const m = new RegExp('#define ' + name + ' ([0-9.]+)').exec(src);
      if (!m) throw new Error('no #define ' + name);
      return Number(m[1]);
    };
    expect(define(GROUND_FRAG, 'G_CURB_R')).toBe(GROUND.curbRadius);
    expect(define(GROUND_FRAG, 'G_CELLS_I')).toBe(CELLS);
    expect(define(GROUND_FRAG, 'G_DASH_PERIOD')).toBe(GROUND.dashPeriod);
    expect(define(GROUND_FRAG, 'G_LAMP_HEAD_IN')).toBeCloseTo(GROUND.lampArm - GROUND.lampSetback, 9);
    expect(define(GROUND_FRAG, 'G_LAMP_COL_EVEN')).toBe(GROUND.lampColorEven);
    expect(define(GROUND_FRAG, 'G_LAMP_COL_ODD')).toBe(GROUND.lampColorOdd);
    expect(define(POST_VERT, 'G_PATTERN')).toBe(LAMP_PATTERN);
    expect(define(SPRITE_VERT, 'G_SPRITE')).toBe(GROUND.spriteSize);
    // Noise frequencies times TILE must equal the lattice periods passed to g_noise.
    for (const [freq, period] of [[0.025, 160], [0.125, 800], [0.5, 3200], [5, 32000], [1.25, 8000], [0.25, 1600]] as const) {
      expect(TILE * freq).toBe(period);
      expect(GROUND_FRAG).toContain(`, ${period})`);
    }
  });

  it('light levels sit in their bands (architecture.md 5.2)', () => {
    for (const l2 of [LIGHT.curb, LIGHT.paint, LIGHT.centre, LIGHT.tube, LIGHT.stop, LIGHT.plazaGrid, LIGHT.plazaRing, LIGHT.spark]) {
      expect(l2).toBeGreaterThanOrEqual(1.5);
      expect(l2).toBeLessThanOrEqual(4);
    }
    expect(LIGHT.zebra).toBeLessThanOrEqual(1);
    expect(LIGHT.head).toBeGreaterThanOrEqual(4);
    expect(LIGHT.head).toBeLessThanOrEqual(10);
    for (const pool of [LIGHT.poolRoad, LIGHT.poolWalk, LIGHT.poolFloor]) expect(pool).toBeLessThanOrEqual(1);
  });
});
