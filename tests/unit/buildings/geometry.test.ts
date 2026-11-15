import { describe, expect, it } from 'vitest';
import { FACE_TOP, unitBox, unitCylinder, type ShapeData } from '../../../src/layers/buildings/geometry';

type Vec3 = [number, number, number];
const at = (a: Float32Array, i: number): Vec3 => [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function triangles(shape: ShapeData): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < shape.index.length; i += 3) out.push([shape.index[i]!, shape.index[i + 1]!, shape.index[i + 2]!]);
  return out;
}

function checkShape(shape: ShapeData): void {
  const vertices = shape.position.length / 3;
  expect(shape.normal.length).toBe(vertices * 3);
  expect(shape.face.length).toBe(vertices * 3);
  expect(shape.index.length % 3).toBe(0);
  for (let i = 0; i < vertices; i++) {
    const [x, y, z] = at(shape.position, i);
    expect(Math.abs(x)).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(Math.abs(z)).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
    const [, u, v] = at(shape.face, i);
    expect(u).toBeGreaterThanOrEqual(-1e-6);
    expect(u).toBeLessThanOrEqual(1 + 1e-6);
    expect(v).toBeGreaterThanOrEqual(-1e-6);
    expect(v).toBeLessThanOrEqual(1 + 1e-6);
  }
  for (const [a, b, c] of triangles(shape)) {
    expect(Math.max(a, b, c)).toBeLessThan(vertices);
    // Counter-clockwise seen from outside: the geometric normal agrees with the stored one.
    const n = cross(sub(at(shape.position, b), at(shape.position, a)), sub(at(shape.position, c), at(shape.position, a)));
    expect(Math.hypot(...n)).toBeGreaterThan(1e-6);
    for (const i of [a, b, c]) expect(dot(n, at(shape.normal, i))).toBeGreaterThan(0);
    // The fragment shader reads per-face values as flat varyings: a triangle never spans two faces.
    const face = shape.face[a * 3]!;
    expect(shape.face[b * 3]).toBe(face);
    expect(shape.face[c * 3]).toBe(face);
  }
}

describe('buildings: unit box', () => {
  const box = unitBox();

  it('has four side faces and a top, and no bottom', () => {
    expect(box.position.length / 3).toBe(20);
    expect(box.index.length).toBe(30);
    for (let i = 0; i < 20; i++) expect(box.normal[i * 3 + 1]).toBeGreaterThanOrEqual(0);
    checkShape(box);
  });

  it('runs u left to right as seen from outside, and v up, on every side face', () => {
    for (const [a, b, c] of triangles(box)) {
      if (box.face[a * 3] === FACE_TOP) continue;
      const n = at(box.normal, a);
      const right: Vec3 = [n[2], 0, -n[0]];
      for (const [i, j] of [[a, b], [b, c], [c, a]] as const) {
        const d = sub(at(box.position, j), at(box.position, i));
        const du = box.face[j * 3 + 1]! - box.face[i * 3 + 1]!;
        const dv = box.face[j * 3 + 2]! - box.face[i * 3 + 2]!;
        expect(dot(d, right)).toBeCloseTo(du, 6);
        expect(d[1]).toBeCloseTo(dv, 6);
      }
    }
  });

  it('maps the top face to x and z', () => {
    for (let i = 0; i < 20; i++) {
      if (box.face[i * 3] !== FACE_TOP) continue;
      const [x, y, z] = at(box.position, i);
      expect(y).toBe(1);
      expect(box.face[i * 3 + 1]).toBeCloseTo(x + 0.5, 6);
      expect(box.face[i * 3 + 2]).toBeCloseTo(z + 0.5, 6);
    }
  });
});

describe('buildings: unit cylinder', () => {
  const segments = 28;
  const cyl = unitCylinder(segments);

  it('has a closed wall and a cap', () => {
    expect(cyl.index.length).toBe(segments * 9);
    checkShape(cyl);
  });

  it('unrolls the wall: u falls from 1 to 0 once round, with the seam duplicated', () => {
    const wall: number[] = [];
    for (let i = 0; i < cyl.position.length / 3; i++) if (cyl.face[i * 3] !== FACE_TOP) wall.push(i);
    expect(wall.length).toBe((segments + 1) * 2);
    const us = wall.map((i) => cyl.face[i * 3 + 1]!);
    expect(Math.max(...us)).toBeCloseTo(1, 6);
    expect(Math.min(...us)).toBeCloseTo(0, 6);
    // No wall triangle spans more than one segment in u, so nothing wraps inside a triangle.
    for (const [a, b, c] of triangles(cyl)) {
      if (cyl.face[a * 3] === FACE_TOP) continue;
      const u = [a, b, c].map((i) => cyl.face[i * 3 + 1]!);
      expect(Math.max(...u) - Math.min(...u)).toBeLessThanOrEqual(1 / segments + 1e-6);
    }
    // Every wall vertex lies on the radius-0.5 circle and its normal points straight out.
    for (const i of wall) {
      const [x, , z] = at(cyl.position, i);
      expect(Math.hypot(x, z)).toBeCloseTo(0.5, 6);
      expect(cyl.normal[i * 3]).toBeCloseTo(x * 2, 6);
      expect(cyl.normal[i * 3 + 2]).toBeCloseTo(z * 2, 6);
    }
  });
});
