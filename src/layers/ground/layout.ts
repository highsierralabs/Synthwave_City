// The ground layout in plain TypeScript (plan T04): the surface classifier, the lamp positions and
// the two meshes, as numbers only. No three and no DOM, so it is unit-tested in node.
//
// The fragment shader in ./shaders.ts derives the same surfaces from the same constants; the GLSL
// defines are generated from GROUND below, so the two cannot drift apart.
import { AVENUE_EVERY, CELL, TILE, roadSpec } from '../../contracts/constants';
import { NEON } from '../../contracts/palette';

/** Numbers the art pass may retune. Metres unless noted. */
export const GROUND = {
  /** Corner radius of the curb line where two roads meet. */
  curbRadius: 3,
  /** Lane markings stop this far outside the cross road's building line. */
  stopGap: 1.6,
  /** Lane dashes: period and lit fraction. The period divides CELL, so the pattern wraps with the tile. */
  dashPeriod: 10,
  dashDuty: 0.35,
  /** Zebra stripe period across the carriageway. */
  zebraPeriod: 1.4,
  /** Sidewalk slab size. */
  slab: 2,
  /** Block-floor and plaza grid pitch, and the spacing of the plaza rings. */
  floorGrid: 8,
  plazaGrid: 8,
  plazaRing: 12,
  /** Lamp pole centre behind the curb, and how far the head reaches back over the road. */
  lampSetback: 0.9,
  lampArm: 2.6,
  /** Head height on streets and on avenues. */
  lampHeightStreet: 7,
  lampHeightAvenue: 9,
  /** Height the post mesh is modelled at; vertices above lampSplit move with the real height. */
  lampModelHeight: 7,
  lampSplit: 3,
  /** Lamp spacing along a road at full density, and at reduced density. Both divide CELL. */
  lampSpacing: 40,
  lampSpacingSparse: 80,
  /** Standard deviation of the pool of light under a lamp. */
  poolSigma: 5,
  /** Posts are drawn only this close to the camera; beyond it a lamp is its glow alone. */
  postFadeStart: 520,
  postFadeEnd: 760,
  /** A pole is never drawn thinner than this many pixels, so it cannot crawl. */
  postMinPixels: 1.1,
  /** Half-size of the glow sprite on a lamp, and the smallest it may get on screen, pixels. */
  spriteSize: 2.2,
  spriteMinPixels: 2,
  /** Palette entries of the lamps on even and odd grid lines. */
  lampColorEven: NEON.orange,
  lampColorOdd: NEON.cyan,
} as const;

/** The lamp layout repeats with this period in x and z: the avenue period, which the colour period divides. */
export const LAMP_PATTERN = CELL * AVENUE_EVERY;
/** How many pattern copies the post lattice spans on each side of the camera. */
export const POST_LATTICE = 2;

export type Surface = 'road' | 'junction' | 'sidewalk' | 'block';

/** Signed distance to a box of half-size (hx, hz) with corner radius r; negative inside. */
export function roundedBox(px: number, pz: number, hx: number, hz: number, r: number): number {
  const qx = Math.abs(px) - hx + r, qz = Math.abs(pz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

export interface AxisFrame {
  /** Index of the cell, unwrapped. */
  readonly cell: number;
  /** Offset inside the cell, 0..CELL. */
  readonly u: number;
  /** Curb positions inside the cell: carriageway below curbLo and above curbHi. */
  readonly curbLo: number;
  readonly curbHi: number;
  /** Building lines inside the cell. */
  readonly blockLo: number;
  readonly blockHi: number;
}

/** One tile coordinate resolved against the two grid lines that bound its cell. */
export function axisFrame(coord: number): AxisFrame {
  const cell = Math.floor(coord / CELL);
  const lo = roadSpec(cell), hi = roadSpec(cell + 1);
  return {
    cell, u: coord - cell * CELL,
    curbLo: lo.roadHalf, curbHi: CELL - hi.roadHalf,
    blockLo: lo.corridorHalf, blockHi: CELL - hi.corridorHalf,
  };
}

/** Signed distance to the curb line of the block that owns (x, z): positive on the carriageway. */
export function curbDistance(x: number, z: number): number {
  const a = axisFrame(x), b = axisFrame(z);
  return roundedBox(
    a.u - (a.curbLo + a.curbHi) / 2, b.u - (b.curbLo + b.curbHi) / 2,
    (a.curbHi - a.curbLo) / 2, (b.curbHi - b.curbLo) / 2, GROUND.curbRadius,
  );
}

/** Signed distance to the building line of the block that owns (x, z): negative inside the block. */
export function blockDistance(x: number, z: number): number {
  const a = axisFrame(x), b = axisFrame(z);
  return roundedBox(
    a.u - (a.blockLo + a.blockHi) / 2, b.u - (b.blockLo + b.blockHi) / 2,
    (a.blockHi - a.blockLo) / 2, (b.blockHi - b.blockLo) / 2, 0,
  );
}

/** What the ground is at a tile position. Works for any coordinate, wrapped or not. */
export function surfaceAt(x: number, z: number): Surface {
  if (curbDistance(x, z) > 0) {
    const lx = Math.round(x / CELL), lz = Math.round(z / CELL);
    const inX = Math.abs(x - lx * CELL) < roadSpec(lx).roadHalf;
    const inZ = Math.abs(z - lz * CELL) < roadSpec(lz).roadHalf;
    return inX && inZ ? 'junction' : 'road';
  }
  return blockDistance(x, z) <= 0 ? 'block' : 'sidewalk';
}

// ---- lamps

/** Floats per lamp: pole base x, z; unit direction towards the road centre x, z; head height; palette index. */
export const LAMP_STRIDE = 6;
export const LAMP = { x: 0, z: 1, dirX: 2, dirZ: 3, height: 4, color: 5 } as const;

/** Lamp spacing for the density of a quality tier (QualitySettings.density). */
export function lampSpacing(density: number): number {
  return density >= 0.8 ? GROUND.lampSpacing : GROUND.lampSpacingSparse;
}

export function lampColor(line: number): number {
  return ((line % 2) + 2) % 2 === 0 ? GROUND.lampColorEven : GROUND.lampColorOdd;
}

/** Lamps in a square of the given side whose corner is the tile origin. extent is a multiple of LAMP_PATTERN. */
export function lampCount(spacing: number, extent: number): number {
  return 2 * 2 * (extent / CELL) * (extent / spacing);
}

/**
 * Every lamp whose road line and position along it fall in [0, extent): pairs facing each other across
 * each road, `spacing` apart, starting half a spacing from the line crossings so none stands in a junction.
 */
export function buildLamps(spacing: number, extent: number): Float32Array {
  const out = new Float32Array(lampCount(spacing, extent) * LAMP_STRIDE);
  let o = 0;
  for (const axis of [0, 1] as const) {
    for (let line = 0; line < extent / CELL; line++) {
      const spec = roadSpec(line);
      const height = spec.median > 0 ? GROUND.lampHeightAvenue : GROUND.lampHeightStreet;
      const color = lampColor(line);
      for (const side of [-1, 1] as const) {
        const fixed = line * CELL + side * (spec.roadHalf + GROUND.lampSetback);
        for (let k = 0; k < extent / spacing; k++) {
          const along = (k + 0.5) * spacing;
          // axis 0: the road runs along x, so the lamp row has a fixed z. axis 1: the reverse.
          out[o + LAMP.x] = axis === 0 ? along : fixed;
          out[o + LAMP.z] = axis === 0 ? fixed : along;
          out[o + LAMP.dirX] = axis === 0 ? 0 : -side;
          out[o + LAMP.dirZ] = axis === 0 ? -side : 0;
          out[o + LAMP.height] = height;
          out[o + LAMP.color] = color;
          o += LAMP_STRIDE;
        }
      }
    }
  }
  return out;
}

/** Where the head of a lamp (and its glow) sits: tile x, height, tile z. */
export function lampHead(lamps: Float32Array, index: number, out: { x: number; y: number; z: number }): void {
  const o = index * LAMP_STRIDE;
  out.x = lamps[o + LAMP.x]! + lamps[o + LAMP.dirX]! * GROUND.lampArm;
  out.y = lamps[o + LAMP.height]! - 0.05;
  out.z = lamps[o + LAMP.z]! + lamps[o + LAMP.dirZ]! * GROUND.lampArm;
}

/** True when every marking and lamp period divides the cell and the tile, so the ground wraps without a seam. */
export function periodsDivideTile(): boolean {
  const inCell = [GROUND.dashPeriod, GROUND.slab, GROUND.lampSpacing, GROUND.lampSpacingSparse];
  return inCell.every((p) => Number.isInteger(CELL / p)) && Number.isInteger(TILE / LAMP_PATTERN);
}

// ---- meshes, as plain arrays

export interface MeshData {
  readonly positions: Float32Array;
  readonly indices: Uint16Array;
  /** One float per vertex: 0 for unlit parts, 1 for the lamp head. */
  readonly parts: Float32Array;
}

/**
 * The ground: a flat disc of rings whose radius doubles, centred under the camera. Small triangles
 * near the viewer keep the interpolated position exact where a pixel covers millimetres.
 */
export function buildDisc(outerRadius: number, segments = 48, firstRing = 2): MeshData {
  const radii: number[] = [];
  for (let r = firstRing; r < outerRadius * 0.75; r *= 2) radii.push(r);
  radii.push(outerRadius);
  const positions = new Float32Array((1 + radii.length * segments) * 3);
  const indices: number[] = [];
  for (let j = 0; j < radii.length; j++) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const o = (1 + j * segments + i) * 3;
      positions[o] = Math.cos(a) * radii[j]!;
      positions[o + 2] = Math.sin(a) * radii[j]!;
    }
  }
  for (let i = 0; i < segments; i++) {
    const n = (i + 1) % segments;
    // Wound so the faces look up (+y).
    indices.push(0, 1 + n, 1 + i);
    for (let j = 0; j + 1 < radii.length; j++) {
      const a = 1 + j * segments + i, b = 1 + j * segments + n;
      const c = a + segments, d = b + segments;
      indices.push(a, b, d, a, d, c);
    }
  }
  return { positions, indices: new Uint16Array(indices), parts: new Float32Array(positions.length / 3) };
}

/**
 * One lamp post in its own frame: +x points at the road, +y is up. A tapered pole that bends into an
 * arm (part 0) and a flat head at the end of it (part 1).
 */
export function buildPost(): MeshData & { readonly axes: Float32Array } {
  const h = GROUND.lampModelHeight, arm = GROUND.lampArm;
  const s = Math.SQRT1_2;
  // Each ring: centre, radius, and the two axes that span it.
  const rings: readonly (readonly [number, number, number, number, number, number, number, number, number, number])[] = [
    [0, 0, 0, 0.17, 1, 0, 0, 0, 0, 1],
    [0, h - 0.9, 0, 0.1, 1, 0, 0, 0, 0, 1],
    [0.5, h - 0.12, 0, 0.08, -s, s, 0, 0, 0, 1],
    [arm - 0.5, h, 0, 0.07, 0, 1, 0, 0, 0, 1],
  ];
  const positions: number[] = [];
  const parts: number[] = [];
  // For each vertex, the point on the centre line of the pole it belongs to (the vertex itself on the head).
  const axes: number[] = [];
  const indices: number[] = [];
  for (const [cx, cy, cz, r, ax, ay, az, bx, by, bz] of rings) {
    for (const [ka, kb] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      positions.push(cx + (ax * ka + bx * kb) * r, cy + (ay * ka + by * kb) * r, cz + (az * ka + bz * kb) * r);
      parts.push(0);
      axes.push(cx, cy, cz);
    }
  }
  for (let j = 0; j + 1 < rings.length; j++) {
    for (let i = 0; i < 4; i++) {
      const a = j * 4 + i, b = j * 4 + ((i + 1) % 4);
      indices.push(a, b, b + 4, a, b + 4, a + 4);
    }
  }
  // The head: a flat box at the end of the arm.
  const base = positions.length / 3;
  const hx = 0.62, hy = 0.09, hz = 0.2, y = h - 0.02;
  for (let i = 0; i < 8; i++) {
    positions.push(arm + (i & 1 ? hx : -hx), y + (i & 2 ? hy : -hy), i & 4 ? hz : -hz);
    parts.push(1);
    axes.push(arm + (i & 1 ? hx : -hx), y + (i & 2 ? hy : -hy), i & 4 ? hz : -hz);
  }
  const quads: readonly (readonly [number, number, number, number])[] = [
    [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
  ];
  for (const [a, b, c, d] of quads) indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
  return {
    positions: new Float32Array(positions), indices: new Uint16Array(indices), parts: new Float32Array(parts),
    axes: new Float32Array(axes),
  };
}
