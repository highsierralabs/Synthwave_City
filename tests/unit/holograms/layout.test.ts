import { describe, expect, it } from 'vitest';
import {
  ATLAS_SIZE, CELL_PAD, STRIP, TALL, WIDE, atlasLayout, cellRect, cellsOfKind,
} from '../../../src/layers/holograms/layout';

describe('atlas layout', () => {
  const cells = atlasLayout();

  it('has the advertised number of cells of each kind, indexed in order', () => {
    for (const [kind, spec] of [['wide', WIDE], ['tall', TALL], ['strip', STRIP]] as const) {
      const group = cellsOfKind(cells, kind);
      expect(group.length).toBe(spec.count);
      group.forEach((c, i) => {
        expect(c.index).toBe(i);
        expect(c.w).toBe(spec.w);
        expect(c.h).toBe(spec.h);
      });
    }
    // The plan asks for 16 or more panel ads.
    expect(cellsOfKind(cells, 'wide').length + cellsOfKind(cells, 'tall').length).toBeGreaterThanOrEqual(16);
  });

  it('keeps every cell inside the canvas, on whole pixels', () => {
    expect(Number.isInteger(Math.log2(ATLAS_SIZE))).toBe(true);
    for (const c of cells) {
      for (const v of [c.x, c.y, c.w, c.h]) expect(Number.isInteger(v)).toBe(true);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(c.y + c.h).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(c.w).toBeGreaterThan(2 * CELL_PAD);
      expect(c.h).toBeGreaterThan(2 * CELL_PAD);
    }
  });

  it('has no two cells overlapping', () => {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]!, b = cells[j]!;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `cells ${i} and ${j} overlap`).toBe(true);
      }
    }
  });

  it('lets the ticker strips span the full width, so they can wrap', () => {
    for (const c of cellsOfKind(cells, 'strip')) {
      expect(c.x).toBe(0);
      expect(c.w).toBe(ATLAS_SIZE);
    }
  });

  it('maps a cell to a texture rectangle inside it, flipped in v', () => {
    for (const c of cells) {
      const [u, v, du, dv] = cellRect(c, 1);
      expect(u).toBeCloseTo((c.x + 1) / ATLAS_SIZE, 12);
      expect(u + du).toBeCloseTo((c.x + c.w - 1) / ATLAS_SIZE, 12);
      // v = 0 is the bottom of the canvas.
      expect(1 - (v + dv)).toBeCloseTo((c.y + 1) / ATLAS_SIZE, 12);
      expect(1 - v).toBeCloseTo((c.y + c.h - 1) / ATLAS_SIZE, 12);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(u + du).toBeLessThanOrEqual(1);
      expect(v + dv).toBeLessThanOrEqual(1);
    }
  });
});
