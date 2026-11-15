// Street life, the pure part (plan T06): which cars run in which lane, and where each one is at any
// loop phase. No three, no DOM. The shaders in ./shaders.ts mirror the arithmetic here exactly; the
// unit tests in tests/unit/streetlife check this model.
//
// A lane holds `count` cars at even spacing, each nudged by a per-car jitter that is always smaller
// than the gap, and all of them share one integer `laps`, so they keep their order for ever:
//
//   coordinate(i) = fract(dir * laps * loop + phase + (i + jitter(i)) / count) * TILE
//
// Because the cars of a lane are a pure function of (lane, index), nothing has to store them. The
// GPU draws only the cars near the camera: an instance is "the k-th car from the camera in lane row r
// of the j-th road from the camera", and the vertex shader works out which car that is this frame.
import type { Lane } from '../../contracts/city';
import { CELL, CELLS, TILE, roadSpec } from '../../contracts/constants';
import { clamp, wrap, wrapDelta } from '../../core/math';
import { hash32, hashInts, hashUnit } from '../../core/random';

/** Lane rows per road line in the lane table: axis * 6 + side * 3 + slot. */
export const ROWS_PER_AXIS = 6;
export const LANE_ROWS = ROWS_PER_AXIS * 2;
/** Smallest centre-to-centre distance between two cars in one lane, metres. A bus is 11.5 m long. */
export const MIN_GAP = 16;
/** Smallest even spacing a lane may be packed to, metres. */
export const MIN_SPACING = 28;
/** Largest jitter, as a fraction of the lane's spacing (the full range, centred on the even position). */
export const JITTER_MAX = 0.5;
/** Fraction of slots left empty, so the streams have gaps and clumps. */
export const SKIP_CHANCE = 0.12;
/** Vehicle mix: fraction of buses and vans (the rest are cars), and of taxis and emergency cars. */
export const BUS_CHANCE = 0.06;
export const VAN_CHANCE = 0.15;
export const EMERGENCY_CHANCE = 0.006;
export const TAXI_CHANCE = 0.06;

/** Real cars are drawn inside HANDOVER_END (3D distance, metres); between the two they cross-fade into far dashes. */
export const HANDOVER_START = 620;
export const HANDOVER_END = 880;

export interface LaneRecord {
  readonly axis: 0 | 1;
  /** Grid line, 0..CELLS-1. */
  readonly line: number;
  /** Row in the lane table, 0..LANE_ROWS-1. */
  readonly row: number;
  /** Signed distance of the lane from its road's centre line, metres. */
  readonly offset: number;
  readonly dir: 1 | -1;
  /** Whole laps of the tile per loop: the speed, in steps of TILE / LOOP_SECONDS. */
  readonly laps: number;
  /** Car slots in the lane (some are left empty). */
  readonly count: number;
  /** Phase of slot 0 at loop 0, as stored (float32). */
  readonly phase: number;
  /** TILE / count. */
  readonly spacing: number;
}

export interface LaneTable {
  readonly records: readonly LaneRecord[];
  /** CELLS x LANE_ROWS texels, RGBA float: offset, dir * laps, count, phase. A count of 0 means no lane. */
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
  /** Total car slots across all lanes. */
  readonly slots: number;
  readonly minSpacing: number;
  readonly maxSpacing: number;
}

/** Speed range per lane slot, in laps (1 lap = 1.5625 m/s): the inner lane is the fast one. */
const AVENUE_LAPS: readonly (readonly [number, number])[] = [[18, 21], [14, 17], [10, 13]];
const STREET_LAPS: readonly (readonly [number, number])[] = [[9, 11], [6, 8]];

/**
 * How full the lanes are for a quality tier's density multiplier. Only the cars near the camera cost
 * anything (the instance grid below), so the streets thin out more gently than the multiplier does:
 * 1 -> 1, 0.6 -> 0.77, 0.35 -> 0.59. The low tier still has busy streets.
 */
export function trafficDensity(qualityDensity: number): number {
  return Math.sqrt(clamp(qualityDensity, 0.05, 1));
}

/** `density` 1 packs lanes to 30 to 46 m per car; smaller values spread them out in proportion. */
export function buildLaneTable(lanes: readonly Lane[], density: number, seed: number): LaneTable {
  const data = new Float32Array(CELLS * LANE_ROWS * 4);
  const records: LaneRecord[] = [];
  const d = clamp(density, 0.05, 4);
  let slots = 0;
  let minSpacing = Infinity;
  let maxSpacing = 0;
  for (const lane of lanes) {
    if (lane.kind === 'sky') continue;
    const offset = wrapDelta(lane.fixed, lane.line * CELL, TILE);
    const side = offset > 0 ? 1 : 0;
    if (lane.slot < 0 || lane.slot > 2 || lane.line < 0 || lane.line >= CELLS) {
      throw new Error(`streetlife: lane out of range (line ${lane.line}, slot ${lane.slot})`);
    }
    const row = lane.axis * ROWS_PER_AXIS + side * 3 + lane.slot;
    const at = (row * CELLS + lane.line) * 4;
    if (data[at + 2]! > 0) throw new Error(`streetlife: two lanes share row ${row} of line ${lane.line}`);
    const avenue = lane.kind === 'avenue';
    const target = (avenue ? 30 + 10 * hashUnit(seed, lane.line, row, 1) : 33 + 13 * hashUnit(seed, lane.line, row, 1)) / d;
    const count = clamp(Math.round(TILE / target), 1, Math.floor(TILE / MIN_SPACING));
    const range = (avenue ? AVENUE_LAPS : STREET_LAPS)[lane.slot] ?? [8, 10];
    const laps = range[0] + (hashInts(seed, lane.line, row, 2) % (range[1] - range[0] + 1));
    const phase = Math.fround(hashUnit(seed, lane.line, row, 3));
    const spacing = TILE / count;
    data[at] = offset;
    data[at + 1] = lane.dir * laps;
    data[at + 2] = count;
    data[at + 3] = phase;
    records.push({ axis: lane.axis, line: lane.line, row, offset, dir: lane.dir, laps, count, phase, spacing });
    slots += count;
    minSpacing = Math.min(minSpacing, spacing);
    maxSpacing = Math.max(maxSpacing, spacing);
  }
  if (records.length === 0) {
    minSpacing = TILE;
    maxSpacing = TILE;
  }
  return { records, data, width: CELLS, height: LANE_ROWS, slots, minSpacing, maxSpacing };
}

// ---- the GLSL hashes, bit for bit (SC_COMMON: sc_bits, sc_hashu, sc_unit, sc_hash33)

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
function floatBits(v: number): number {
  F32[0] = v === 0 ? 0 : v;
  return U32[0]!;
}
function unit(h: number): number {
  return (h >>> 8) / 16777216;
}
/** sc_hash33 of three exactly representable floats. */
export function glslHash33(x: number, y: number, z: number): [number, number, number] {
  const h = hash32(floatBits(x) ^ hash32(floatBits(y) ^ hash32(floatBits(z))));
  const h2 = hash32(h);
  return [unit(h), unit(h2), unit(hash32(h2))];
}

// ---- the car model

export function fract(v: number): number {
  return v - Math.floor(v);
}

/** Full jitter range of a lane, as a fraction of its spacing: never so large that two cars come within MIN_GAP. */
export function jitterRange(spacing: number): number {
  return clamp(1 - MIN_GAP / spacing, 0, JITTER_MAX);
}

/** The number the shaders hash for a lane: exact in a float. */
export function laneId(rec: LaneRecord): number {
  return rec.line + rec.row * 64;
}

/** The first hash triple of a car: x jitter, y presence, z tint. */
export function carRandom(rec: LaneRecord, index: number): [number, number, number] {
  return glslHash33(laneId(rec), index, 1);
}

export function carPresent(rec: LaneRecord, index: number): boolean {
  return carRandom(rec, index)[1] >= SKIP_CHANCE;
}

/**
 * Tile coordinate of car `index` along its lane at loop phase `loop` (0..1).
 * `jitter` is the car's random number in 0..1; pass it to test other values than the hashed one.
 */
export function carCoordinate(rec: LaneRecord, index: number, loop: number, jitter = carRandom(rec, index)[0]): number {
  const base = fract(rec.dir * rec.laps * loop + rec.phase);
  return wrap((base + (index + (jitter - 0.5) * jitterRange(rec.spacing)) / rec.count) * TILE, TILE);
}

// ---- the instance grid for near cars

export interface CarField {
  /** 4 floats per instance: axis, road offset j, lane row within the axis (0..5), car offset k. */
  readonly slots: Float32Array;
  readonly count: number;
  /** Roads either side of the nearest one. */
  readonly lines: number;
  /** Cars either side of the nearest one. */
  readonly reach: number;
}

/** Enough (road, lane, car) slots to cover every car within `radius` metres of the camera. */
export function buildCarField(table: LaneTable, radius: number): CarField {
  const lines = Math.ceil(radius / CELL + 0.5);
  const reach = Math.ceil(radius / table.minSpacing) + 1;
  const count = 2 * (2 * lines + 1) * ROWS_PER_AXIS * (2 * reach + 1);
  const cells: { j: number; k: number; d: number }[] = [];
  for (let j = -lines; j <= lines; j++) {
    for (let k = -reach; k <= reach; k++) cells.push({ j, k, d: Math.hypot(j * CELL, k * table.minSpacing) });
  }
  // Nearest first, so the depth buffer rejects most of what is hidden.
  cells.sort((a, b) => a.d - b.d || a.j - b.j || a.k - b.k);
  const slots = new Float32Array(count * 4);
  let o = 0;
  for (const cell of cells) {
    for (let axis = 0; axis < 2; axis++) {
      for (let sub = 0; sub < ROWS_PER_AXIS; sub++) {
        slots[o++] = axis;
        slots[o++] = cell.j;
        slots[o++] = sub;
        slots[o++] = cell.k;
      }
    }
  }
  return { slots, count, lines, reach };
}

/** x mod y for whole numbers, as sl_imod in GLSL. */
export function imod(x: number, y: number): number {
  return x - y * Math.floor((x + 0.5) / y);
}

export interface PlacedCar {
  readonly rec: LaneRecord;
  /** Car index within its lane, 0..count-1. */
  readonly index: number;
  /** Offsets from the camera, metres: along the lane and across it. */
  readonly along: number;
  readonly across: number;
}

/** Which car an instance slot draws for a camera at (camX, camZ), as the vertex shader computes it. */
export function slotCar(
  table: LaneTable, camX: number, camZ: number, loop: number, axis: number, j: number, sub: number, k: number,
): PlacedCar | null {
  const camAlong = axis === 0 ? camX : camZ;
  const camAcross = axis === 0 ? camZ : camX;
  const lineF = Math.floor(camAcross / CELL + 0.5) + j;
  const line = imod(lineF, CELLS);
  const row = axis * ROWS_PER_AXIS + sub;
  const at = (row * CELLS + line) * 4;
  const count = table.data[at + 2]!;
  if (count < 0.5) return null;
  const rec = table.records.find((r) => r.line === line && r.row === row);
  if (!rec) return null;
  const base = fract(rec.dir * rec.laps * loop + rec.phase);
  const q = (camAlong / TILE - base) * count;
  const idxF = Math.floor(q + 0.5) + k;
  const index = imod(idxF, count);
  const jitter = carRandom(rec, index)[0];
  const along = (idxF - q + (jitter - 0.5) * jitterRange(rec.spacing)) * rec.spacing;
  const across = lineF * CELL + rec.offset - camAcross;
  return { rec, index, along, across };
}

// ---- crowds

/** People are drawn inside CROWD_END metres and shrink away from CROWD_START. */
export const CROWD_START = 240;
export const CROWD_END = 330;
/** Roads either side of the nearest one, and blocks before and after the nearest cross street. */
export const CROWD_LINES = 2;
export const CROWD_BLOCKS_BEFORE = 3;
export const CROWD_BLOCKS_AFTER = 2;
/** People on one side of one block of sidewalk in the busiest districts, at full density. */
export const CROWD_PER_FACE = 64;
/** Clear distance kept from the curb and from the building line, metres. */
export const CROWD_MARGIN = 0.8;
/** Clear distance kept from a cross street's curb at the ends of a block face, metres. */
export const CROWD_END_MARGIN = 1;
/** Share of the full crowd per district id (lowrise, midtown, downtown, plaza, mega). */
export const CROWD_BY_DISTRICT: readonly number[] = [1, 0.7, 0.55, 1, 0.4];
export const STANDING_CHANCE = 0.16;

/** 4 floats per instance: axis * 2 + side, road offset, block offset, index within the block face. */
export function buildCrowdField(perFace: number): Float32Array {
  const n = Math.max(0, Math.round(perFace));
  const out = new Float32Array(2 * (2 * CROWD_LINES + 1) * 2 * (CROWD_BLOCKS_BEFORE + CROWD_BLOCKS_AFTER + 1) * n * 4);
  let o = 0;
  for (let axis = 0; axis < 2; axis++) {
    for (let j = -CROWD_LINES; j <= CROWD_LINES; j++) {
      for (let side = 0; side < 2; side++) {
        for (let b = -CROWD_BLOCKS_BEFORE; b <= CROWD_BLOCKS_AFTER; b++) {
          for (let p = 0; p < n; p++) {
            out[o++] = axis * 2 + side;
            out[o++] = j;
            out[o++] = b;
            out[o++] = p;
          }
        }
      }
    }
  }
  return out;
}

export interface Walker {
  /** Tile coordinates (not wrapped into the tile). */
  readonly x: number;
  readonly z: number;
  /** Offsets from the camera along and across the road. */
  readonly along: number;
  readonly across: number;
  readonly standing: boolean;
  /** Trips along the block face and back per loop; 0 when standing. */
  readonly laps: number;
}

/** Where one crowd instance stands for a camera at (camX, camZ), as the vertex shader computes it. */
export function walkerAt(camX: number, camZ: number, loop: number, axisSide: number, j: number, b: number, p: number): Walker {
  const axis = axisSide >= 2 ? 1 : 0;
  const side = axisSide - 2 * axis;
  const camAlong = axis === 0 ? camX : camZ;
  const camAcross = axis === 0 ? camZ : camX;
  const lineF = Math.floor(camAcross / CELL + 0.5) + j;
  const blockF = Math.floor(camAlong / CELL + 0.5) + b;
  const line = imod(lineF, CELLS);
  const block = imod(blockF, CELLS);
  const next = imod(blockF + 1, CELLS);
  const road = roadSpec(line);
  const lo = blockF * CELL + roadSpec(block).roadHalf + CROWD_END_MARGIN;
  const hi = (blockF + 1) * CELL - roadSpec(next).roadHalf - CROWD_END_MARGIN;
  const id = line + axisSide * 64;
  const r1 = glslHash33(id, block, p);
  const r2 = glslHash33(id, block, p + 256);
  const standing = r2[0] < STANDING_CHANCE;
  const laps = standing ? 0 : Math.floor(12 + 11.99 * r1[1]);
  const u = fract(laps * loop + r1[2]);
  const tri = Math.abs(2 * u - 1);
  const along = lo + (hi - lo) * tri;
  const inner = road.roadHalf + CROWD_MARGIN;
  const outer = road.corridorHalf - CROWD_MARGIN;
  const lateral = inner + (outer - inner) * r1[0];
  const across = lineF * CELL + (side * 2 - 1) * lateral;
  return {
    x: axis === 0 ? along : across,
    z: axis === 0 ? across : along,
    along: along - camAlong,
    across: across - camAcross,
    standing,
    laps,
  };
}
