// World, time and render constants shared by every module (architecture.md sections 4 and 5).
// The GLSL chunk in ./glsl.ts mirrors the world values; tests/unit/contracts keeps them equal.

/** Side of the repeating city tile, metres. */
export const TILE = 6400;
export const HALF_TILE = TILE / 2;
/** Side of one grid cell (block plus half a road on each side), metres. */
export const CELL = 160;
/** Cells per tile side. Also the number of grid lines per axis. */
export const CELLS = TILE / CELL;

/** Every AVENUE_EVERY-th grid line is an avenue. CELLS is a multiple of it, so the pattern wraps. */
export const AVENUE_EVERY = 4;

export interface RoadSpec {
  /** Centre line to building line. */
  readonly corridorHalf: number;
  /** Centre line to curb. */
  readonly roadHalf: number;
  /** Lane centre offsets from the centre line, one direction. */
  readonly lanes: readonly number[];
  /** Half-width of the central median (0 for none). */
  readonly median: number;
  readonly sidewalk: number;
}

export const STREET: RoadSpec = { corridorHalf: 12, roadHalf: 8, lanes: [2, 6], median: 0, sidewalk: 4 };
export const AVENUE: RoadSpec = { corridorHalf: 20, roadHalf: 14, lanes: [4, 8, 12], median: 2, sidewalk: 6 };

/** Grid line index (any integer; wrapped here) to avenue or street. */
export function isAvenue(line: number): boolean {
  return (((line % CELLS) + CELLS) % CELLS) % AVENUE_EVERY === 0;
}
export function roadSpec(line: number): RoadSpec {
  return isAvenue(line) ? AVENUE : STREET;
}

/** Sky-lane altitudes above avenues. Lanes along x and along z never share an altitude. */
export const SKY_LANE_Y_X: readonly number[] = [90, 170, 260, 360];
export const SKY_LANE_Y_Z: readonly number[] = [130, 215, 310, 410];
/** Lateral offset of each sky-lane direction from the avenue centre line. */
export const SKY_LANE_OFFSET = 9;
/** Largest sideways weave a craft may add to its lane, so streams stay inside the corridor. */
export const SKY_LANE_MAX_WEAVE = 6;

/** Time wraps at this many seconds; every lane motion is periodic over it (section 4.3). */
export const LOOP_SECONDS = 4096;
/** Tempo. LOOP_SECONDS * BPM / 60 is a whole number of beats (7168). */
export const BPM = 105;
export const BEATS_PER_LOOP = (LOOP_SECONDS * BPM) / 60;

export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 14000;
export const CAMERA_FOV = 62;

/** renderOrder bands (section 5.5). */
export const RENDER_ORDER = { opaque: 0, sky: 50, beams: 100, holograms: 200, sprites: 300 } as const;

/** three.js layer for objects that must not appear in the reflection pass. */
export const SC_LAYER_NO_REFLECT = 1;
