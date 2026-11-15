// Air traffic, the pure part (plan T07): which craft fly in which sky lane, where the hero ships
// go, and a TypeScript mirror of the motion the vertex shaders compute. No three, no DOM.
//
// Everything a craft does is a closed-form function of the loop phase (architecture.md 4.3):
//   along the lane   coord    = fract(dir * laps * loop + phase) * TILE          laps an integer
//   sideways         lateral  = weaveAmp * sin(TAU * (weaveCycles * loop + seed))     cycles an integer
//   up and down      vertical = bobAmp   * sin(TAU * (bobCycles  * loop + seed * 7))
// so the end of the loop is seamless, and craft in one lane share laps and never catch each other.
import { CELL_FIELD, CELL_HEIGHT_UNIT, CELL_STRIDE, type Landmark, type Lane } from '../../contracts/city';
import {
  AVENUE, CELL, CELLS, LOOP_SECONDS, SKY_LANE_MAX_WEAVE, SKY_LANE_OFFSET, SKY_LANE_Y_X, SKY_LANE_Y_Z, TILE, isAvenue,
} from '../../contracts/constants';
import { NEON } from '../../contracts/palette';
import { wrapDelta } from '../../core/math';
import { hashUnit } from '../../core/random';

const TAU = Math.PI * 2;
/** Metres per second of one lap per loop. */
export const LAP_SPEED = TILE / LOOP_SECONDS;

// ---------------------------------------------------------------------------------------------
// Small craft
// ---------------------------------------------------------------------------------------------

export const SHAPE = { car: 0, hauler: 1, drone: 2 } as const;
export const SHAPE_COUNT = 3;

/**
 * What the packer assumes about each hull (metres, at scale 1; shapes.ts is tested against it):
 * half-width, half-height and half-length of the hull, the largest scale it is drawn at, and how far
 * a craft of this shape may sit off its lane sideways and vertically (constant offset plus sway).
 */
export interface ShapeLimits {
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly halfLength: number;
  readonly minScale: number;
  readonly maxScale: number;
  /** Largest |constant sideways offset| + weave amplitude. */
  readonly lateral: number;
  /** Largest |constant vertical offset| + bob amplitude. */
  readonly vertical: number;
}
export const SHAPE_LIMITS: readonly ShapeLimits[] = [
  { halfWidth: 1.75, halfHeight: 1.3, halfLength: 4.1, minScale: 0.9, maxScale: 1.15, lateral: SKY_LANE_MAX_WEAVE, vertical: 6.5 },
  { halfWidth: 3.6, halfHeight: 2.3, halfLength: 9.4, minScale: 0.9, maxScale: 1.1, lateral: 4.5, vertical: 5 },
  { halfWidth: 1.7, halfHeight: 0.7, halfLength: 1.7, minScale: 0.8, maxScale: 1.2, lateral: SKY_LANE_MAX_WEAVE, vertical: 6.5 },
];

/** A lane is a tube: no part of any craft leaves this box around the lane's line. */
export const LANE_TUBE_HALF_HEIGHT = 10;
export const LANE_TUBE_HALF_WIDTH = AVENUE.corridorHalf - SKY_LANE_OFFSET;

/** Phase jitter as a fraction of the spacing in a lane; the gap between neighbours is at least 1 - 2 * this. */
export const PHASE_JITTER = 0.3;

/** Floats per craft, and their offsets. Four vec4 instance attributes: aLane, aMove, aBob, aLook. */
export const CRAFT_STRIDE = 16;
export const CRAFT = {
  /** aLane: the lane's fixed coordinate plus this craft's constant sideways offset. */
  fixed: 0,
  /** Lane altitude plus this craft's constant vertical offset. */
  y: 1,
  /** 0: travels along x. 1: along z. */
  axis: 2,
  /** +1 or -1. */
  dir: 3,
  /** aMove: whole laps of the tile per loop. */
  laps: 4,
  phase: 5,
  weaveAmp: 6,
  /** Whole weave cycles per loop. */
  weaveCycles: 7,
  /** aBob */
  bobAmp: 8,
  bobCycles: 9,
  /** Trail length, metres. */
  trail: 10,
  scale: 11,
  /** aLook: 0..1, a multiple of 1/4096 so it is exact in float32. */
  seed: 12,
  shape: 13,
  /** Palette index of the engines and the trail. */
  engineColor: 14,
  /** Palette index of the hull accents. */
  accentColor: 15,
} as const;

export interface CraftPack {
  readonly count: number;
  /** count * CRAFT_STRIDE floats, sorted by shape. */
  readonly data: Float32Array;
  /** First craft of each shape; shapeStart[SHAPE_COUNT] === count. */
  readonly shapeStart: readonly number[];
  /** Index into the sky-lane list for each craft (tests and debugging). */
  readonly laneOf: Uint16Array;
}

/** Engine colour each lane level leans towards, lowest level first: the streams read as layers. */
const LEVEL_COLOR: readonly number[] = [NEON.orange, NEON.magenta, NEON.cyan, NEON.violet];
const ANY_ENGINE: readonly number[] = [NEON.magenta, NEON.cyan, NEON.violet, NEON.orange, NEON.yellow, NEON.green];
const ANY_ACCENT: readonly number[] = [NEON.magenta, NEON.cyan, NEON.violet, NEON.yellow, NEON.green, NEON.white, NEON.cyan, NEON.magenta];

/** Speed of a lane in whole laps per loop: 25 to 70 m/s, higher lanes faster. */
export function lapsForLane(slot: number, h: number): number {
  const speed = 27 + 13 * slot + 5 * h;
  return Math.min(Math.floor(70 / LAP_SPEED), Math.max(Math.ceil(25 / LAP_SPEED), Math.round(speed / LAP_SPEED)));
}

/** Craft in a lane at a density (1 = full): spacing about 86 m low down to 158 m high up. */
export function craftInLane(slot: number, h: number, density: number): number {
  const spacing = 86 + 14 * slot + 30 * h;
  return Math.max(3, Math.round((TILE / spacing) * density));
}

export function skyLanes(lanes: readonly Lane[]): Lane[] {
  return lanes.filter((l) => l.kind === 'sky');
}

/** Fill every sky lane with craft. Deterministic in (lanes, density, seed). */
export function packCraft(lanes: readonly Lane[], density: number, seed: number): CraftPack {
  const sky = skyLanes(lanes);
  const rows: number[][] = [[], [], []];
  const laneRows: number[][] = [[], [], []];
  for (let li = 0; li < sky.length; li++) {
    const lane = sky[li]!;
    const laps = lapsForLane(lane.slot, hashUnit(seed, li, 1));
    const n = craftInLane(lane.slot, hashUnit(seed, li, 2), density);
    const speed = laps * LAP_SPEED;
    const levelColor = LEVEL_COLOR[lane.slot % LEVEL_COLOR.length]!;
    const lanePhase = hashUnit(seed, li, 3);
    for (let i = 0; i < n; i++) {
      const h = (k: number): number => hashUnit(seed, li, i, k);
      const pick = h(1);
      const haulers = 0.2 - 0.04 * lane.slot;
      const shape = pick < haulers ? SHAPE.hauler : pick < haulers + 0.2 ? SHAPE.drone : SHAPE.car;
      const lim = SHAPE_LIMITS[shape]!;
      const scale = lim.minScale + (lim.maxScale - lim.minScale) * h(2);
      // Sideways: a constant place in the tube plus a weave, together inside the shape's limit.
      const weaveAmp = lim.lateral * (0.25 + 0.3 * h(3));
      const side = (lim.lateral - weaveAmp) * (2 * h(4) - 1) * 0.95;
      const bobAmp = shape === SHAPE.hauler ? 0.4 + 0.5 * h(5) : 0.6 + 1.1 * h(5);
      const lift = (lim.vertical - bobAmp) * (2 * h(6) - 1) * 0.95;
      const phase = (lanePhase + (i + 0.5 + PHASE_JITTER * (2 * h(7) - 1)) / n) % 1;
      // Periods: weave 9 to 16 s, bob 5 to 9 s, as whole cycles per loop.
      const weaveCycles = Math.round(LOOP_SECONDS / (9 + 7 * h(8)));
      const bobCycles = Math.round(LOOP_SECONDS / (5 + 4 * h(9)));
      const trail = Math.min(120, Math.max(30, speed * (1.0 + 0.9 * h(10)) * (shape === SHAPE.drone ? 0.7 : 1)));
      const engineColor = h(11) < 0.68 ? levelColor : ANY_ENGINE[Math.floor(h(12) * ANY_ENGINE.length)]!;
      const accentColor = ANY_ACCENT[Math.floor(h(13) * ANY_ACCENT.length)]!;
      rows[shape]!.push(
        lane.fixed + side, lane.y + lift, lane.axis, lane.dir,
        laps, phase, weaveAmp, weaveCycles,
        bobAmp, bobCycles, trail, scale,
        Math.floor(h(14) * 4096) / 4096, shape, engineColor, accentColor,
      );
      laneRows[shape]!.push(li);
    }
  }
  const count = (rows[0]!.length + rows[1]!.length + rows[2]!.length) / CRAFT_STRIDE;
  const data = new Float32Array(count * CRAFT_STRIDE);
  const laneOf = new Uint16Array(count);
  const shapeStart: number[] = [];
  let at = 0;
  for (let s = 0; s < SHAPE_COUNT; s++) {
    shapeStart.push(at);
    data.set(rows[s]!, at * CRAFT_STRIDE);
    laneOf.set(laneRows[s]!, at);
    at += rows[s]!.length / CRAFT_STRIDE;
  }
  shapeStart.push(at);
  return { count, data, shapeStart, laneOf };
}

export interface CraftState {
  /** Tile coordinates of the craft's centre. x and z in [0, TILE) except for the sideways offset. */
  x: number;
  y: number;
  z: number;
  /** Position along the lane, [0, TILE). */
  along: number;
  /** Offset from the lane's fixed coordinate carried in the pack (weave only). */
  lateral: number;
}

function fract(v: number): number {
  return v - Math.floor(v);
}

/** The same motion the vertex shader computes, in double precision. */
export function craftState(data: Float32Array, index: number, loop: number, out: CraftState): CraftState {
  const o = index * CRAFT_STRIDE;
  const along = fract(data[o + CRAFT.dir]! * data[o + CRAFT.laps]! * loop + data[o + CRAFT.phase]!) * TILE;
  const seed = data[o + CRAFT.seed]!;
  const lateral = data[o + CRAFT.weaveAmp]! * Math.sin(TAU * (data[o + CRAFT.weaveCycles]! * loop + seed));
  const vertical = data[o + CRAFT.bobAmp]! * Math.sin(TAU * (data[o + CRAFT.bobCycles]! * loop + seed * 7));
  const cross = data[o + CRAFT.fixed]! + lateral;
  const alongZ = data[o + CRAFT.axis]! > 0.5;
  out.x = alongZ ? cross : along;
  out.z = alongZ ? along : cross;
  out.y = data[o + CRAFT.y]! + vertical;
  out.along = along;
  out.lateral = lateral;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Hero ships
// ---------------------------------------------------------------------------------------------

export const HERO = { freighter: 0, airship: 1, patrol: 2 } as const;
export const HERO_TYPES = 3;

/** Extents of each hero hull about its anchor, metres (shapes.ts is tested against it). */
export interface HeroLimits {
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly below: number;
  readonly above: number;
  /** Whole laps per loop (speed = laps * 1.5625 m/s). */
  readonly laps: number;
  /** Vertical drift amplitude, metres, and its whole cycles per loop. */
  readonly bobAmp: number;
  readonly bobCycles: number;
}
export const HERO_LIMITS: readonly HeroLimits[] = [
  { halfWidth: 27, halfLength: 102, below: 16, above: 42, laps: 6, bobAmp: 1.5, bobCycles: 128 },
  { halfWidth: 42, halfLength: 94, below: 32, above: 42, laps: 4, bobAmp: 3, bobCycles: 96 },
  { halfWidth: 13, halfLength: 32, below: 4.5, above: 8.5, laps: 10, bobAmp: 0.8, bobCycles: 256 },
];

/** Floats per hero ship: two vec4 instance attributes, aRoute and aRun. */
export const HERO_STRIDE = 8;
export const HERO_FIELD = { fixed: 0, y: 1, axis: 2, dir: 3, laps: 4, phase: 5, seed: 6, type: 7 } as const;

/** Altitudes at which a ship as wide as the avenue fits between the lane levels of both axes. */
export const PATROL_ALTITUDES: readonly number[] = [190, 235];
/** Lowest underside of a ship too wide for the avenue: clear of the highest sky lane. */
export const BIG_SHIP_FLOOR = Math.max(...SKY_LANE_Y_X, ...SKY_LANE_Y_Z) + LANE_TUBE_HALF_HEIGHT + 12;
/** Gap kept between a big ship's underside and the tallest roof beside its avenue. */
export const ROOF_CLEARANCE = 28;

export interface HeroPack {
  readonly count: number;
  readonly data: Float32Array;
}

interface LineInfo {
  axis: 0 | 1;
  line: number;
  /** Tallest cell on either side of the avenue, metres. */
  tallest: number;
  /** Sum of those heights: how much city the route passes. */
  score: number;
}

function cellHeight(cells: Uint8Array, cx: number, cz: number): number {
  const x = ((cx % CELLS) + CELLS) % CELLS;
  const z = ((cz % CELLS) + CELLS) % CELLS;
  return cells[(z * CELLS + x) * CELL_STRIDE + CELL_FIELD.height]! * CELL_HEIGHT_UNIT;
}

/** Every avenue line of both axes with the roof heights beside it. A lane along x has z fixed. */
export function avenueLines(cells: Uint8Array): LineInfo[] {
  const out: LineInfo[] = [];
  for (const axis of [0, 1] as const) {
    for (let line = 0; line < CELLS; line++) {
      if (!isAvenue(line)) continue;
      let tallest = 0;
      let score = 0;
      for (let i = 0; i < CELLS; i++) {
        const a = axis === 0 ? cellHeight(cells, i, line - 1) : cellHeight(cells, line - 1, i);
        const b = axis === 0 ? cellHeight(cells, i, line) : cellHeight(cells, line, i);
        const m = Math.max(a, b);
        tallest = Math.max(tallest, m);
        score += m;
      }
      out.push({ axis, line, tallest, score });
    }
  }
  return out;
}

function nearestLine(lines: readonly LineInfo[], axis: 0 | 1, coord: number): LineInfo {
  let best = lines[0]!;
  let bestD = Infinity;
  for (const l of lines) {
    if (l.axis !== axis) continue;
    const d = Math.abs(wrapDelta(l.line * CELL, coord, TILE));
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/**
 * Routes for the hero ships. The two wide types (freighter, airship) fly above an avenue, higher
 * than every roof beside it and than every sky lane, all along one axis so their routes never
 * cross; the busiest avenues without a megatower beside them come first. The patrol craft is
 * narrower than the avenue, so it flies inside the canyon between two lane levels, past the
 * downtown landmark and past the tallest megatower.
 */
export function planHeroes(cells: Uint8Array, landmarks: readonly Landmark[], seed: number): HeroPack {
  const lines = avenueLines(cells);
  const rows: number[] = [];
  const push = (type: number, info: LineInfo, y: number, dir: number, phase: number, k: number): void => {
    rows.push(info.line * CELL, y, info.axis, dir, HERO_LIMITS[type]!.laps, phase, Math.floor(hashUnit(seed, 77, k) * 4096) / 4096, type);
  };

  // Wide ships: pick the axis whose four best lines carry more city, lowest ceilings first.
  const ranked = (axis: 0 | 1): LineInfo[] => lines
    .filter((l) => l.axis === axis)
    .sort((a, b) => (a.tallest > 560 ? 1 : 0) - (b.tallest > 560 ? 1 : 0) || b.score - a.score || a.line - b.line);
  const value = (list: LineInfo[]): number => list.slice(0, 4).reduce((s, l) => s + (l.tallest > 560 ? -1e6 : l.score), 0);
  const rx = ranked(0);
  const rz = ranked(1);
  const wide = value(rz) >= value(rx) ? rz : rx;
  const wideTypes = [HERO.freighter, HERO.airship, HERO.freighter, HERO.airship];
  for (let k = 0; k < wideTypes.length; k++) {
    const type = wideTypes[k]!;
    const lim = HERO_LIMITS[type]!;
    const info = wide[k % wide.length]!;
    // Ships that have to share a line (fewer than four lines) differ in altitude band and phase.
    const lapOnLine = Math.floor(k / wide.length);
    const underside = Math.max(BIG_SHIP_FLOOR, info.tallest + ROOF_CLEARANCE) + lapOnLine * 110;
    const y = Math.ceil(underside + lim.below + lim.bobAmp);
    push(type, info, y, k % 2 === 0 ? 1 : -1, hashUnit(seed, 78, k), k);
  }

  // Patrol craft: inside the avenue canyon, on the axis the wide ships do not use where possible.
  const downtown = landmarks.find((l) => l.kind === 'downtown');
  const mega = landmarks.find((l) => l.kind === 'megatower');
  const wideAxis = wide[0]!.axis;
  const otherAxis: 0 | 1 = wideAxis === 0 ? 1 : 0;
  const coordOn = (l: Landmark | undefined, axis: 0 | 1): number => (l ? (axis === 0 ? l.z : l.x) : TILE / 2);
  const p0 = nearestLine(lines, otherAxis, coordOn(downtown, otherAxis));
  let p1 = nearestLine(lines, wideAxis, coordOn(mega, wideAxis) + CELL);
  if (p1 === p0) p1 = nearestLine(lines, wideAxis, coordOn(mega, wideAxis) + TILE / 2);
  push(HERO.patrol, p0, PATROL_ALTITUDES[0]!, 1, hashUnit(seed, 78, 10), 10);
  push(HERO.patrol, p1, PATROL_ALTITUDES[1]!, -1, hashUnit(seed, 78, 11), 11);

  return { count: rows.length / HERO_STRIDE, data: new Float32Array(rows) };
}

export interface HeroState {
  x: number;
  y: number;
  z: number;
  along: number;
}

/** The hero motion the vertex shader computes, in double precision. */
export function heroState(data: Float32Array, index: number, loop: number, out: HeroState): HeroState {
  const o = index * HERO_STRIDE;
  const lim = HERO_LIMITS[data[o + HERO_FIELD.type]!]!;
  const along = fract(data[o + HERO_FIELD.dir]! * data[o + HERO_FIELD.laps]! * loop + data[o + HERO_FIELD.phase]!) * TILE;
  const alongZ = data[o + HERO_FIELD.axis]! > 0.5;
  out.x = alongZ ? data[o + HERO_FIELD.fixed]! : along;
  out.z = alongZ ? along : data[o + HERO_FIELD.fixed]!;
  out.y = data[o + HERO_FIELD.y]! + lim.bobAmp * Math.sin(TAU * (lim.bobCycles * loop + data[o + HERO_FIELD.seed]!));
  out.along = along;
  return out;
}
