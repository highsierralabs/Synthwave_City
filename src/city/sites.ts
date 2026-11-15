// Sites (plan T01, M4): where holograms, searchlights, pillars, lasers, tickers and roof lights go.
// Every site with a volume is checked against the boxes and dropped if it touches one.
import { CELL_FIELD, CELL_HEIGHT_UNIT, CELL_STRIDE, DISTRICT, type Site, type SiteKind } from '../contracts/city';
import {
  CELL, CELLS, SKY_LANE_Y_X, SKY_LANE_Y_Z, TILE, isAvenue,
} from '../contracts/constants';
import { wrap } from '../core/math';
import type { Rng } from '../core/random';
import { cellIndex, type DistrictMap } from './districts';
import type { BuildingInfo } from './massing';
import { volumeBlocked, type BoxIndex } from './queries';

/** Panel heights over an avenue that stay clear of that avenue's own sky lanes. */
export function panelAltitudes(axis: 0 | 1): number[] {
  const own = axis === 0 ? SKY_LANE_Y_X : SKY_LANE_Y_Z;
  const out: number[] = [];
  for (const y of [55, ...SKY_LANE_Y_X, ...SKY_LANE_Y_Z, 470]) {
    if (own.every((lane) => Math.abs(lane - y) >= 38)) out.push(y);
  }
  return out;
}

export function buildSites(
  rng: Rng, map: DistrictMap, buildings: readonly BuildingInfo[], boxes: Float32Array, index: BoxIndex,
): Site[] {
  const sites: Site[] = [];
  const add = (
    kind: SiteKind, x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, color: number,
  ): void => {
    sites.push({ kind, x: wrap(x, TILE), y, z: wrap(z, TILE), w, h, d, yaw, color, seed: rng.next() });
  };
  /** A panel is a thin slab: wide along x when it faces +-z (yaw 0 or pi), along z otherwise. */
  const panelClear = (x: number, y: number, z: number, w: number, h: number, yaw: number): boolean => {
    const alongX = Math.abs(Math.sin(yaw)) < 0.5;
    return !volumeBlocked(boxes, index, x, y, z, alongX ? w / 2 + 1 : 2.5, h / 2 + 1, alongX ? 2.5 : w / 2 + 1);
  };
  const cellTop = (i: number): number => map.cells[i * CELL_STRIDE + CELL_FIELD.height]! * CELL_HEIGHT_UNIT;
  const cellPalette = (i: number): number => map.cells[i * CELL_STRIDE + CELL_FIELD.palette]!;

  // ---- buildings
  for (const b of buildings) {
    if (b.district === DISTRICT.plaza) continue;
    const mega = b.district === DISTRICT.mega;
    if (b.spireTop > 0) {
      add('roofLight', b.x, b.spireTop + 0.8, b.z, mega ? 3 : 1.6, 0, 0, 0, 6);
    } else if (b.top >= 140) {
      add('roofLight', b.x, b.top + 1.5, b.z, 1.2, 0, 0, 0, 6);
    }
    if (mega) {
      add('pillar', b.x, b.spireTop, b.z, rng.range(7, 10), 2600, 0, 0, b.colorA);
      for (let s = 1; s < b.segments.length; s += 2) {
        const seg = b.segments[s]!;
        add('ticker', b.x, seg.y0 + seg.h * 0.6, b.z, seg.sx / 2 + 2, rng.range(9, 14), seg.sz / 2 + 2, 0, s % 4 === 1 ? b.colorA : b.colorB);
      }
      continue;
    }
    const tall = b.district === DISTRICT.midtown || b.district === DISTRICT.downtown;
    if (tall && b.spireTop === 0 && b.top >= 60 && rng.chance(0.07)) {
      add('searchlight', b.x, b.top + 0.5, b.z, rng.range(700, 1400), rng.int(1, 3), 0, rng.range(0, Math.PI * 2), rng.chance(0.5) ? 7 : b.colorA);
    }
    if (b.district === DISTRICT.downtown && b.hasCrown && b.spireTop === 0 && rng.chance(0.1)) {
      add('laser', b.x, b.top + 1, b.z, rng.range(1400, 2400), rng.int(5, 9), 0, rng.range(0, Math.PI * 2), rng.chance(0.5) ? b.colorA : 5);
    }
    // A billboard floating over a low roof.
    const foot = Math.min(b.baseX, b.baseZ);
    if (b.top <= 130 && foot >= 24 && rng.chance(0.08)) {
      const w = Math.min(70, Math.max(24, foot * rng.range(0.9, 1.5)));
      const h = w * rng.range(0.4, 0.6);
      const y = b.top + 8 + h / 2 + rng.range(0, 20);
      const yaw = rng.int(0, 3) * (Math.PI / 2);
      if (panelClear(b.x, y, b.z, w, h, yaw)) add('holoPanel', b.x, y, b.z, w, h, 0, yaw, rng.chance(0.6) ? b.colorA : b.colorB);
    }
  }

  // ---- plazas
  for (const i of map.plazaCells) {
    const cx = i % CELLS, cz = Math.floor(i / CELLS);
    const x = (cx + 0.5) * CELL + 0, z = (cz + 0.5) * CELL;
    const color = cellPalette(i);
    if (rng.chance(0.75)) add('holoObject', x, rng.range(55, 110), z, rng.range(20, 38), 0, 0, 0, color);
    if (rng.chance(0.55)) add('pillar', x, 0, z, rng.range(3.5, 6), rng.range(1600, 2200), 0, 0, color);
    if (rng.chance(0.5)) {
      const n = rng.int(2, 4);
      const phase = rng.range(0, Math.PI * 2);
      for (let k = 0; k < n; k++) {
        const a = phase + (k / n) * Math.PI * 2;
        add('searchlight', x + Math.cos(a) * 18, 0.5, z + Math.sin(a) * 18, rng.range(900, 1500), 1, 0, a, 7);
      }
    }
  }

  // ---- banners across streets and billboards over avenues, mid-block
  for (const axis of [0, 1] as const) {
    for (let line = 0; line < CELLS; line++) {
      const avenue = isAvenue(line);
      const altitudes = avenue ? panelAltitudes(axis) : [];
      for (let c = 0; c < CELLS; c++) {
        if (!rng.chance(avenue ? 0.12 : 0.055)) continue;
        const along = (c + 0.5) * CELL, fixed = line * CELL;
        const x = axis === 0 ? along : fixed, z = axis === 0 ? fixed : along;
        // The panel faces along the road, so it spans the corridor.
        const yaw = (axis === 0 ? Math.PI / 2 : 0) + (rng.chance(0.5) ? Math.PI : 0);
        const w = avenue ? 34 : 18;
        const h = avenue ? 15 : rng.range(28, 46);
        const y = avenue ? rng.pick(altitudes) : rng.range(30 + h / 2, 260);
        const cell = axis === 0 ? cellIndex(c, line) : cellIndex(line, c);
        if (panelClear(x, y, z, w, h, yaw)) add('holoPanel', x, y, z, w, h, 0, yaw, rng.chance(0.5) ? cellPalette(cell) : rng.int(0, 4));
      }
    }
  }

  // ---- big panels beside megatowers
  for (const b of buildings) {
    if (b.district !== DISTRICT.mega) continue;
    const cx = b.cell % CELLS, cz = Math.floor(b.cell / CELLS);
    const options: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const start = rng.int(0, 3);
    for (let k = 0; k < 2; k++) {
      const [dx, dz] = options[(start + k * 2 + (k === 1 ? 1 : 0)) % 4]!;
      const n = cellIndex(cx + dx, cz + dz);
      const w = rng.range(90, 120), h = rng.range(40, 52);
      const x = (cx + dx + 0.5) * CELL, z = (cz + dz + 0.5) * CELL;
      const y = cellTop(n) + 45 + h / 2;
      const yaw = dx !== 0 ? Math.PI / 2 : 0;
      if (panelClear(x, y, z, w, h, yaw)) add('holoPanel', x, y, z, w, h, 0, yaw, k === 0 ? b.colorA : b.colorB);
    }
  }
  return sites;
}
