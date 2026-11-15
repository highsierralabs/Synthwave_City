// Air traffic hulls, built in code (plan T07). Pure data: no three, so the unit tests can check
// every piece is closed, wound outwards and inside the limits the packer assumes.
//
// Local frame of every hull: x to the craft's right, y up, z BACKWARDS (the nose is at -z), so
// the frame (right, up, back) is right-handed and triangles keep their winding when placed.
//
// Hulls are lofts: closed polygon rings at increasing z, joined by quads and capped. Vertices
// are shared inside a piece; the fragment shaders take the face normal from screen-space
// derivatives, so no normals are stored. Every vertex of a piece carries the same part id.
import { HERO, HERO_TYPES, SHAPE, SHAPE_COUNT } from './pack';

export type Ring = readonly (readonly [number, number])[];

/** Part ids read by the fragment shaders. */
export const PART = { body: 0, glass: 1, engine: 2, cargo: 3, fin: 4, lightbar: 5, lamp: 6 } as const;

export interface HullMesh {
  readonly positions: Float32Array;
  /** One float per vertex: a PART value. */
  readonly parts: Float32Array;
  /** One float per vertex: the hero type (0 for the small craft, which have one mesh per shape). */
  readonly types: Float32Array;
  readonly indices: Uint16Array;
  /** Index ranges of the closed pieces, [start, count] pairs, for the tests. */
  readonly pieces: readonly (readonly [number, number, boolean])[];
}

// ---- rings (all counter-clockwise seen from +z, x to the right, y up)
export function hex(hw: number, yb: number, ym: number, yt: number, kb = 0.6, kt = 0.55): Ring {
  return [[hw * kb, yb], [hw, ym], [hw * kt, yt], [-hw * kt, yt], [-hw, ym], [-hw * kb, yb]];
}
export function rect(x0: number, x1: number, y0: number, y1: number): Ring {
  return [[x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}
/** Symmetric trapezoid: half-width w0 at y0 (bottom), w1 at y1 (top). */
export function trap(w0: number, w1: number, y0: number, y1: number): Ring {
  return [[w0, y0], [w1, y1], [-w1, y1], [-w0, y0]];
}
export function diamond(cx: number, w: number, h: number): Ring {
  return [[cx + w, 0], [cx, h], [cx - w, 0], [cx, -h]];
}
export function ellipse(rx: number, ry: number, n: number): Ring {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
    out.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return out;
}
export function point(x: number, y: number, n: number): Ring {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([x, y]);
  return out;
}
function mirrored(ring: Ring): Ring {
  // Mirror in x and reverse so the ring stays counter-clockwise.
  return ring.map(([x, y]) => [-x, y] as const).reverse();
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export class HullBuilder {
  private readonly pos: number[] = [];
  private readonly part: number[] = [];
  private readonly type: number[] = [];
  private readonly idx: number[] = [];
  private readonly pieces: [number, number, boolean][] = [];
  /** Hero type stamped on the vertices added from now on. */
  currentType = 0;

  private tri(a: number, b: number, c: number): void {
    const p = this.pos;
    // Skip triangles with no area (a ring collapsed to a point or a line).
    const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return;
    this.idx.push(a, b, c);
  }

  /**
   * Join rings (same point count, increasing z) into a closed piece.
   * closed = false leaves an end open on purpose (a fin whose root is buried in the body).
   */
  loft(part: number, sections: readonly (readonly [number, Ring])[], capStart = true, capEnd = true): void {
    const start = this.idx.length;
    const n = sections[0]![1].length;
    const base = this.pos.length / 3;
    for (const [z, ring] of sections) {
      if (ring.length !== n) throw new Error('loft: rings must have the same point count');
      for (const [x, y] of ring) {
        this.pos.push(x, y, z);
        this.part.push(part);
        this.type.push(this.currentType);
      }
    }
    for (let s = 0; s + 1 < sections.length; s++) {
      if (!(sections[s + 1]![0] > sections[s]![0])) throw new Error('loft: z must increase');
      for (let j = 0; j < n; j++) {
        const a0 = base + s * n + j;
        const b0 = base + s * n + ((j + 1) % n);
        const a1 = a0 + n;
        const b1 = b0 + n;
        this.tri(a0, b0, a1);
        this.tri(b0, b1, a1);
      }
    }
    const last = base + (sections.length - 1) * n;
    if (capStart) for (let j = 1; j + 1 < n; j++) this.tri(base, base + j + 1, base + j);
    if (capEnd) for (let j = 1; j + 1 < n; j++) this.tri(last, last + j, last + j + 1);
    const first = sections[0]![1];
    const end = sections[sections.length - 1]![1];
    const closed = (capStart || Math.abs(ringArea(first)) < 1e-9) && (capEnd || Math.abs(ringArea(end)) < 1e-9);
    this.pieces.push([start, this.idx.length - start, closed]);
  }

  box(part: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    this.loft(part, [[z0, rect(x0, x1, y0, y1)], [z1, rect(x0, x1, y0, y1)]]);
  }

  /** The same loft on both sides of the centre line. */
  loftPair(part: number, sections: readonly (readonly [number, Ring])[], capStart = true, capEnd = true): void {
    this.loft(part, sections, capStart, capEnd);
    this.loft(part, sections.map(([z, ring]) => [z, mirrored(ring)] as const), capStart, capEnd);
  }

  build(): HullMesh {
    return {
      positions: new Float32Array(this.pos),
      parts: new Float32Array(this.part),
      types: new Float32Array(this.type),
      indices: new Uint16Array(this.idx),
      pieces: this.pieces,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Small craft. Kept lean: several thousand of each are drawn, twice (scene and reflection).
// ---------------------------------------------------------------------------------------------

function buildCar(): HullMesh {
  const b = new HullBuilder();
  // A low wedge: a knife-edge nose widening to the shoulders, then a short tail.
  b.loft(PART.body, [
    [-4.0, hex(0.55, -0.16, -0.16, -0.16)],
    [1.2, hex(1.7, -0.52, -0.06, 0.42)],
    [3.3, hex(1.5, -0.36, 0.0, 0.34)],
  ]);
  // Canopy: rises out of the hood and is cut off square at the back.
  b.loft(PART.glass, [
    [-1.9, trap(0.5, 0.5, 0.05, 0.05)],
    [1.1, trap(0.9, 0.6, 0.36, 0.92)],
  ]);
  // Two tail fins growing out of the shoulders.
  b.loftPair(PART.fin, [
    [1.5, point(1.22, 0.36, 3)],
    [3.6, [[1.08, 0.3], [1.36, 0.3], [1.3, 1.26]]],
  ]);
  return b.build();
}

function buildHauler(): HullMesh {
  const b = new HullBuilder();
  // Cab with a raked windscreen; its back is hidden by the container.
  b.loft(PART.body, [
    [-9.0, trap(1.5, 1.25, -1.35, 0.1)],
    [-6.6, trap(2.05, 1.9, -1.65, 1.55)],
    [-4.7, trap(2.05, 1.9, -1.65, 1.55)],
  ], true, false);
  b.box(PART.cargo, -2.35, 2.35, -1.75, 2.15, -4.7, 8.4);
  // Engine pods on the flanks at the back.
  b.loftPair(PART.engine, [
    [5.0, rect(2.35, 3.55, -0.75, 0.75)],
    [9.2, rect(2.35, 3.55, -0.75, 0.75)],
  ]);
  return b.build();
}

function buildDrone(): HullMesh {
  const b = new HullBuilder();
  b.loft(PART.body, [
    [-1.6, point(0, -0.05, 4)],
    [-0.35, diamond(0, 0.62, 0.42)],
    [0.95, diamond(0, 0.4, 0.3)],
  ]);
  // Two rotor pods: flat double wedges touching the body.
  b.loftPair(PART.engine, [
    [-0.75, point(1.1, 0, 4)],
    [0.05, diamond(1.1, 0.6, 0.16)],
    [0.85, point(1.1, 0, 4)],
  ]);
  return b.build();
}

export function buildCraftHull(shape: number): HullMesh {
  if (shape === SHAPE.car) return buildCar();
  if (shape === SHAPE.hauler) return buildHauler();
  return buildDrone();
}

/** Lights per craft: two engines, one headlamp, a strobe and a beacon. */
export const CRAFT_LIGHTS = 5;
export const LIGHT = { engineL: 0, engineR: 1, head: 2, strobe: 3, beacon: 4 } as const;

/**
 * Per shape, CRAFT_LIGHTS entries of (x, y, z, half-size in metres), at scale 1, in the hull's
 * local frame. A half-size of 0 means the shape has no such light.
 */
export const CRAFT_LIGHT_TABLE: readonly number[] = [
  // car
  -0.8, 0.0, 3.5, 1.9,
  0.8, 0.0, 3.5, 1.9,
  0.0, -0.14, -4.1, 1.2,
  0.0, 1.05, 0.7, 0.9,
  0.0, -0.66, 0.6, 0.9,
  // hauler
  -2.95, 0.0, 9.4, 2.8,
  2.95, 0.0, 9.4, 2.8,
  0.0, -0.9, -9.15, 1.7,
  0.0, 2.35, -3.6, 1.2,
  0.0, -1.95, 2.0, 1.2,
  // drone
  -1.1, 0.0, 0.95, 1.0,
  1.1, 0.0, 0.95, 1.0,
  0.0, -0.05, -1.65, 0.8,
  0.0, 0.55, 0.0, 0.6,
  0.0, 0.0, 0.0, 0.0,
];

/**
 * Per shape: where the trail starts (y, z), half the distance between the two exhaust lines, and
 * the half-width of one line, metres at scale 1.
 */
export const CRAFT_TRAIL_TABLE: readonly number[] = [
  // y, z, half separation, line half-width
  0.0, 3.5, 0.8, 0.3,
  0.0, 9.4, 2.95, 0.5,
  0.0, 0.95, 1.1, 0.2,
];

if (CRAFT_LIGHT_TABLE.length !== SHAPE_COUNT * CRAFT_LIGHTS * 4) throw new Error('craft light table size');

// ---------------------------------------------------------------------------------------------
// Hero ships: three types merged into one mesh; each vertex carries its type.
// ---------------------------------------------------------------------------------------------

function freighter(b: HullBuilder): void {
  b.currentType = HERO.freighter;
  b.loft(PART.body, [
    [-98, hex(3, -5, -2, 1.5, 0.6, 0.9)],
    [-72, hex(17, -13, -3, 5, 0.6, 0.9)],
    [62, hex(20, -14, -3, 5, 0.6, 0.9)],
    [96, hex(15, -9, -2, 5, 0.6, 0.9)],
  ]);
  // Container stacks on the deck.
  const tops = [15, 19.5, 13, 19.5, 16, 12];
  for (let i = 0; i < tops.length; i++) {
    const z0 = -64 + i * 17.5;
    b.box(PART.cargo, -15, 15, 5, tops[i]!, z0, z0 + 16);
  }
  // Superstructure and bridge.
  b.box(PART.glass, -13, 13, 5, 22, 46, 72);
  b.box(PART.glass, -17, 17, 22, 27.5, 47, 60);
  b.box(PART.fin, -0.8, 0.8, 22, 41, 62, 64);
  b.box(PART.fin, -1.5, 1.5, -16, -13, -40, 50);
  // Engine nacelles.
  b.loftPair(PART.engine, [
    [56, rect(19, 27, -9, -1)],
    [102, rect(19, 27, -9, -1)],
  ]);
}

function airship(b: HullBuilder): void {
  b.currentType = HERO.airship;
  const stations: readonly (readonly [number, number])[] = [
    [-92, 1.5], [-84, 10], [-66, 18.5], [-38, 24.5], [0, 26], [36, 24], [62, 18], [80, 10.5], [92, 3],
  ];
  b.loft(PART.body, stations.map(([z, r]) => [z, ellipse(r, r * 0.9, 14)] as const));
  b.box(PART.glass, -5, 5, -31, -22.5, -28, 14);
  // Tail fins: top, bottom (shorter), and the two sides.
  b.loft(PART.fin, [[56, rect(-0.7, 0.7, 15, 17)], [90, rect(-0.7, 0.7, 3, 40)]]);
  b.loft(PART.fin, [[56, rect(-0.7, 0.7, -17, -15)], [90, rect(-0.7, 0.7, -30, -3)]]);
  b.loftPair(PART.fin, [[56, rect(17, 19, -0.7, 0.7)], [90, rect(3.5, 40, -0.7, 0.7)]]);
  b.loftPair(PART.engine, [
    [10, rect(25, 31.5, -12, -6)],
    [26, rect(25, 31.5, -12, -6)],
  ]);
}

function patrol(b: HullBuilder): void {
  b.currentType = HERO.patrol;
  b.loft(PART.body, [
    [-31, hex(1.2, -0.9, -0.2, 0.5)],
    [-13, hex(5.5, -2.4, -0.3, 2.0)],
    [12, hex(7.5, -2.8, 0, 2.8)],
    [29, hex(6, -2.0, 0, 2.2)],
  ]);
  b.loft(PART.glass, [
    [-23, trap(1.8, 1.4, 0.9, 1.3)],
    [-14, trap(3.0, 2.2, 1.6, 3.6)],
    [-4, trap(2.6, 1.8, 2.0, 3.4)],
  ]);
  // Swept wings.
  b.loftPair(PART.fin, [
    [-6, rect(5.3, 5.9, -0.5, 0.1)],
    [18, rect(6.5, 12.5, -0.5, 0.1)],
    [27, rect(6.0, 11.5, -0.4, 0.0)],
  ]);
  // Twin tail fins.
  b.loftPair(PART.fin, [
    [14, rect(4.6, 5.2, 2.4, 2.9)],
    [28, rect(4.6, 5.2, 2.0, 8.0)],
  ]);
  b.box(PART.lightbar, -4.2, 4.2, 2.3, 3.5, 0, 2.4);
  b.box(PART.lamp, -1.3, 1.3, -4.2, -2.5, -9, -6);
  b.loftPair(PART.engine, [
    [26, rect(2, 5, -1.4, 1.4)],
    [31.5, rect(2, 5, -1.4, 1.4)],
  ]);
}

export function buildHeroHull(): HullMesh {
  const b = new HullBuilder();
  freighter(b);
  airship(b);
  patrol(b);
  return b.build();
}

/** How a hero light behaves; read by the hero light shader. */
export const GLOW = {
  steady: 0,
  /** Short white double flash. */
  strobe: 1,
  /** Slow breathing pulse, offset by the phase. */
  pulse: 2,
  /** Police bar, first half of the cycle. */
  policeA: 3,
  /** Police bar, second half. */
  policeB: 4,
  /** Engine: brightest from behind, flickers. */
  engine: 5,
  /** The searchlight's lamp. */
  searchlamp: 6,
  /** Brightest from ahead. */
  head: 7,
  /** Quads that are not sprites: the searchlight cone, its pool on the ground, an exhaust plume. */
  cone: 10,
  pool: 11,
  plume: 12,
} as const;

export interface HeroLight {
  readonly type: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Sprite half-size, metres; for a plume its length. */
  readonly size: number;
  /** Palette index; a fraction blends two neighbours (1.6 is a blue between cyan and violet). */
  readonly color: number;
  readonly mode: number;
  readonly phase: number;
}

/** Where the patrol craft's searchlight leaves the hull. */
export const SEARCHLIGHT_ORIGIN: readonly [number, number, number] = [0, -4.4, -7.5];

export function heroLights(): HeroLight[] {
  const out: HeroLight[] = [];
  const add = (type: number, x: number, y: number, z: number, size: number, color: number, mode: number, phase = 0): void => {
    out.push({ type, x, y, z, size, color, mode, phase });
  };
  // ---- freighter: rows of lights down both gunwales and along the keel
  const F = HERO.freighter;
  for (let i = 0; i < 10; i++) {
    const z = -84 + i * 18.5;
    const hw = z < -72 ? 3 + ((z + 98) / 26) * 14 : 17 + ((z + 72) / 134) * 3;
    add(F, -(hw + 0.8), -3, z, 3.2, 4, GLOW.steady);
    add(F, hw + 0.8, -3, z, 3.2, 4, GLOW.steady);
  }
  for (let i = 0; i < 8; i++) add(F, 0, -17.2, -38 + i * 12.4, 3.6, 1, GLOW.pulse, i / 8);
  add(F, -21.5, -3, -10, 5, 6, GLOW.steady);
  add(F, 21.5, -3, -10, 5, 5, GLOW.steady);
  add(F, 0, 2.5, -99.5, 7, 7, GLOW.strobe, 0.0);
  add(F, 0, 42, 63, 6, 6, GLOW.pulse, 0.3);
  add(F, 0, 7, 97.5, 6, 7, GLOW.strobe, 0.5);
  add(F, -17.8, 25, 46.5, 4, 7, GLOW.steady);
  add(F, 17.8, 25, 46.5, 4, 7, GLOW.steady);
  add(F, -23, -5, 103.5, 19, 3, GLOW.engine);
  add(F, 23, -5, 103.5, 19, 3, GLOW.engine);
  add(F, -23, -5, 102.5, 90, 3, GLOW.plume);
  add(F, 23, -5, 102.5, 90, 3, GLOW.plume);
  // ---- airship
  const A = HERO.airship;
  add(A, 0, 0, -94, 6, 7, GLOW.strobe, 0.2);
  add(A, 0, 0.5, 93.5, 6, 6, GLOW.pulse, 0.0);
  add(A, 0, 41.5, 90, 5, 6, GLOW.pulse, 0.5);
  add(A, 0, -31.5, 90, 5, 6, GLOW.pulse, 0.5);
  add(A, -41.5, 0, 90, 5, 7, GLOW.strobe, 0.35);
  add(A, 41.5, 0, 90, 5, 7, GLOW.strobe, 0.85);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    add(A, Math.sin(a) * 12.5, -23.6, -7 + Math.cos(a) * 40, 3.4, 0, GLOW.pulse, i / 12);
  }
  add(A, 0, -32.2, -7, 7, 4, GLOW.steady);
  add(A, -28.2, -9, 27, 9, 2, GLOW.engine);
  add(A, 28.2, -9, 27, 9, 2, GLOW.engine);
  add(A, -28.2, -9, 26.5, 40, 2, GLOW.plume);
  add(A, 28.2, -9, 26.5, 40, 2, GLOW.plume);
  // ---- patrol craft
  const P = HERO.patrol;
  add(P, -3.3, 3.9, 1.2, 5, 6, GLOW.policeA);
  add(P, -1.3, 3.9, 1.2, 5, 6, GLOW.policeA);
  add(P, 1.3, 3.9, 1.2, 5, 1.62, GLOW.policeB);
  add(P, 3.3, 3.9, 1.2, 5, 1.62, GLOW.policeB);
  add(P, -1.0, -0.3, -31.4, 3, 7, GLOW.head);
  add(P, 1.0, -0.3, -31.4, 3, 7, GLOW.head);
  add(P, -12.9, -0.2, 21, 2.6, 6, GLOW.steady);
  add(P, 12.9, -0.2, 21, 2.6, 5, GLOW.steady);
  add(P, -3.5, 0, 32, 7, 1, GLOW.engine);
  add(P, 3.5, 0, 32, 7, 1, GLOW.engine);
  add(P, 0, -3.1, 10, 3, 7, GLOW.strobe, 0.6);
  const [sx, sy, sz] = SEARCHLIGHT_ORIGIN;
  add(P, sx, sy, sz, 8, 7, GLOW.searchlamp);
  add(P, sx, sy, sz, 1, 7, GLOW.cone);
  add(P, sx, sy, sz, 1, 7, GLOW.pool);
  return out;
}

if (HERO_TYPES !== 3) throw new Error('hero type count');
