// The city plan (architecture.md section 4.5): pure data that every layer reads.
// Coordinates are tile coordinates: x and z in 0..TILE, y up, road surface at y = 0.

export const DISTRICT = { lowrise: 0, midtown: 1, downtown: 2, plaza: 3, mega: 4 } as const;
export type District = (typeof DISTRICT)[keyof typeof DISTRICT];

/** Bytes per cell in CityPlan.cells, and their meaning. Index of cell (cx, cz) is (cz * CELLS + cx) * CELL_STRIDE. */
export const CELL_STRIDE = 4;
export const CELL_FIELD = {
  /** A DISTRICT value. */
  district: 0,
  /** Primary palette index for the cell, 0..7. */
  palette: 1,
  /** Tallest box in the cell, in units of CELL_HEIGHT_UNIT metres, capped at 255. */
  height: 2,
  /** A random byte, fixed per cell. */
  seed: 3,
} as const;
export const CELL_HEIGHT_UNIT = 4;

/** Floats per box in CityPlan.boxes, and their offsets. */
export const BOX_STRIDE = 12;
export const BOX = {
  /** Centre x, base y, centre z. */
  cx: 0, y0: 1, cz: 2,
  /** Full size along x, y, z. */
  sx: 3, sy: 4, sz: 5,
  /** A BOX_STYLE value. */
  style: 6,
  /** Two palette indices, 0..7: main trim colour and accent. */
  colorA: 7, colorB: 8,
  /** Random number in 0..1, fixed per box. */
  seed: 9,
  /** Bitwise OR of BOX_FLAG values. */
  flags: 10,
  /** Index of the building this box belongs to. */
  building: 11,
} as const;

export const BOX_STYLE = {
  /** Wide base with shop fronts. */
  podium: 0,
  /** Punched-window tower shaft. */
  shaft: 1,
  /** Curtain-glass tower. */
  glass: 2,
  /** Horizontal ribbon windows. */
  slab: 3,
  /** Vertical-strip tower. */
  strip: 4,
  /** Lit cap on top of a tower. */
  crown: 5,
  /** Thin mast. */
  spire: 6,
  /** Megatower segment. */
  mega: 7,
  /** Low plaza kiosk or pavilion. */
  kiosk: 8,
} as const;
export type BoxStyle = (typeof BOX_STYLE)[keyof typeof BOX_STYLE];

export const BOX_FLAG = {
  /** Top of its stack: the roof is exposed. */
  roof: 1,
  /** Bottom of its stack: it meets the street. */
  street: 2,
  /** Draw as a cylinder inscribed in the box. */
  round: 4,
  /** Part of a megatower. */
  landmark: 8,
} as const;

export type LaneKind = 'street' | 'avenue' | 'sky';

export interface Lane {
  readonly kind: LaneKind;
  /** 0: the lane runs along x (z is fixed). 1: it runs along z (x is fixed). */
  readonly axis: 0 | 1;
  /** The constant coordinate, tile metres. */
  readonly fixed: number;
  /** Height of the lane: 0 for ground lanes, the altitude for sky lanes. */
  readonly y: number;
  /** +1 travels towards increasing coordinate, -1 towards decreasing. */
  readonly dir: 1 | -1;
  /** Grid line this lane belongs to, 0..CELLS-1. */
  readonly line: number;
  /** Position among its direction's lanes, 0 nearest the centre line. */
  readonly slot: number;
}

export type SiteKind = 'holoPanel' | 'holoObject' | 'searchlight' | 'pillar' | 'laser' | 'roofLight' | 'ticker';

/**
 * A typed anchor. What the size fields mean depends on kind:
 *  holoPanel   x,y,z centre; w by h panel; yaw is the facing direction.
 *  holoObject  x,y,z centre; w radius.
 *  searchlight x,y,z emitter; w beam length; h number of beams (1..3).
 *  pillar      x,y,z base; w radius; h height.
 *  laser       x,y,z emitter; w beam length; h number of beams in the fan.
 *  roofLight   x,y,z light position; w size.
 *  ticker      x,y,z centre of a rectangular ring; w and d half-extents along x and z; h band height.
 */
export interface Site {
  readonly kind: SiteKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly d: number;
  /** Radians about +y. 0 faces -z; positive turns towards -x. */
  readonly yaw: number;
  /** Palette index, 0..7. */
  readonly color: number;
  /** Random number in 0..1, fixed per site. */
  readonly seed: number;
}

export type LandmarkKind = 'megatower' | 'plaza' | 'downtown';

export interface Landmark {
  readonly kind: LandmarkKind;
  /** Centre, tile metres. */
  readonly x: number;
  readonly z: number;
  /** Height of the tallest structure there (0 for a plaza). */
  readonly height: number;
  readonly cellX: number;
  readonly cellZ: number;
}

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

export interface CityPlan {
  readonly seed: number;
  /** CELLS * CELLS * CELL_STRIDE bytes; see CELL_FIELD. Uploaded by the engine as uCellTex. */
  readonly cells: Uint8Array;
  readonly boxCount: number;
  /** boxCount * BOX_STRIDE floats; see BOX. */
  readonly boxes: Float32Array;
  readonly buildingCount: number;
  readonly lanes: readonly Lane[];
  readonly sites: readonly Site[];
  /** Megatowers first (tallest first), then plazas, then the densest downtown cell. */
  readonly landmarks: readonly Landmark[];
  /** Top of the tallest box covering (x, z), or 0. Wrap-aware. */
  heightAt(x: number, z: number): number;
  /**
   * Push a sphere out of every box it touches, and keep it above the road. Wrap-aware.
   * Mutates pos; returns true if it moved.
   */
  collide(pos: MutableVec3, radius: number): boolean;
}
