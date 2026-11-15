// Instance packing (plan T09): turns the plan's sites into the flat arrays the shaders read. Pure.
import type { Site } from '../../contracts/city';
import { LOOP_SECONDS } from '../../contracts/constants';
import { hashInts, hashUnit } from '../../core/random';
import { cellRect, cellsOfKind, type AtlasCell } from './layout';

/** A second ink for each palette index, chosen so the pair reads as a designed duotone. */
const PARTNERS: readonly (readonly number[])[] = [
  [1, 4, 2], // magenta: cyan, yellow, violet
  [0, 2, 3], // cyan: magenta, violet, orange
  [1, 3, 0], // violet: cyan, orange, magenta
  [0, 4, 1], // orange: magenta, yellow, cyan
  [0, 3, 1], // yellow: magenta, orange, cyan
  [2, 1, 4], // green: violet, cyan, yellow
  [4, 3, 1], // red: yellow, orange, cyan
  [1, 0, 2], // white: cyan, magenta, violet
];

export function partnerColor(color: number, pick: number): number {
  const options = PARTNERS[Math.min(7, Math.max(0, Math.round(color)))]!;
  return options[pick % options.length]!;
}

/** Panels this wide are landmarks and survive every density. */
const ALWAYS_KEEP_WIDTH = 80;
/** How far an ad may be stretched to fill its panel before it is letterboxed instead. */
const MAX_STRETCH = 1.12;
/** Share of the panel, on each axis, that the ad may fill; the rest is the frame's margin. */
const CONTENT_FILL = 0.93;

export interface PanelPack {
  readonly count: number;
  /** 3 per panel: centre x, y, z. */
  readonly pos: Float32Array;
  /** 4 per panel: width, height, yaw, seed. */
  readonly size: Float32Array;
  /** 4 per panel: ink A palette index, ink B palette index, wipe cycles per loop (0: never switches), wipe style 0..3. */
  readonly look: Float32Array;
  /** 2 per panel: scale from panel uv to ad uv about the centre, x and y (1 or more). */
  readonly fit: Float32Array;
  /** 4 per panel: atlas rectangle of the first ad. */
  readonly rectA: Float32Array;
  /** 4 per panel: atlas rectangle of the second ad. */
  readonly rectB: Float32Array;
  /** Index into the cells of the panel's class, first and second ad (for tests and debugging). */
  readonly cellA: Int32Array;
  readonly cellB: Int32Array;
}

/** Scale from panel uv to ad uv: the ad keeps its shape (within MAX_STRETCH) and is centred. */
export function contentFit(panelAspect: number, cellAspect: number): [number, number] {
  let fx = 1, fy = 1;
  if (panelAspect > cellAspect) fx = Math.min(1, (cellAspect / panelAspect) * MAX_STRETCH);
  else fy = Math.min(1, (panelAspect / cellAspect) * MAX_STRETCH);
  return [1 / (fx * CONTENT_FILL), 1 / (fy * CONTENT_FILL)];
}

export function keepSite(index: number, site: Site, density: number): boolean {
  if (density >= 1) return true;
  if (site.kind === 'holoPanel' && site.w >= ALWAYS_KEEP_WIDTH) return true;
  return hashUnit(index, 0x51a7) < density;
}

export function packPanels(sites: readonly Site[], cells: readonly AtlasCell[], density: number): PanelPack {
  const wide = cellsOfKind(cells, 'wide');
  const tall = cellsOfKind(cells, 'tall');
  const chosen: Site[] = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]!;
    if (s.kind === 'holoPanel' && keepSite(i, s, density)) chosen.push(s);
  }
  const n = chosen.length;
  const out = {
    count: n,
    pos: new Float32Array(n * 3),
    size: new Float32Array(n * 4),
    look: new Float32Array(n * 4),
    fit: new Float32Array(n * 2),
    rectA: new Float32Array(n * 4),
    rectB: new Float32Array(n * 4),
    cellA: new Int32Array(n),
    cellB: new Int32Array(n),
  };
  let wideTurn = 0, tallTurn = 0;
  for (let i = 0; i < n; i++) {
    const s = chosen[i]!;
    const isTall = s.w < s.h;
    const group = isTall ? tall : wide;
    // Round robin, so every ad is on show somewhere; the second ad is any other of the same shape.
    const a = (isTall ? tallTurn++ : wideTurn++) % group.length;
    const h = hashInts(i, Math.floor(s.seed * 65536));
    const b = (a + 1 + (h % (group.length - 1))) % group.length;
    const cellA = group[a]!, cellB = group[b]!;
    out.cellA[i] = a;
    out.cellB[i] = b;
    out.pos.set([s.x, s.y, s.z], i * 3);
    out.size.set([s.w, s.h, s.yaw, s.seed], i * 4);
    // 55% of panels switch ads; a full A-B-A cycle takes 20 to 40 s and divides the loop exactly.
    const switches = ((h >>> 8) % 100) < 55;
    const cycle = 20 + ((h >>> 16) % 2000) / 100;
    const laps = switches ? Math.round(LOOP_SECONDS / cycle) : 0;
    out.look.set([s.color, partnerColor(s.color, (h >>> 4) % 3), laps, (h >>> 12) % 4], i * 4);
    out.fit.set(contentFit(s.w / s.h, cellA.w / cellA.h), i * 2);
    out.rectA.set(cellRect(cellA), i * 4);
    out.rectB.set(cellRect(cellB), i * 4);
  }
  return out;
}

/** Scroll speed of ticker text, metres per second, before it is rounded to whole laps per loop. */
const TICKER_SPEED = 11;

export interface TickerPack {
  readonly count: number;
  /** 3 per ticker: centre x, y, z. */
  readonly pos: Float32Array;
  /** 4 per ticker: half-extent x, half-extent z, band height, seed. */
  readonly ext: Float32Array;
  /** 4 per ticker: ink A, ink B, strip repeats round the ring, laps per loop. */
  readonly look: Float32Array;
  /** 4 per ticker: atlas rectangle of its strip (full width; v pulled in). */
  readonly rect: Float32Array;
}

export function packTickers(sites: readonly Site[], cells: readonly AtlasCell[], density: number): TickerPack {
  const strips = cellsOfKind(cells, 'strip');
  const chosen: Site[] = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]!;
    // Tickers are few and mark the megatowers; only the lowest tier thins them.
    if (s.kind === 'ticker' && keepSite(i, s, Math.max(density, 0.6))) chosen.push(s);
  }
  const n = chosen.length;
  const out = {
    count: n, pos: new Float32Array(n * 3), ext: new Float32Array(n * 4), look: new Float32Array(n * 4), rect: new Float32Array(n * 4),
  };
  for (let i = 0; i < n; i++) {
    const s = chosen[i]!;
    const strip = strips[i % strips.length]!;
    const perimeter = 4 * (s.w + s.d);
    const stripLength = s.h * (strip.w / strip.h);
    const repeats = Math.max(1, Math.round(perimeter / stripLength));
    const laps = Math.max(1, Math.round((TICKER_SPEED * LOOP_SECONDS) / perimeter));
    const h = hashInts(i, Math.floor(s.seed * 65536));
    const rect = cellRect(strip, 2);
    out.pos.set([s.x, s.y, s.z], i * 3);
    out.ext.set([s.w, s.d, s.h, s.seed], i * 4);
    out.look.set([s.color, partnerColor(s.color, h % 3), repeats, laps], i * 4);
    out.rect.set([0, rect[1], 1, rect[3]], i * 4);
  }
  return out;
}

/** The holoObject sites that survive the density, in plan order. */
export function pickObjects(sites: readonly Site[], density: number): Site[] {
  const out: Site[] = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]!;
    if (s.kind === 'holoObject' && keepSite(i, s, Math.max(density, 0.5))) out.push(s);
  }
  return out;
}
