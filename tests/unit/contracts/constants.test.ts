import { describe, expect, it } from 'vitest';
import {
  AVENUE, AVENUE_EVERY, BEATS_PER_LOOP, CELL, CELLS, SKY_LANE_MAX_WEAVE, SKY_LANE_OFFSET, SKY_LANE_Y_X, SKY_LANE_Y_Z,
  STREET, TILE, isAvenue, roadSpec,
} from '../../../src/contracts/constants';
import { SC_COMMON } from '../../../src/contracts/glsl';
import { MOODS } from '../../../src/contracts/moods';
import { PALETTE, PALETTE_SIZE, hex } from '../../../src/contracts/palette';
import { QUALITY } from '../../../src/contracts/quality';

describe('world constants', () => {
  it('tile is a whole number of cells and the avenue pattern wraps', () => {
    expect(Number.isInteger(CELLS)).toBe(true);
    expect(CELLS * CELL).toBe(TILE);
    expect(CELLS % AVENUE_EVERY).toBe(0);
    expect(isAvenue(0)).toBe(true);
    expect(isAvenue(CELLS)).toBe(true);
    expect(isAvenue(-AVENUE_EVERY)).toBe(true);
    expect(isAvenue(1)).toBe(false);
    expect(roadSpec(4)).toBe(AVENUE);
    expect(roadSpec(5)).toBe(STREET);
  });

  it('a whole number of beats fits the loop', () => {
    expect(Number.isInteger(BEATS_PER_LOOP)).toBe(true);
  });

  it('lanes fit inside the carriageway and blocks have room', () => {
    for (const spec of [STREET, AVENUE]) {
      expect(spec.roadHalf + spec.sidewalk).toBe(spec.corridorHalf);
      for (const lane of spec.lanes) {
        expect(lane).toBeGreaterThanOrEqual(spec.median);
        expect(lane + 1.2).toBeLessThanOrEqual(spec.roadHalf);
      }
    }
    expect(CELL - 2 * AVENUE.corridorHalf).toBeGreaterThan(100);
  });

  it('sky lanes stay inside the avenue corridor and never share an altitude', () => {
    expect(SKY_LANE_OFFSET + SKY_LANE_MAX_WEAVE).toBeLessThan(AVENUE.corridorHalf);
    for (const y of SKY_LANE_Y_X) expect(SKY_LANE_Y_Z.every((z) => Math.abs(z - y) >= 30)).toBe(true);
  });
});

describe('GLSL chunk mirrors the TypeScript constants', () => {
  const define = (name: string): number => {
    const m = new RegExp('#define ' + name + ' ([0-9.]+)').exec(SC_COMMON);
    if (!m) throw new Error('no #define ' + name);
    return Number(m[1]);
  };
  it('every world define matches', () => {
    expect(define('SC_TILE')).toBe(TILE);
    expect(define('SC_CELL')).toBe(CELL);
    expect(define('SC_CELLS')).toBe(CELLS);
    expect(define('SC_AVENUE_EVERY')).toBe(AVENUE_EVERY);
    expect(define('SC_STREET_CORRIDOR')).toBe(STREET.corridorHalf);
    expect(define('SC_STREET_ROAD')).toBe(STREET.roadHalf);
    expect(define('SC_AVENUE_CORRIDOR')).toBe(AVENUE.corridorHalf);
    expect(define('SC_AVENUE_ROAD')).toBe(AVENUE.roadHalf);
    expect(define('SC_AVENUE_MEDIAN')).toBe(AVENUE.median);
  });
  it('declares the palette with the right size', () => {
    expect(SC_COMMON).toContain('uniform vec3 uPalette[' + PALETTE_SIZE + ']');
  });
});

describe('palette, moods and quality', () => {
  it('hex converts sRGB to linear', () => {
    expect(hex('#000000')).toEqual([0, 0, 0]);
    expect(hex('#ffffff')[0]).toBeCloseTo(1, 6);
    expect(hex('#808080')[0]).toBeCloseTo(0.2158, 3);
    expect(hex('#ffffff', 2)[1]).toBeCloseTo(2, 6);
  });
  it('has eight colours', () => {
    expect(PALETTE.length).toBe(PALETTE_SIZE);
  });
  it('moods have unit sun directions and sane fog', () => {
    for (const mood of Object.values(MOODS)) {
      expect(Math.hypot(...mood.sunDir)).toBeCloseTo(1, 6);
      expect(mood.sunDir[1]).toBeGreaterThan(0);
      expect(mood.fog[3]).toBeLessThanOrEqual(1);
    }
  });
  it('far fade ends before the wrap distance on every tier', () => {
    for (const q of Object.values(QUALITY)) {
      expect(q.fadeStart).toBeLessThan(q.fadeEnd);
      expect(q.fadeEnd).toBeLessThan(TILE / 2);
      expect(q.minRenderScale).toBeLessThanOrEqual(q.maxRenderScale);
    }
  });
});
