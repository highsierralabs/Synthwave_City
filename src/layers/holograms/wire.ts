// Wire holograms (plan T09, M4): the geometry of every rotating solid, baked into one mesh. Pure.
//
// Triangles are unshared, and each vertex carries a barycentric coordinate whose component i is 0
// on the edge opposite vertex i. An edge that must not be drawn (a quad's diagonal) has its
// component set to 1 on all three vertices, so the fragment shader never comes near it.
import type { Site } from '../../contracts/city';
import { hashInts } from '../../core/random';
import { partnerColor } from './pack';

export const WIRE_KIND = { edges: 0, glow: 1, cone: 2 } as const;
export const WIRE_SHAPES = ['icosphere', 'torus', 'globe', 'pyramid', 'rings', 'gyro'] as const;
export type WireShape = (typeof WIRE_SHAPES)[number];

type V3 = readonly [number, number, number];

export interface WireMesh {
  readonly vertexCount: number;
  /** 3 per vertex: metres from the anchor before rotation; for the glow sprite, corner x, y and half-size. */
  readonly position: Float32Array;
  /** 3 per vertex: edge coordinates (see the file comment); for the cone, x is 0 at the ground and 1 at the top. */
  readonly bary: Float32Array;
  /** 3 per vertex: the site position. */
  readonly anchor: Float32Array;
  /** 4 per vertex: spin laps per loop, phase 0..1, tilt in radians, precession laps per loop. */
  readonly spin: Float32Array;
  /** 4 per vertex: palette index, brightness, WIRE_KIND, seed. */
  readonly look: Float32Array;
  /** 4 per vertex: line half-width in metres, face fill, object radius, bob weight. */
  readonly style: Float32Array;
  /** The shape chosen for each object, in order. */
  readonly shapes: readonly WireShape[];
}

interface Part {
  spin: readonly [number, number, number, number];
  color: number;
  gain: number;
  kind: number;
  line: number;
  fill: number;
  bob: number;
}

class Builder {
  readonly position: number[] = [];
  readonly bary: number[] = [];
  readonly anchor: number[] = [];
  readonly spin: number[] = [];
  readonly look: number[] = [];
  readonly style: number[] = [];
  private site: V3 = [0, 0, 0];
  private seed = 0;
  private radius = 1;
  private part: Part = { spin: [0, 0, 0, 0], color: 0, gain: 1, kind: 0, line: 0.1, fill: 0, bob: 1 };

  begin(site: V3, seed: number, radius: number): void {
    this.site = site;
    this.seed = seed;
    this.radius = radius;
  }

  use(part: Partial<Part>): void {
    this.part = { ...this.part, ...part };
  }

  private vertex(p: V3, b: V3): void {
    const t = this.part;
    this.position.push(p[0], p[1], p[2]);
    this.bary.push(b[0], b[1], b[2]);
    this.anchor.push(this.site[0], this.site[1], this.site[2]);
    this.spin.push(t.spin[0], t.spin[1], t.spin[2], t.spin[3]);
    this.look.push(t.color, t.gain, t.kind, this.seed);
    this.style.push(t.line, t.fill, this.radius, t.bob);
  }

  /** A triangle; bc, ca and ab say whether the edge opposite a, b and c is drawn. */
  tri(a: V3, b: V3, c: V3, bc = true, ca = true, ab = true): void {
    const x = bc ? 0 : 1, y = ca ? 0 : 1, z = ab ? 0 : 1;
    this.vertex(a, [1, y, z]);
    this.vertex(b, [x, 1, z]);
    this.vertex(c, [x, y, 1]);
  }

  /** A quad a-b-c-d, split along a-c; each flag says whether that side is drawn. */
  quad(a: V3, b: V3, c: V3, d: V3, ab = true, bc = true, cd = true, da = true): void {
    this.tri(a, b, c, bc, false, ab);
    this.tri(a, c, d, cd, da, false);
  }

  /** A triangle that carries raw coordinates in place of edge data (the cone and the glow). */
  raw(a: V3, b: V3, c: V3, ta: V3, tb: V3, tc: V3): void {
    this.vertex(a, ta);
    this.vertex(b, tb);
    this.vertex(c, tc);
  }
}

const scale = (v: V3, s: number): V3 => [v[0] * s, v[1] * s, v[2] * s];
const unit = (v: V3): V3 => scale(v, 1 / Math.hypot(v[0], v[1], v[2]));
const mid = (a: V3, b: V3): V3 => unit([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);

function icosahedron(): { verts: V3[]; faces: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: V3[] = ([
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ] as V3[]).map(unit);
  const faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { verts, faces };
}

function addIcosahedron(b: Builder, r: number, subdivide: boolean): void {
  const { verts, faces } = icosahedron();
  for (const [i, j, k] of faces) {
    const p = verts[i]!, q = verts[j]!, s = verts[k]!;
    if (!subdivide) {
      b.tri(scale(p, r), scale(q, r), scale(s, r));
      continue;
    }
    const pq = mid(p, q), qs = mid(q, s), sp = mid(s, p);
    b.tri(scale(p, r), scale(pq, r), scale(sp, r));
    b.tri(scale(q, r), scale(qs, r), scale(pq, r));
    b.tri(scale(s, r), scale(sp, r), scale(qs, r));
    b.tri(scale(pq, r), scale(qs, r), scale(sp, r));
  }
}

function addOctahedron(b: Builder, r: number, height: number, centre: V3 = [0, 0, 0]): void {
  const at = (x: number, y: number, z: number): V3 => [centre[0] + x, centre[1] + y, centre[2] + z];
  const ring: V3[] = [at(r, 0, 0), at(0, 0, r), at(-r, 0, 0), at(0, 0, -r)];
  for (let i = 0; i < 4; i++) {
    const p = ring[i]!, q = ring[(i + 1) % 4]!;
    b.tri(at(0, height, 0), p, q);
    b.tri(at(0, -height, 0), q, p);
  }
}

function addTorus(b: Builder, major: number, minor: number, nu: number, nv: number): void {
  const at = (i: number, j: number): V3 => {
    const u = (i / nu) * Math.PI * 2, v = (j / nv) * Math.PI * 2;
    const ring = major + minor * Math.cos(v);
    return [ring * Math.cos(u), minor * Math.sin(v), ring * Math.sin(u)];
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) b.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  }
}

function addSphere(b: Builder, r: number, lon: number, lat: number): void {
  const at = (i: number, j: number): V3 => {
    const u = (i / lon) * Math.PI * 2, v = (j / lat) * Math.PI;
    return [r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)];
  };
  for (let i = 0; i < lon; i++) {
    for (let j = 0; j < lat; j++) {
      if (j === 0) b.tri(at(i, 0), at(i + 1, 1), at(i, 1));
      else if (j === lat - 1) b.tri(at(i, j), at(i + 1, j), at(i, lat));
      else b.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
}

/** A flat ring in the xz plane at height y; every `tick`-th spoke is drawn. */
function addAnnulus(b: Builder, inner: number, outer: number, y: number, segments: number, tick: number): void {
  const at = (i: number, r: number): V3 => {
    const a = (i / segments) * Math.PI * 2;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  for (let i = 0; i < segments; i++) {
    b.quad(at(i, inner), at(i + 1, inner), at(i + 1, outer), at(i, outer), true, (i + 1) % tick === 0, true, i % tick === 0);
  }
}

/** A hoop: a short cylinder wall round the y axis; every `tick`-th upright is drawn. */
function addHoop(b: Builder, r: number, halfHeight: number, segments: number, tick: number): void {
  const at = (i: number, y: number): V3 => {
    const a = (i / segments) * Math.PI * 2;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  for (let i = 0; i < segments; i++) {
    b.quad(at(i, -halfHeight), at(i + 1, -halfHeight), at(i + 1, halfHeight), at(i, halfHeight), true, (i + 1) % tick === 0, true, i % tick === 0);
  }
}

/** A square pyramid cut into bands; the top band floats free as a capstone. */
function addPyramid(b: Builder, half: number, y0: number, y1: number, bands: number, capLift: number, capOnly: boolean): void {
  const corner = (k: number, t: number, lift: number): V3 => {
    const sx = k === 0 || k === 3 ? -1 : 1, sz = k < 2 ? -1 : 1;
    const h = half * (1 - t);
    return [sx * h, y0 + (y1 - y0) * t + lift, sz * h];
  };
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    for (let j = 0; j < bands; j++) {
      const cap = j === bands - 1;
      if (cap !== capOnly) continue;
      const t0 = j / bands, t1 = (j + 1) / bands, lift = cap ? capLift : 0;
      if (cap) b.tri(corner(k, t0, lift), corner(n, t0, lift), corner(k, 1, lift));
      else b.quad(corner(k, t0, lift), corner(n, t0, lift), corner(n, t1, lift), corner(k, t1, lift));
    }
  }
  if (!capOnly) b.quad(corner(0, 0, 0), corner(1, 0, 0), corner(2, 0, 0), corner(3, 0, 0));
}

/** Whole laps per loop for a turn that takes about `seconds`; never 0. */
function laps(seconds: number, sign: number): number {
  return sign * Math.max(1, Math.round(4096 / seconds));
}

function addShape(b: Builder, shape: WireShape, r: number, colorA: number, colorB: number, phase: number, h: number): void {
  const dir = h & 1 ? 1 : -1;
  const line = Math.max(0.12, r * 0.006);
  const solid = { kind: WIRE_KIND.edges, line, bob: 1, gain: 1 };
  switch (shape) {
    case 'icosphere':
      b.use({ ...solid, color: colorA, fill: 0.05, spin: [laps(46, dir), phase, 0.35, laps(120, -dir)] });
      addIcosahedron(b, r * 0.96, true);
      b.use({ ...solid, color: colorB, fill: 0.16, gain: 1.15, spin: [laps(17, -dir), phase, 0.9, laps(40, dir)] });
      addIcosahedron(b, r * 0.4, false);
      break;
    case 'torus':
      b.use({ ...solid, color: colorA, fill: 0.045, spin: [laps(30, dir), phase, 1.05, laps(75, dir)] });
      addTorus(b, r * 0.7, r * 0.27, 30, 12);
      b.use({ ...solid, color: colorB, fill: 0.2, gain: 1.15, spin: [laps(12, -dir), phase, 0.6, laps(31, -dir)] });
      addOctahedron(b, r * 0.2, r * 0.3);
      break;
    case 'globe':
      b.use({ ...solid, color: colorA, fill: 0.04, spin: [laps(50, dir), phase, 0.41, 0] });
      addSphere(b, r * 0.86, 24, 12);
      b.use({ ...solid, color: colorB, fill: 0.12, gain: 1.2, spin: [laps(21, -dir), phase, 0.5, laps(160, dir)] });
      addAnnulus(b, r * 1.08, r * 1.2, 0, 60, 5);
      addOctahedron(b, r * 0.07, r * 0.07, [r * 1.14, 0, 0]);
      break;
    case 'pyramid':
      b.use({ ...solid, color: colorA, fill: 0.06, spin: [laps(38, dir), phase, 0, 0] });
      addPyramid(b, r * 0.82, -r * 0.5, r * 0.82, 5, r * 0.09, false);
      b.use({ ...solid, color: 7, fill: 0.3, gain: 1.1, spin: [laps(38, dir), phase, 0, 0] });
      addPyramid(b, r * 0.82, -r * 0.5, r * 0.82, 5, r * 0.09, true);
      b.use({ ...solid, color: colorB, fill: 0.08, spin: [laps(26, -dir), phase, 0, 0] });
      addPyramid(b, r * 0.5, -r * 0.6, -r * 1.0, 3, 0, false);
      addPyramid(b, r * 0.5, -r * 0.6, -r * 1.0, 3, 0, true);
      break;
    case 'rings': {
      const count = 7;
      for (let k = 0; k < count; k++) {
        const y = (-0.84 + (1.68 * k) / (count - 1)) * r;
        const rk = Math.sqrt(Math.max(r * r - y * y, 0));
        const turn = k % 2 === 0 ? dir : -dir;
        b.use({ ...solid, color: k % 2 === 0 ? colorA : colorB, fill: 0.22, spin: [laps(24 + 5 * k, turn), phase + k * 0.13, 0, 0] });
        addAnnulus(b, rk * 0.8, rk, y, 40, 4);
      }
      b.use({ ...solid, color: 7, fill: 0.3, spin: [laps(9, dir), phase, 0, 0] });
      addOctahedron(b, r * 0.12, r * 0.9);
      break;
    }
    case 'gyro': {
      const hoops: [number, number, number, number][] = [[1, 1.5708, 36, 90], [0.8, 1.0, 22, 47], [0.6, 0.55, 14, 29]];
      for (let k = 0; k < hoops.length; k++) {
        const [rr, tilt, spin, precess] = hoops[k]!;
        const turn = k % 2 === 0 ? dir : -dir;
        b.use({ ...solid, color: k === 1 ? colorB : colorA, fill: 0.4, gain: 1.3, spin: [laps(spin, turn), phase + k * 0.21, tilt, laps(precess, -turn)] });
        addHoop(b, r * rr, r * 0.085, 48, 4);
      }
      b.use({ ...solid, color: colorB, fill: 0.2, gain: 1.2, spin: [laps(10, dir), phase, 0.7, laps(23, dir)] });
      addIcosahedron(b, r * 0.26, false);
      break;
    }
  }
}

/** The glow sprite, the projector cone and the ring on the plaza floor that every object shares. */
function addStage(b: Builder, site: Site, colorA: number, phase: number): void {
  const r = site.w;
  // Soft inner glow: one camera-facing quad.
  b.use({ kind: WIRE_KIND.glow, color: colorA, gain: 1, fill: 0, line: 0, bob: 1, spin: [0, 0, 0, 0] });
  const s = r * 1.9;
  b.raw([-1, -1, s], [1, -1, s], [1, 1, s], [-1, -1, 0], [1, -1, 0], [1, 1, 0]);
  b.raw([-1, -1, s], [1, 1, s], [-1, 1, s], [-1, -1, 0], [1, 1, 0], [-1, 1, 0]);
  // The cone of light from the plaza floor up to the object.
  const segments = 24;
  const yBase = 0.6 - site.y, yTop = -r * 0.3;
  const rim = (i: number, radius: number, y: number): V3 => {
    const a = (i / segments) * Math.PI * 2;
    return [radius * Math.cos(a), y, radius * Math.sin(a)];
  };
  b.use({ kind: WIRE_KIND.cone, color: colorA, gain: 1, fill: 0, line: 0, bob: 0, spin: [0, 0, 0, 0] });
  for (let i = 0; i < segments; i++) {
    const u0 = i / segments, u1 = (i + 1) / segments;
    const a = rim(i, r * 0.1, yBase), c = rim(i + 1, r * 0.1, yBase), d = rim(i + 1, r * 0.78, yTop), e = rim(i, r * 0.78, yTop);
    b.raw(a, c, d, [0, u0, 0], [0, u1, 0], [1, u1, 0]);
    b.raw(a, d, e, [0, u0, 0], [1, u1, 0], [1, u0, 0]);
  }
  // The projector ring on the floor.
  b.use({ kind: WIRE_KIND.edges, color: colorA, gain: 1.3, fill: 0.5, line: 0.12, bob: 0, spin: [laps(40, 1), phase, 0, 0] });
  addAnnulus(b, r * 0.42, r * 0.5, yBase, 48, 4);
  addAnnulus(b, r * 0.1, r * 0.14, yBase, 24, 24);
}

export function shapeFor(index: number): WireShape {
  return WIRE_SHAPES[index % WIRE_SHAPES.length]!;
}

export function buildWireMesh(objects: readonly Site[]): WireMesh {
  const b = new Builder();
  const shapes: WireShape[] = [];
  for (let i = 0; i < objects.length; i++) {
    const s = objects[i]!;
    const h = hashInts(i, Math.floor(s.seed * 65536));
    const shape = shapeFor(i);
    shapes.push(shape);
    const colorB = partnerColor(s.color, (h >>> 4) % 3);
    // The seed is quantised here so the shader can hash it exactly.
    b.begin([s.x, s.y, s.z], Math.floor(s.seed * 4096), s.w);
    addShape(b, shape, s.w, s.color, colorB, s.seed, h);
    addStage(b, s, s.color, s.seed);
  }
  return {
    vertexCount: b.position.length / 3,
    position: new Float32Array(b.position),
    bary: new Float32Array(b.bary),
    anchor: new Float32Array(b.anchor),
    spin: new Float32Array(b.spin),
    look: new Float32Array(b.look),
    style: new Float32Array(b.style),
    shapes,
  };
}
