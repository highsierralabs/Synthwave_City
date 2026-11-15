import { describe, expect, it } from 'vitest';
import { createCityPlan } from '../../../src/city/index';
import type { Site } from '../../../src/contracts/city';
import { LOOP_SECONDS } from '../../../src/contracts/constants';
import { atlasLayout, cellRect, cellsOfKind } from '../../../src/layers/holograms/layout';
import {
  contentFit, keepSite, packPanels, packTickers, partnerColor, pickObjects,
} from '../../../src/layers/holograms/pack';

const plan = createCityPlan(1984);
const cells = atlasLayout();
const ofKind = (kind: Site['kind']): Site[] => plan.sites.filter((s) => s.kind === kind);

describe('panel packing', () => {
  const sites = ofKind('holoPanel');
  const panels = packPanels(plan.sites, cells, 1);

  it('makes one instance per holoPanel site at full density, in plan order', () => {
    expect(sites.length).toBeGreaterThan(100);
    expect(panels.count).toBe(sites.length);
    expect(panels.pos.length).toBe(sites.length * 3);
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i]!;
      expect(panels.pos[i * 3]).toBeCloseTo(s.x, 2);
      expect(panels.pos[i * 3 + 1]).toBeCloseTo(s.y, 2);
      expect(panels.pos[i * 3 + 2]).toBeCloseTo(s.z, 2);
      expect(panels.size[i * 4]).toBeCloseTo(s.w, 3);
      expect(panels.size[i * 4 + 1]).toBeCloseTo(s.h, 3);
      expect(panels.size[i * 4 + 2]).toBeCloseTo(s.yaw, 5);
    }
  });

  it('gives every panel two different ads of its own shape', () => {
    const wide = cellsOfKind(cells, 'wide'), tall = cellsOfKind(cells, 'tall');
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i]!;
      const group = s.w < s.h ? tall : wide;
      const a = panels.cellA[i]!, b = panels.cellB[i]!;
      expect(a).not.toBe(b);
      expect(a).toBeLessThan(group.length);
      expect(b).toBeLessThan(group.length);
      const rect = cellRect(group[a]!);
      for (let k = 0; k < 4; k++) expect(panels.rectA[i * 4 + k]).toBeCloseTo(rect[k]!, 6);
      const rectB = cellRect(group[b]!);
      for (let k = 0; k < 4; k++) expect(panels.rectB[i * 4 + k]).toBeCloseTo(rectB[k]!, 6);
    }
  });

  it('puts every ad on show somewhere', () => {
    const seenWide = new Set<number>(), seenTall = new Set<number>();
    for (let i = 0; i < sites.length; i++) (sites[i]!.w < sites[i]!.h ? seenTall : seenWide).add(panels.cellA[i]!);
    expect(seenWide.size).toBe(cellsOfKind(cells, 'wide').length);
    expect(seenTall.size).toBe(cellsOfKind(cells, 'tall').length);
  });

  it('uses palette indices, whole wipe cycles and a fit that never crops', () => {
    for (let i = 0; i < panels.count; i++) {
      const [a, b, laps, style] = panels.look.subarray(i * 4, i * 4 + 4);
      expect(a).toBe(sites[i]!.color);
      expect(Number.isInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(7);
      expect(b).not.toBe(a);
      expect(Number.isInteger(laps)).toBe(true);
      if (laps! > 0) {
        const cycle = LOOP_SECONDS / laps!;
        expect(cycle).toBeGreaterThanOrEqual(19.5);
        expect(cycle).toBeLessThanOrEqual(40.5);
      }
      expect([0, 1, 2, 3]).toContain(style);
      expect(panels.fit[i * 2]).toBeGreaterThanOrEqual(1);
      expect(panels.fit[i * 2 + 1]).toBeGreaterThanOrEqual(1);
    }
    const switching = Array.from({ length: panels.count }, (_, i) => panels.look[i * 4 + 2]!).filter((l) => l > 0).length;
    expect(switching / panels.count).toBeGreaterThan(0.4);
    expect(switching / panels.count).toBeLessThan(0.7);
  });

  it('thins with density but keeps the landmark panels', () => {
    const low = packPanels(plan.sites, cells, 0.35);
    const medium = packPanels(plan.sites, cells, 0.6);
    expect(low.count).toBeLessThan(medium.count);
    expect(medium.count).toBeLessThan(panels.count);
    expect(low.count / panels.count).toBeGreaterThan(0.25);
    expect(low.count / panels.count).toBeLessThan(0.5);
    const landmarks = sites.filter((s) => s.w >= 80).length;
    expect(landmarks).toBeGreaterThan(0);
    let kept = 0;
    for (let i = 0; i < low.count; i++) if (low.size[i * 4]! >= 80) kept++;
    expect(kept).toBe(landmarks);
  });

  it('is deterministic', () => {
    const again = packPanels(plan.sites, cells, 1);
    expect(again.look).toEqual(panels.look);
    expect(again.rectA).toEqual(panels.rectA);
    expect(again.rectB).toEqual(panels.rectB);
  });
});

describe('ticker packing', () => {
  const sites = ofKind('ticker');
  const tickers = packTickers(plan.sites, cells, 1);

  it('makes one instance per ticker site', () => {
    expect(sites.length).toBeGreaterThan(0);
    expect(tickers.count).toBe(sites.length);
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i]!;
      expect(tickers.pos[i * 3]).toBeCloseTo(s.x, 2);
      expect(tickers.ext[i * 4]).toBeCloseTo(s.w, 3);
      expect(tickers.ext[i * 4 + 1]).toBeCloseTo(s.d, 3);
      expect(tickers.ext[i * 4 + 2]).toBeCloseTo(s.h, 3);
    }
  });

  it('wraps the text a whole number of times and scrolls whole laps per loop', () => {
    for (let i = 0; i < tickers.count; i++) {
      const s = sites[i]!;
      const repeats = tickers.look[i * 4 + 2]!, laps = tickers.look[i * 4 + 3]!;
      expect(Number.isInteger(repeats)).toBe(true);
      expect(repeats).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(laps)).toBe(true);
      expect(laps).toBeGreaterThanOrEqual(1);
      const speed = (laps * 4 * (s.w + s.d)) / LOOP_SECONDS;
      expect(speed).toBeGreaterThan(8);
      expect(speed).toBeLessThan(14);
      // The strip is stretched by less than a factor of two either way.
      const stretch = (4 * (s.w + s.d)) / repeats / (s.h * 16);
      expect(stretch).toBeGreaterThan(0.5);
      expect(stretch).toBeLessThan(2);
      // Full width, so RepeatWrapping carries the text round.
      expect(tickers.rect[i * 4]).toBe(0);
      expect(tickers.rect[i * 4 + 2]).toBe(1);
    }
  });
});

describe('object picking and helpers', () => {
  it('keeps every holoObject at full density and thins below it', () => {
    const all = ofKind('holoObject');
    expect(pickObjects(plan.sites, 1)).toEqual(all);
    const low = pickObjects(plan.sites, 0.35);
    expect(low.length).toBeLessThan(all.length);
    expect(low.length).toBeGreaterThan(0);
    for (const s of low) expect(all).toContain(s);
  });

  it('keeps everything at density 1 and nothing optional at density 0', () => {
    const small: Site = { kind: 'holoPanel', x: 0, y: 0, z: 0, w: 30, h: 15, d: 0, yaw: 0, color: 1, seed: 0.5 };
    const big: Site = { ...small, w: 100 };
    for (let i = 0; i < 50; i++) {
      expect(keepSite(i, small, 1)).toBe(true);
      expect(keepSite(i, small, 0)).toBe(false);
      expect(keepSite(i, big, 0)).toBe(true);
    }
  });

  it('pairs each palette colour with a different one', () => {
    for (let c = 0; c < 8; c++) {
      for (let pick = 0; pick < 3; pick++) {
        const p = partnerColor(c, pick);
        expect(p).not.toBe(c);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(7);
      }
    }
  });

  it('fits an ad inside its panel without cropping, stretching at most 12%', () => {
    for (const panel of [0.39, 0.5, 0.64, 1.67, 2, 2.27, 2.9]) {
      const cell = panel < 1 ? 0.5 : 2;
      const [sx, sy] = contentFit(panel, cell);
      expect(sx).toBeGreaterThanOrEqual(1);
      expect(sy).toBeGreaterThanOrEqual(1);
      // Aspect of the ad as drawn, relative to its own: between 1/1.12 and 1.12.
      const drawn = (panel / sx) / (1 / sy) / cell;
      expect(drawn).toBeGreaterThan(1 / 1.1201);
      expect(drawn).toBeLessThan(1.1201);
    }
  });
});
