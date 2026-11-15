// The one vehicle mesh (plan T06, M1), built in code. Pure arrays, no three.
//
// Frame: x forward, y up, z to the driver's right (right-handed, so a turn about y maps it into the
// world without mirroring). Every vertex carries two shapes: `position` is the wedge-shaped car and
// `alt` is a van, which the vertex shader also stretches into a bus. Parts: 0 body, 1 cabin, 2 wheels.
// Faces are flat-shaded in the fragment shader from derivatives, so no normals are stored.

export interface CarMesh {
  readonly position: Float32Array;
  readonly alt: Float32Array;
  readonly part: Float32Array;
  readonly index: Uint16Array;
  readonly vertices: number;
  readonly triangles: number;
}

type V3 = readonly [number, number, number];

/** Half length, height and half width of the two stored shapes, metres. */
export const CAR_DIMS: V3 = [2.25, 1.26, 0.95];
export const VAN_DIMS: V3 = [2.7, 2.1, 1.02];
/** A bus is the van stretched by this much along x, y and z. */
export const BUS_SCALE: V3 = [2.13, 1.48, 1.24];
/** Underside of the body, metres above the road. */
export const CAR_FLOOR = 0.2;
export const VAN_FLOOR = 0.3;
/** Wheel centres along x (front, rear) and wheel radius, for the two shapes. */
export const CAR_AXLES: V3 = [1.42, -1.38, 0.34];
export const VAN_AXLES: V3 = [1.75, -1.75, 0.36];

interface Part {
  id: number;
  car: V3[];
  alt: V3[];
  /** Convex polygons, as indices into this part's vertices. */
  faces: number[][];
}

/** A prism: a side profile in (x, y), extruded to z = -halfWidth and +halfWidth. */
function prism(id: number, car: readonly (readonly [number, number])[], carHalf: number, alt: readonly (readonly [number, number])[], altHalf: number): Part {
  const n = car.length;
  const part: Part = { id, car: [], alt: [], faces: [] };
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      part.car.push([car[i]![0], car[i]![1], s * carHalf]);
      part.alt.push([alt[i]![0], alt[i]![1], s * altHalf]);
    }
  }
  const ring = Array.from({ length: n }, (_, i) => i);
  part.faces.push(ring, ring.map((i) => i + n));
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    part.faces.push([i, next, n + next, n + i]);
  }
  return part;
}

/** A frustum: a base rectangle and a smaller roof rectangle. No floor. */
function frustum(
  id: number,
  car: { x0: number; x1: number; y0: number; w0: number; x2: number; x3: number; y1: number; w1: number },
  alt: { x0: number; x1: number; y0: number; w0: number; x2: number; x3: number; y1: number; w1: number },
): Part {
  const verts = (s: typeof car): V3[] => [
    [s.x0, s.y0, -s.w0], [s.x1, s.y0, -s.w0], [s.x1, s.y0, s.w0], [s.x0, s.y0, s.w0],
    [s.x2, s.y1, -s.w1], [s.x3, s.y1, -s.w1], [s.x3, s.y1, s.w1], [s.x2, s.y1, s.w1],
  ];
  return {
    id, car: verts(car), alt: verts(alt),
    faces: [[4, 5, 6, 7], [1, 2, 6, 5], [0, 3, 7, 4], [0, 1, 5, 4], [3, 2, 6, 7]],
  };
}

/** An axle: a box as wide as the vehicle standing on the road. Only its four walls are drawn. */
function axle(id: number, carX: number, carR: number, carHalf: number, altX: number, altR: number, altHalf: number): Part {
  const verts = (x: number, r: number, w: number): V3[] => [
    [x - r, 0, -w], [x + r, 0, -w], [x + r, 0, w], [x - r, 0, w],
    [x - r, 2 * r, -w], [x + r, 2 * r, -w], [x + r, 2 * r, w], [x - r, 2 * r, w],
  ];
  return {
    id, car: verts(carX, carR, carHalf), alt: verts(altX, altR, altHalf),
    faces: [[1, 2, 6, 5], [0, 3, 7, 4], [0, 1, 5, 4], [3, 2, 6, 7]],
  };
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function centroid(points: readonly V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (const p of points) {
    x += p[0]; y += p[1]; z += p[2];
  }
  return [x / points.length, y / points.length, z / points.length];
}

export function buildCarMesh(): CarMesh {
  const [carL, carH, carW] = CAR_DIMS;
  const [vanL, vanH, vanW] = VAN_DIMS;
  const parts: Part[] = [
    // Body: tail, deck, cowl, nose, and back along the floor.
    prism(
      0,
      [[-carL, CAR_FLOOR], [-carL, 0.86], [0.9, 0.74], [carL, 0.5], [carL, CAR_FLOOR]], carW,
      [[-vanL, VAN_FLOOR], [-vanL, 1.2], [1.5, 1.2], [vanL, 1.05], [vanL, VAN_FLOOR]], vanW,
    ),
    // Cabin: raked screens on the car, a tall box with a sloped windscreen on the van.
    frustum(
      1,
      { x0: -1.75, x1: 1.0, y0: 0.7, w0: 0.86, x2: -1.0, x3: 0.1, y1: carH, w1: 0.66 },
      { x0: -2.66, x1: 2.35, y0: 1.18, w0: 1.0, x2: -2.6, x3: 1.55, y1: vanH, w1: 0.93 },
    ),
    axle(2, CAR_AXLES[0], CAR_AXLES[2], carW + 0.03, VAN_AXLES[0], VAN_AXLES[2], vanW + 0.03),
    axle(2, CAR_AXLES[1], CAR_AXLES[2], carW + 0.03, VAN_AXLES[1], VAN_AXLES[2], vanW + 0.03),
  ];

  const position: number[] = [];
  const alt: number[] = [];
  const partId: number[] = [];
  const index: number[] = [];
  for (const part of parts) {
    const base = position.length / 3;
    const centre = centroid(part.car);
    for (let i = 0; i < part.car.length; i++) {
      position.push(...part.car[i]!);
      alt.push(...part.alt[i]!);
      partId.push(part.id);
    }
    for (const face of part.faces) {
      // Fan each polygon, wound counter-clockwise seen from outside the part.
      for (let i = 1; i + 1 < face.length; i++) {
        const a = part.car[face[0]!]!, b = part.car[face[i]!]!, c = part.car[face[i + 1]!]!;
        const outward = dot(cross(sub(b, a), sub(c, a)), sub(a, centre)) > 0;
        index.push(base + face[0]!, base + face[outward ? i : i + 1]!, base + face[outward ? i + 1 : i]!);
      }
    }
  }
  return {
    position: new Float32Array(position),
    alt: new Float32Array(alt),
    part: new Float32Array(partId),
    index: new Uint16Array(index),
    vertices: position.length / 3,
    triangles: index.length / 3,
  };
}
