// Unit shapes for the buildings layer, as plain arrays (plan T05, M1). No three.
//
// Both shapes sit on y = 0, are one unit tall and one unit across, and have no bottom: the bottom of
// a box is always on the street or on the roof of the box below. Every vertex carries `face`:
//   x  face id: 0 +x, 1 -x, 2 +z, 3 -z for the side faces (the cylinder wall is 0), 4 for the top
//   y  u across the face, 0..1, running left to right as seen from outside
//   z  v up the face, 0..1 (on the top: u is x + 0.5 and v is z + 0.5)
// Triangles wind counter-clockwise seen from outside.

export interface ShapeData {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly face: Float32Array;
  readonly index: Uint16Array;
}

export const FACE_TOP = 4;

/** Outward normals (x, z) of the four side faces, in face-id order. */
const SIDE_NORMALS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CORNERS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function unitBox(): ShapeData {
  const position: number[] = [];
  const normal: number[] = [];
  const face: number[] = [];
  const index: number[] = [];
  for (let f = 0; f < 4; f++) {
    const [nx, nz] = SIDE_NORMALS[f]!;
    // Direction of increasing u: to the right for a viewer looking at the face from outside.
    const tx = nz, tz = -nx;
    const base = position.length / 3;
    for (const [u, v] of CORNERS) {
      position.push(0.5 * nx + (u - 0.5) * tx, v, 0.5 * nz + (u - 0.5) * tz);
      normal.push(nx, 0, nz);
      face.push(f, u, v);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const base = position.length / 3;
  for (const [u, v] of CORNERS) {
    position.push(u - 0.5, 1, v - 0.5);
    normal.push(0, 1, 0);
    face.push(FACE_TOP, u, v);
  }
  index.push(base, base + 3, base + 2, base, base + 2, base + 1);
  return {
    position: new Float32Array(position), normal: new Float32Array(normal),
    face: new Float32Array(face), index: new Uint16Array(index),
  };
}

export function unitCylinder(segments: number): ShapeData {
  const position: number[] = [];
  const normal: number[] = [];
  const face: number[] = [];
  const index: number[] = [];
  // Wall. The seam column is duplicated so u runs from 1 down to 0 without wrapping inside a triangle.
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (let v = 0; v <= 1; v++) {
      position.push(0.5 * c, v, 0.5 * s);
      normal.push(c, 0, s);
      face.push(0, 1 - i / segments, v);
    }
  }
  for (let i = 0; i < segments; i++) {
    const b0 = i * 2, t0 = b0 + 1, b1 = b0 + 2, t1 = b0 + 3;
    index.push(b0, t1, b1, b0, t0, t1);
  }
  // Cap: a fan round a centre vertex.
  const centre = position.length / 3;
  position.push(0, 1, 0);
  normal.push(0, 1, 0);
  face.push(FACE_TOP, 0.5, 0.5);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    position.push(0.5 * c, 1, 0.5 * s);
    normal.push(0, 1, 0);
    face.push(FACE_TOP, 0.5 + 0.5 * c, 0.5 + 0.5 * s);
  }
  for (let i = 0; i < segments; i++) index.push(centre, centre + 2 + i, centre + 1 + i);
  return {
    position: new Float32Array(position), normal: new Float32Array(normal),
    face: new Float32Array(face), index: new Uint16Array(index),
  };
}
