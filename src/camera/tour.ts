// The automatic tour (plan T11, M4): a drone that follows the road grid.
//
// The route is a polyline of straight segments along road centre lines, each flown at a constant
// speed with a linear change of altitude. The camera position is that polyline convolved, in time,
// with a triangle kernel of half-width SMOOTH seconds. That one operation rounds every corner,
// eases every change of speed and climb, and gives a path with continuous acceleration.
//
// Why it cannot hit anything: air above every road is free at every height (architecture.md
// section 4.4), and a smoothed corner cuts inside the two centre lines by speed * SMOOTH / 6 at
// most, so the speed through a corner is limited to keep that cut inside the corridors with
// CORNER_MARGIN to spare, more on an avenue (cornerLimit below).
//
// The pose is a pure function of (plan, start, time): segments are generated on demand into a
// fixed buffer, and asking for an earlier time regenerates from the start. Nothing here allocates
// after construction except a rewind, which makes one small generator object.
import { CELL_FIELD, CELL_STRIDE, type CityPlan } from '../contracts/city';
import { AVENUE, AVENUE_EVERY, CELL, CELLS, STREET, TILE, isAvenue } from '../contracts/constants';
import { angleDelta, clamp, smoothstep, wrapDelta } from '../core/math';
import { createRng, type Rng } from '../core/random';
import { wrapTile } from './tile';

/** Half-width of the smoothing kernel, seconds. A 90 degree turn takes 2 * SMOOTH. */
export const SMOOTH = 2.6;
/** The camera looks at where it will be this many seconds from now. */
export const LOOK_AHEAD = 1.4;
/** Half-width of the kernel that fades looks towards landmarks in and out, seconds. */
export const LOOK_SMOOTH = 3.5;
/** Distance kept from the building line through a corner, metres: on a street, and on an avenue. */
export const CORNER_MARGIN = 3.5;
export const CORNER_MARGIN_AVENUE = 6;
/** Lowest altitude the generator aims for, metres. */
export const TOUR_MIN_Y = 6;
/** Largest bank angle, radians. */
export const MAX_ROLL = 0.24;

const ROLL_ACCEL = 11;
const SUN_PITCH = 0.05;
const SECTION = SMOOTH * 1.06;
const SLOPE = 0.26;
const ORBIT_SLOPE = 0.45;
const RING_SLOPE = 0.3;
const PRE_ROLL = 20;
/** The view direction is averaged over this many seconds each side, which takes the edge off fast turns. */
const VIEW_SMOOTH = 1.5;
const VIEW_WEIGHTS: readonly number[] = [1 / 9, 2 / 9, 0, 2 / 9, 1 / 9];
const NEED_BACK = VIEW_SMOOTH + LOOK_SMOOTH + 0.1;
const KEEP_BACK = 8;
const KEEP_AHEAD = 7;

// Segment record layout.
const T0 = 0, DUR = 1, PX = 2, PY = 3, PZ = 4, VX = 5, VY = 6, VZ = 7, LK = 8, LX = 9, LZ = 10, LH = 11, LS = 12;
const STRIDE = 13;
const CAP = 256;

const LOOK_NONE = 0, LOOK_SUN = 1, LOOK_POINT = 2;

/** Heading index to direction: 0 is -z (towards the sun), 1 is -x, 2 is +z, 3 is +x. Yaw is heading * PI / 2. */
const DIR_X: readonly number[] = [0, -1, 0, 1];
const DIR_Z: readonly number[] = [-1, 0, 1, 0];

export const SCENE = { canyon: 0, skim: 1, high: 2, mega: 3 } as const;
export type Scene = (typeof SCENE)[keyof typeof SCENE];
const MEGA_ROUTE = 0, MEGA_ORBIT = 1;

export interface TourStart {
  /** A point on a road centre line, tile metres. It is snapped onto the line the heading runs along. */
  x: number;
  y: number;
  z: number;
  /** 0: -z, 1: -x, 2: +z, 3: +x. */
  heading: number;
}

export interface TourSample {
  /** Position, x and z wrapped into 0..TILE. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** Velocity, metres per second of tour time. */
  vx: number;
  vy: number;
  vz: number;
  speed: number;
}

export function createTourSample(): TourSample {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, speed: 0 };
}

/** Integral over u in [-SMOOTH, t] of the kernel times the distance past a corner: see cornerLimit. */
function cut(t: number): number {
  const d = SMOOTH;
  if (t <= -d) return 0;
  if (t >= d) return t;
  const near = (d - Math.abs(t)) ** 3 / (6 * d * d);
  return t <= 0 ? near : t + near;
}

/**
 * Fastest constant speed through a corner from a road with free half-width `freeIn` onto one with
 * `freeOut`. At time t relative to the corner the smoothed point is cut(t) * v off the incoming
 * centre line and cut(-t) * v off the outgoing one; it must be inside one corridor or the other.
 */
export function cornerLimit(freeIn: number, freeOut: number): number {
  let lo = 0, hi = 200;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    let ok = false;
    for (let k = -200; k <= 200 && !ok; k++) {
      const t = (k / 200) * SMOOTH;
      ok = v * cut(t) <= freeIn && v * cut(-t) <= freeOut;
    }
    if (ok) lo = v;
    else hi = v;
  }
  return lo;
}

const FREE_STREET = STREET.corridorHalf - CORNER_MARGIN;
const FREE_AVENUE = AVENUE.corridorHalf - CORNER_MARGIN_AVENUE;
const LIMIT_SS = cornerLimit(FREE_STREET, FREE_STREET) * 0.97;
const LIMIT_MIXED = cornerLimit(FREE_STREET, FREE_AVENUE) * 0.97;
const LIMIT_AA = cornerLimit(FREE_AVENUE, FREE_AVENUE) * 0.97;

/** Speed limits through corners, metres per second: street to street, mixed, avenue to avenue. */
export const CORNER_LIMITS: readonly number[] = [LIMIT_SS, LIMIT_MIXED, LIMIT_AA];

function wrapCells(d: number): number {
  return d - CELLS * Math.floor(d / CELLS + 0.5);
}

/** How strongly a look is applied when its target is `delta` radians off the direction of travel. */
function lookTaper(delta: number): number {
  return 1 - smoothstep(0.9, Math.PI, Math.abs(delta));
}

export class Tour {
  private readonly plan: CityPlan;
  private readonly seg = new Float64Array(CAP * STRIDE);
  private count = 0;
  private cursor = 0;
  private dropped = false;

  private readonly megaCount: number;
  private readonly megaX: Float64Array;
  private readonly megaZ: Float64Array;
  private readonly megaH: Float64Array;
  private readonly megaCellX: Int32Array;
  private readonly megaCellZ: Int32Array;

  // Start, kept for rewinds.
  private readonly start: TourStart = { x: 0, y: 0, z: 0, heading: 0 };
  private startSeed = 0;
  private canonical = true;

  // Generator state: where the pending leg starts, and the pending leg itself.
  private rng: Rng;
  private gx = 0;
  private gy = 0;
  private gz = 0;
  private gt = 0;
  private pH = 0;
  private pLen = 0;
  private pY1 = 0;
  private pV = 0;
  private pCorner = 0;
  private pLook = LOOK_NONE;
  private pLookX = 0;
  private pLookZ = 0;
  private pLookH = 0;
  private pLookS = 0;
  // The leg after it, filled by decide().
  private nTurn = 0;
  private nLen = 0;
  private nY1 = 0;
  private nV = 0;
  private nLook = LOOK_NONE;
  private nLookX = 0;
  private nLookZ = 0;
  private nLookH = 0;
  private nLookS = 0;
  // Scene program.
  private scene: Scene = SCENE.canyon;
  private legsLeft = 0;
  private legsMax = 0;
  private sceneY = 0;
  private megaIndex = -1;
  private megaPhase = MEGA_ROUTE;
  private megaDone = false;
  private orbitLeft = 0;
  private orbitTop = 0;
  /** Blocks between the megatower and the road the orbit uses: 0 hugs its own block, 1 goes round the nine. */
  private ring = 0;
  private targetIx = 0;
  private targetIz = 0;
  private lastMega = -1;
  private olderMega = -1;
  private nearD = 0;

  // Scratch for the evaluator.
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private ovx = 0;
  private ovy = 0;
  private ovz = 0;
  /** Origin the evaluator measures x and z from: the start of the segment being flown. */
  private bx = 0;
  private bz = 0;
  private readonly tap = createTourSample();

  constructor(plan: CityPlan, seed: number) {
    this.plan = plan;
    const megas = plan.landmarks.filter((l) => l.kind === 'megatower');
    this.megaCount = megas.length;
    this.megaX = Float64Array.from(megas, (l) => l.x);
    this.megaZ = Float64Array.from(megas, (l) => l.z);
    this.megaH = Float64Array.from(megas, (l) => l.height);
    this.megaCellX = Int32Array.from(megas, (l) => l.cellX);
    this.megaCellZ = Int32Array.from(megas, (l) => l.cellZ);
    this.rng = createRng(seed);
    this.restart(null, seed);
  }

  /**
   * Begin a new tour. With null it starts from the plan's opening shot: an avenue beside the densest
   * downtown cell, flying towards the sun. Otherwise it starts at the given point on a road.
   */
  restart(start: TourStart | null, seed: number): void {
    if (start === null) {
      const downtown = this.plan.landmarks.find((l) => l.kind === 'downtown');
      const cellX = downtown ? downtown.cellX : CELLS / 2;
      const cellZ = downtown ? downtown.cellZ : CELLS / 2;
      this.canonical = true;
      // Two avenue crossings short of downtown, on the avenue that runs past it towards the sun.
      this.start.x = Math.round(cellX / AVENUE_EVERY) * AVENUE_EVERY * CELL;
      this.start.y = 150;
      this.start.z = Math.ceil((cellZ + 4) / AVENUE_EVERY) * AVENUE_EVERY * CELL;
      this.start.heading = 0;
    } else {
      this.canonical = false;
      this.start.x = start.x;
      this.start.y = start.y;
      this.start.z = start.z;
      this.start.heading = start.heading & 3;
    }
    this.startSeed = seed;
    this.rewind();
  }

  private rewind(): void {
    const s = this.start;
    this.rng = createRng(this.startSeed);
    this.count = 0;
    this.cursor = 0;
    this.dropped = false;
    this.megaIndex = -1;
    this.megaDone = false;
    this.lastMega = -1;
    this.olderMega = -1;

    const h = s.heading;
    const even = (h & 1) === 0;
    // Snap onto the line, then find the next intersection ahead.
    this.gx = even ? Math.round(s.x / CELL) * CELL : s.x;
    this.gz = even ? s.z : Math.round(s.z / CELL) * CELL;
    this.gy = s.y;
    this.gt = 0;
    this.pH = h;
    const c = even ? this.gz : this.gx;
    const forward = h >= 2;
    const node = forward ? Math.ceil(c / CELL - 1e-9) * CELL : Math.floor(c / CELL + 1e-9) * CELL;
    const toNode = Math.abs(node - c);
    this.pCorner = 0;
    this.pLook = LOOK_NONE;
    this.pLookS = 0;

    if (this.canonical) {
      this.scene = SCENE.canyon;
      this.sceneY = 125;
      this.legsLeft = 2;
      this.legsMax = 4;
      this.pLen = toNode + 2 * AVENUE_EVERY * CELL;
      this.pY1 = 115;
      this.pV = 38;
    } else {
      const lineAvenue = isAvenue(Math.round((even ? this.gx : this.gz) / CELL));
      if (s.y < 40) {
        this.scene = SCENE.skim;
        this.sceneY = Math.max(TOUR_MIN_Y, Math.min(s.y, 9));
        this.pV = 32;
      } else if (s.y < 330) {
        this.scene = SCENE.canyon;
        this.sceneY = clamp(s.y, 55, 185);
        this.pV = lineAvenue ? 36 : 29;
      } else {
        this.scene = SCENE.high;
        this.sceneY = clamp(s.y, 520, 680);
        this.pV = 46;
      }
      this.legsLeft = 2;
      this.legsMax = 6;
      this.pLen = toNode + CELL * this.rng.int(1, 3);
      this.pY1 = s.y + clamp(this.sceneY - s.y, -SLOPE * this.pLen, SLOPE * this.pLen);
    }

    // A run-in before time zero along the first leg's own line, so that the kernel has something to
    // average and the smoothed path passes exactly through the start.
    const o = this.count * STRIDE;
    const seg = this.seg;
    const climb = ((this.pY1 - this.gy) / this.pLen) * this.pV;
    seg[o + T0] = -PRE_ROLL;
    seg[o + DUR] = PRE_ROLL;
    seg[o + PX] = this.gx - DIR_X[h]! * this.pV * PRE_ROLL;
    seg[o + PY] = this.gy - climb * PRE_ROLL;
    seg[o + PZ] = this.gz - DIR_Z[h]! * this.pV * PRE_ROLL;
    seg[o + VX] = DIR_X[h]! * this.pV;
    seg[o + VY] = climb;
    seg[o + VZ] = DIR_Z[h]! * this.pV;
    seg[o + LK] = LOOK_NONE;
    seg[o + LX] = 0;
    seg[o + LZ] = 0;
    seg[o + LH] = 0;
    seg[o + LS] = 0;
    this.count = 1;
  }

  // ---- generator

  private cellHeight(cx: number, cz: number): number {
    const x = ((cx % CELLS) + CELLS) % CELLS, z = ((cz % CELLS) + CELLS) % CELLS;
    return this.plan.cells[(z * CELLS + x) * CELL_STRIDE + CELL_FIELD.height]!;
  }

  /** How tall the city is a few blocks ahead of a node in a direction: the tour drifts towards towers. */
  private interest(ix: number, iz: number, h: number): number {
    let sum = 0;
    for (let step = 3; step <= 6; step += 3) {
      const nx = ix + DIR_X[h]! * step, nz = iz + DIR_Z[h]! * step;
      sum += this.cellHeight(nx - 1, nz - 1) + this.cellHeight(nx, nz - 1) + this.cellHeight(nx - 1, nz) + this.cellHeight(nx, nz);
    }
    return sum / 8;
  }

  /** Cells from a node to the next avenue crossing along a heading, 1..AVENUE_EVERY. */
  private cellsToAvenue(ix: number, iz: number, h: number): number {
    const c = ((((h & 1) === 0 ? iz : ix) % AVENUE_EVERY) + AVENUE_EVERY) % AVENUE_EVERY;
    return h >= 2 ? AVENUE_EVERY - c : c === 0 ? AVENUE_EVERY : c;
  }

  /** Index of the megatower nearest a point, or -1; its distance is left in this.nearD. */
  private nearestMega(x: number, z: number): number {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.megaCount; i++) {
      const d = Math.hypot(wrapDelta(this.megaX[i]!, x, TILE), wrapDelta(this.megaZ[i]!, z, TILE));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.nearD = bestD;
    return best;
  }

  private lookAtMega(index: number, strength: number): void {
    this.nLook = LOOK_POINT;
    this.nLookX = this.megaX[index]!;
    this.nLookZ = this.megaZ[index]!;
    this.nLookH = this.megaH[index]!;
    this.nLookS = strength;
  }

  private pickScene(ix: number, iz: number, h: number, y: number): void {
    const rng = this.rng;
    const from = this.megaDone ? SCENE.mega : this.scene;
    this.megaDone = false;
    let wCanyon = from === SCENE.canyon ? 0 : 3.5;
    let wSkim = from === SCENE.skim ? 0 : 3;
    let wHigh = from === SCENE.high ? 0 : 1.5;
    const wMega = from === SCENE.mega || this.megaCount === 0 ? 0 : 2.5;
    if (from === SCENE.mega) {
      // Off the top of a tower: cruise for a while, or dive.
      wHigh = 2.5;
      wSkim = 3;
      wCanyon = 2.5;
    }
    const r = rng.next() * (wCanyon + wSkim + wHigh + wMega);
    if (r < wCanyon) {
      this.scene = SCENE.canyon;
      this.sceneY = rng.range(60, 180);
      this.legsLeft = rng.int(3, 5);
      this.legsMax = this.legsLeft;
    } else if (r < wCanyon + wSkim) {
      this.scene = SCENE.skim;
      this.sceneY = rng.range(TOUR_MIN_Y, 9);
      this.legsLeft = rng.int(2, 3);
      this.legsMax = this.legsLeft + 6;
    } else if (r < wCanyon + wSkim + wHigh) {
      this.scene = SCENE.high;
      this.sceneY = rng.range(520, 680);
      this.legsLeft = rng.int(2, 4);
      this.legsMax = this.legsLeft + 5;
    } else {
      this.scene = SCENE.mega;
      this.megaPhase = MEGA_ROUTE;
      this.sceneY = y > 350 ? y : rng.range(120, 220);
      this.legsLeft = 1;
      this.legsMax = 1;
      // Mostly a wide circle that shows the whole tower; sometimes a tight climb up its face.
      this.ring = rng.chance(0.7) ? 1 : 0;
      this.pickMega(ix, iz, h);
    }
  }

  /** Choose a megatower and the corner of its orbit to arrive at: near, ahead, and not the last two visited. */
  private pickMega(ix: number, iz: number, h: number): void {
    const left = (h + 1) & 3;
    let best = Infinity;
    for (let m = 0; m < this.megaCount; m++) {
      if ((m === this.lastMega && this.megaCount > 1) || (m === this.olderMega && this.megaCount > 2)) continue;
      for (let c = 0; c < 4; c++) {
        const side = 2 * this.ring + 1;
        const tx = this.megaCellX[m]! - this.ring + (c & 1) * side;
        const tz = this.megaCellZ[m]! - this.ring + (c >> 1) * side;
        const dx = wrapCells(tx - ix), dz = wrapCells(tz - iz);
        const ahead = dx * DIR_X[h]! + dz * DIR_Z[h]!;
        const across = dx * DIR_X[left]! + dz * DIR_Z[left]!;
        let cost = Math.abs(ahead) + Math.abs(across) + this.rng.next() * 1.5;
        if (ahead < 0) cost += 8;
        else if (ahead === 0) cost += 3;
        if (across !== 0) cost += 2;
        if (Math.abs(ahead) + Math.abs(across) < 3) cost += 20;
        if (cost < best) {
          best = cost;
          this.megaIndex = m;
          this.targetIx = tx;
          this.targetIz = tz;
        }
      }
    }
  }

  /** Decide the leg that follows the pending one. */
  private decide(): void {
    const h = this.pH;
    const ex = this.gx + DIR_X[h]! * this.pLen;
    const ez = this.gz + DIR_Z[h]! * this.pLen;
    const ey = this.pY1;
    const ix = Math.round(ex / CELL), iz = Math.round(ez / CELL);
    this.nLook = LOOK_NONE;
    this.nLookS = 0;
    if (this.scene !== SCENE.mega && (this.legsLeft <= 0 || this.legsMax <= 0)) this.pickScene(ix, iz, h, ey);
    if (this.scene === SCENE.mega) {
      this.decideMega(ix, iz, h, ex, ey, ez);
      return;
    }
    const rng = this.rng;
    const scene = this.scene;
    const even = (h & 1) === 0;
    const runAvenue = isAvenue(even ? ix : iz);
    const crossAvenue = isAvenue(even ? iz : ix);

    // Turn or carry straight on. Low and high runs want an avenue; the canyon wanders.
    let pTurn: number;
    if (scene === SCENE.canyon) pTurn = crossAvenue ? (runAvenue ? 0.65 : 0.8) : runAvenue ? 0.2 : 0.1;
    else if (!runAvenue) pTurn = crossAvenue ? 0.85 : 0.04;
    else pTurn = crossAvenue ? (scene === SCENE.skim ? 0.3 : 0.45) : 0.03;
    const wStraight = (1 - pTurn) * (30 + this.interest(ix, iz, h));
    const wLeft = 0.5 * pTurn * (30 + this.interest(ix, iz, (h + 1) & 3));
    const wRight = 0.5 * pTurn * (30 + this.interest(ix, iz, (h + 3) & 3));
    const r = rng.next() * (wStraight + wLeft + wRight);
    const turn = r < wStraight ? 0 : r < wStraight + wLeft ? 1 : -1;
    const h2 = (h + turn + 4) & 3;
    const avenue = turn === 0 ? runAvenue : crossAvenue;

    const k = this.cellsToAvenue(ix, iz, h2);
    let cells: number;
    if (scene === SCENE.canyon) cells = rng.chance(0.7) ? (k >= 2 ? k : k + AVENUE_EVERY) : rng.int(2, 4);
    else if (avenue) cells = k + (k < AVENUE_EVERY || rng.chance(0.5) ? AVENUE_EVERY : 0);
    else cells = k;
    const len = cells * CELL;

    const aim = scene === SCENE.canyon ? clamp(this.sceneY + rng.range(-25, 25), 45, 200) : this.sceneY;
    const y1 = ey + clamp(aim - ey, -SLOPE * len, SLOPE * len);
    if (scene === SCENE.canyon || Math.abs(ey - this.sceneY) < 25) this.legsLeft--;
    this.legsMax--;

    const mid = (ey + y1) / 2;
    let v: number;
    if (scene === SCENE.canyon) v = avenue ? rng.range(34, 40) : rng.range(27, 31);
    else if (scene === SCENE.skim) v = mid < 40 ? rng.range(30, 36) : rng.range(40, 46);
    else v = mid > 250 ? rng.range(50, 60) : rng.range(40, 46);

    // Now and then, look at something: the nearest megatower, or from high up the sun.
    const mx = ex + DIR_X[h2]! * len * 0.5, mz = ez + DIR_Z[h2]! * len * 0.5;
    const mega = this.nearestMega(mx, mz);
    const megaChance = scene === SCENE.canyon ? 0.45 : scene === SCENE.high ? 0.55 : 0.3;
    if (mega >= 0 && this.nearD < 1100 && rng.chance(megaChance)) {
      this.lookAtMega(mega, rng.range(0.45, 0.7));
    } else if (mid > 300 && (h2 & 1) === 1 && rng.chance(0.6)) {
      this.nLook = LOOK_SUN;
      this.nLookS = 0.6;
    }

    this.nTurn = turn;
    this.nLen = len;
    this.nY1 = y1;
    this.nV = v;
  }

  /** The megatower scene: fly to a corner of its orbit, then climb round it looking at the tower. */
  private decideMega(ix: number, iz: number, h: number, ex: number, ey: number, ez: number): void {
    const rng = this.rng;
    const m = this.megaIndex;
    const left = (h + 1) & 3;
    if (this.megaPhase === MEGA_ROUTE) {
      const dx = wrapCells(this.targetIx - ix), dz = wrapCells(this.targetIz - iz);
      const ahead = dx * DIR_X[h]! + dz * DIR_Z[h]!;
      const side = dx * DIR_X[left]! + dz * DIR_Z[left]!;
      if (ahead !== 0 || side !== 0) {
        let turn = 0, cells = 1;
        if (ahead > 0) cells = ahead;
        else if (side !== 0) {
          turn = side > 0 ? 1 : -1;
          cells = Math.abs(side);
        } else turn = rng.chance(0.5) ? 1 : -1;
        const h2 = (h + turn + 4) & 3;
        const len = cells * CELL;
        const avenue = isAvenue((h2 & 1) === 0 ? ix : iz);
        this.nTurn = turn;
        this.nLen = len;
        this.nY1 = ey + clamp(this.sceneY - ey, -SLOPE * len, SLOPE * len);
        this.nV = avenue ? rng.range(36, 42) : rng.range(28, 32);
        const mx = ex + DIR_X[h2]! * len * 0.5, mz = ez + DIR_Z[h2]! * len * 0.5;
        const d = Math.hypot(wrapDelta(this.megaX[m]!, mx, TILE), wrapDelta(this.megaZ[m]!, mz, TILE));
        if (d < 1300) this.lookAtMega(m, d < 500 ? 0.75 : 0.55);
        return;
      }
      this.megaPhase = MEGA_ORBIT;
      this.orbitLeft = this.ring > 0 ? rng.int(2, 4) : rng.int(3, 4);
      this.orbitTop = this.megaH[m]! * rng.range(0.42, 0.58);
      if (ey > this.orbitTop - 100) this.orbitTop = Math.min(this.megaH[m]! * 0.85, ey + 120);
    }
    if (this.orbitLeft <= 0) {
      // Leave along the line we are on, and let the next scene take over.
      const k = this.cellsToAvenue(ix, iz, h);
      const len = (k < 2 ? k + AVENUE_EVERY : k) * CELL;
      this.nTurn = 0;
      this.nLen = len;
      this.nY1 = ey + Math.min(30, 0.1 * len);
      this.nV = rng.range(38, 44);
      this.lastMegaVisited(m);
      this.scene = SCENE.canyon;
      this.megaDone = true;
      this.legsLeft = 0;
      return;
    }
    // The two sides of the orbit's square that leave this corner.
    const span = (2 * this.ring + 1) * CELL;
    const i = wrapCells(ix - this.megaCellX[m]! + this.ring), j = wrapCells(iz - this.megaCellZ[m]! + this.ring);
    const sideX = i === 0 ? 3 : 1;
    const sideZ = j === 0 ? 2 : 0;
    let h2: number;
    if (h === sideX || h === sideZ) h2 = h;
    else h2 = ((h + 2) & 3) === sideX ? sideZ : sideX;
    const d = (h2 - h + 4) & 3;
    this.nTurn = d === 0 ? 0 : d === 1 ? 1 : -1;
    const steep = (this.ring > 0 ? RING_SLOPE : ORBIT_SLOPE) * span;
    this.nLen = span;
    this.nY1 = ey + clamp((this.orbitTop - ey) / this.orbitLeft, -steep, steep);
    this.nV = this.ring > 0 ? rng.range(36, 42) : 32;
    this.lookAtMega(m, 0.9);
    this.orbitLeft--;
  }

  private lastMegaVisited(m: number): void {
    this.olderMega = this.lastMega;
    this.lastMega = m;
  }

  private push(len: number, v: number, at: number, slope: number): void {
    const o = this.count * STRIDE;
    const seg = this.seg;
    const h = this.pH;
    seg[o + T0] = this.gt;
    seg[o + DUR] = len / v;
    seg[o + PX] = this.gx + DIR_X[h]! * at;
    seg[o + PY] = this.gy + slope * at;
    seg[o + PZ] = this.gz + DIR_Z[h]! * at;
    seg[o + VX] = DIR_X[h]! * v;
    seg[o + VY] = slope * v;
    seg[o + VZ] = DIR_Z[h]! * v;
    seg[o + LK] = this.pLook;
    seg[o + LX] = this.pLookX;
    seg[o + LZ] = this.pLookZ;
    seg[o + LH] = this.pLookH;
    seg[o + LS] = this.pLookS;
    this.gt += len / v;
    this.count++;
  }

  /** Decide the next leg, write the pending one as one to three segments, and make the next one pending. */
  private step(): void {
    this.decide();
    const h = this.pH;
    let endCorner = 0;
    if (this.nTurn !== 0) {
      const ex = this.gx + DIR_X[h]! * this.pLen, ez = this.gz + DIR_Z[h]! * this.pLen;
      const ix = Math.round(ex / CELL), iz = Math.round(ez / CELL);
      const even = (h & 1) === 0;
      const kinds = (isAvenue(even ? ix : iz) ? 1 : 0) + (isAvenue(even ? iz : ix) ? 1 : 0);
      endCorner = Math.min(CORNER_LIMITS[kinds]!, 0.5 * (this.pV + this.nV));
    }

    const len = this.pLen;
    const slope = (this.pY1 - this.gy) / len;
    const a = this.pCorner > 0 ? this.pCorner * SECTION : 0;
    const b = endCorner > 0 ? endCorner * SECTION : 0;
    if (a + b > len) {
      // Too short for two corner sections: one speed that keeps both corners' windows constant.
      let v = len / (2 * SECTION);
      if (this.pCorner > 0) v = Math.min(v, this.pCorner);
      if (endCorner > 0) v = Math.min(v, endCorner);
      this.push(len, v, 0, slope);
    } else if (len - a - b < 12) {
      if (a > 0 && b > 0) {
        const a2 = (len * a) / (a + b);
        this.push(a2, this.pCorner, 0, slope);
        this.push(len - a2, endCorner, a2, slope);
      } else this.push(len, a > 0 ? this.pCorner : endCorner, 0, slope);
    } else {
      if (a > 0) this.push(a, this.pCorner, 0, slope);
      this.push(len - a - b, this.pV, a, slope);
      if (b > 0) this.push(b, endCorner, len - b, slope);
    }

    this.gx += DIR_X[h]! * len;
    this.gz += DIR_Z[h]! * len;
    this.gy = this.pY1;
    this.pH = (h + this.nTurn + 4) & 3;
    this.pLen = this.nLen;
    this.pY1 = this.nY1;
    this.pV = this.nV;
    this.pCorner = endCorner;
    this.pLook = this.nLook;
    this.pLookX = this.nLookX;
    this.pLookZ = this.nLookZ;
    this.pLookH = this.nLookH;
    this.pLookS = this.nLookS;

    // Keep stored coordinates small: move everything by whole tiles, which changes no difference.
    if (Math.abs(this.gx) > 2 * TILE) this.rebase(PX, Math.round(this.gx / TILE) * TILE, true);
    if (Math.abs(this.gz) > 2 * TILE) this.rebase(PZ, Math.round(this.gz / TILE) * TILE, false);
  }

  private rebase(field: number, shift: number, isX: boolean): void {
    for (let i = 0; i < this.count; i++) this.seg[i * STRIDE + field]! -= shift;
    if (isX) this.gx -= shift;
    else this.gz -= shift;
  }

  /** Make sure segments cover the kernels' reach around time t. */
  private ensure(t: number): void {
    const seg = this.seg;
    if (this.dropped && t - NEED_BACK < seg[T0]!) this.rewind();
    while (this.gt < t + KEEP_AHEAD) {
      if (this.count > CAP - 4) {
        let k = 0;
        while (k < this.count - 1 && seg[k * STRIDE + T0]! + seg[k * STRIDE + DUR]! < t - KEEP_BACK) k++;
        if (k === 0) return;
        seg.copyWithin(0, k * STRIDE, this.count * STRIDE);
        this.count -= k;
        this.cursor = Math.max(0, this.cursor - k);
        this.dropped = true;
      }
      this.step();
    }
  }

  // ---- evaluator

  private find(t: number): number {
    const seg = this.seg;
    let i = Math.min(this.cursor, this.count - 1);
    while (i > 0 && seg[i * STRIDE + T0]! > t) i--;
    while (i < this.count - 1 && seg[i * STRIDE + T0]! + seg[i * STRIDE + DUR]! <= t) i++;
    this.cursor = i;
    return i;
  }

  /** The unsmoothed route at time t, into ox/oy/oz; x and z are relative to the origin (bx, bz). */
  private raw(t: number): void {
    const o = this.find(t) * STRIDE;
    const seg = this.seg;
    const u = t - seg[o + T0]!;
    this.ox = seg[o + PX]! - this.bx + seg[o + VX]! * u;
    this.oy = seg[o + PY]! + seg[o + VY]! * u;
    this.oz = seg[o + PZ]! - this.bz + seg[o + VZ]! * u;
  }

  /**
   * The smoothed position and velocity at time t, into ox.. and ovx..: the route convolved with a
   * triangle kernel. Each piece of the integrand is a quadratic, so Simpson's rule is exact.
   * x and z are relative to the origin (bx, bz): differences of stored coordinates do not change
   * when the buffer is moved by whole tiles, so the result is the same to the last bit whenever
   * that happened.
   */
  private smooth(t: number): void {
    const seg = this.seg;
    const d = SMOOTH;
    const end = t + d;
    let a = t - d;
    let i = this.find(a);
    let x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
    while (a < end) {
      const o = i * STRIDE;
      const t0 = seg[o + T0]!;
      const segEnd = i < this.count - 1 ? t0 + seg[o + DUR]! : Infinity;
      let b = Math.min(end, segEnd);
      if (a < t && b > t) b = t;
      const w = b - a;
      const ka = (1 - Math.abs(a - t) / d) / d;
      const kb = (1 - Math.abs(b - t) / d) / d;
      const km = (ka + kb) / 2;
      const ua = a - t0, ub = b - t0, um = (ua + ub) / 2;
      const px = seg[o + PX]! - this.bx, py = seg[o + PY]!, pz = seg[o + PZ]! - this.bz;
      const sx = seg[o + VX]!, sy = seg[o + VY]!, sz = seg[o + VZ]!;
      const f = w / 6;
      x += f * (ka * (px + sx * ua) + 4 * km * (px + sx * um) + kb * (px + sx * ub));
      y += f * (ka * (py + sy * ua) + 4 * km * (py + sy * um) + kb * (py + sy * ub));
      z += f * (ka * (pz + sz * ua) + 4 * km * (pz + sz * um) + kb * (pz + sz * ub));
      const area = w * km;
      vx += area * sx;
      vy += area * sy;
      vz += area * sz;
      a = b;
      if (a >= segEnd) i++;
    }
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.ovx = vx;
    this.ovy = vy;
    this.ovz = vz;
  }

  /** Acceleration to the left of the direction of travel at time t: the second difference of the route. */
  private leftAccel(t: number, rightX: number, rightZ: number): number {
    const d = SMOOTH;
    this.raw(t - d);
    let ax = this.ox, az = this.oz;
    this.raw(t);
    ax -= 2 * this.ox;
    az -= 2 * this.oz;
    this.raw(t + d);
    ax += this.ox;
    az += this.oz;
    return -(ax * rightX + az * rightZ) / (d * d);
  }

  /** The tour pose at time t (seconds since this tour began, t >= 0). */
  sample(t: number, out: TourSample): void {
    this.ensure(t);
    this.pose(t, out);
    // Average the view direction over a short window round t. Position and velocity are not touched.
    const tap = this.tap;
    let yaw = 0, pitch = out.pitch / 3, roll = out.roll / 3;
    for (let k = 0; k < 5; k++) {
      const w = VIEW_WEIGHTS[k]!;
      if (w === 0) continue;
      this.pose(t + (k - 2) * 0.5 * VIEW_SMOOTH, tap);
      yaw += w * angleDelta(out.yaw, tap.yaw);
      pitch += w * tap.pitch;
      roll += w * tap.roll;
    }
    out.yaw = wrapDelta(out.yaw + yaw, 0, Math.PI * 2);
    out.pitch = pitch;
    out.roll = roll;
  }

  /** The pose before the view is averaged. */
  private pose(t: number, out: TourSample): void {
    const seg = this.seg;
    const origin = this.find(t) * STRIDE;
    this.bx = seg[origin + PX]!;
    this.bz = seg[origin + PZ]!;
    this.smooth(t + LOOK_AHEAD);
    const ax = this.ox, ay = this.oy, az = this.oz;
    this.smooth(t);
    const x = this.ox, y = this.oy, z = this.oz;
    const vx = this.ovx, vy = this.ovy, vz = this.ovz;
    const cx = ax - x, cy = ay - y, cz = az - z;
    const yawPath = Math.atan2(-cx, -cz);
    const pitchPath = Math.atan2(cy, Math.hypot(cx, cz));
    const pitchBase = 0.55 * pitchPath - 0.17 * smoothstep(150, 600, y) + 0.05 * (1 - smoothstep(TOUR_MIN_Y, 50, y));

    // Bank with the turn, averaged over the look-ahead so it starts and ends with the yaw.
    const speedH = Math.hypot(vx, vz);
    const rightX = speedH > 1e-6 ? -vz / speedH : 1;
    const rightZ = speedH > 1e-6 ? vx / speedH : 0;
    const lateral = 0.25 * this.leftAccel(t, rightX, rightZ)
      + 0.5 * this.leftAccel(t + LOOK_AHEAD / 2, rightX, rightZ)
      + 0.25 * this.leftAccel(t + LOOK_AHEAD, rightX, rightZ);
    const roll = MAX_ROLL * Math.tanh(lateral / ROLL_ACCEL);

    // Looks: each segment's share of a wide kernel pulls the view towards that segment's target.
    const dl = LOOK_SMOOTH;
    const px = wrapTile(wrapTile(this.bx) + x), pz = wrapTile(wrapTile(this.bz) + z);
    let yawOff = 0, pitchOff = 0;
    const end = t + dl;
    let a = t - dl;
    let i = this.find(a);
    while (a < end) {
      const o = i * STRIDE;
      const segEnd = i < this.count - 1 ? seg[o + T0]! + seg[o + DUR]! : Infinity;
      let b = Math.min(end, segEnd);
      if (a < t && b > t) b = t;
      const kind = seg[o + LK]!;
      if (kind !== LOOK_NONE) {
        const ka = (1 - Math.abs(a - t) / dl) / dl;
        const kb = (1 - Math.abs(b - t) / dl) / dl;
        const share = (b - a) * 0.5 * (ka + kb) * seg[o + LS]!;
        let yawTo = 0, pitchTo = SUN_PITCH;
        if (kind === LOOK_POINT) {
          const dx = wrapDelta(seg[o + LX]!, px, TILE), dz = wrapDelta(seg[o + LZ]!, pz, TILE);
          const dist = Math.hypot(dx, dz);
          yawTo = Math.atan2(-dx, -dz);
          pitchTo = Math.atan2(clamp(0.35 * (0.85 * seg[o + LH]! - y), -0.3 * dist, 0.42 * dist), Math.max(dist, 1));
        }
        const delta = angleDelta(yawPath, yawTo);
        const taper = lookTaper(delta);
        yawOff += share * taper * delta;
        pitchOff += share * taper * (pitchTo - pitchBase);
      }
      a = b;
      if (a >= segEnd) i++;
    }

    out.x = px;
    out.y = y;
    out.z = pz;
    out.yaw = wrapDelta(yawPath + yawOff, 0, Math.PI * 2);
    out.pitch = clamp(pitchBase + pitchOff, -1.2, 1.2);
    out.roll = roll;
    out.vx = vx;
    out.vy = vy;
    out.vz = vz;
    out.speed = Math.hypot(vx, vy, vz);
  }
}
