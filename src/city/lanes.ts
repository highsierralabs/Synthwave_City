// Traffic lanes (plan T01, M3): ground lanes on every road, sky lanes above the avenues.
import type { Lane } from '../contracts/city';
import {
  CELL, CELLS, SKY_LANE_OFFSET, SKY_LANE_Y_X, SKY_LANE_Y_Z, TILE, isAvenue, roadSpec,
} from '../contracts/constants';
import { wrap } from '../core/math';

/**
 * Traffic keeps right. With y up, the right of +x travel is +z, and the right of +z travel is -x.
 * Returns the fixed coordinate of a lane `offset` metres to the right of the centre line.
 */
export function laneCoordinate(axis: 0 | 1, line: number, dir: 1 | -1, offset: number): number {
  const side = axis === 0 ? dir : -dir;
  return wrap(line * CELL + side * offset, TILE);
}

export function buildLanes(): Lane[] {
  const lanes: Lane[] = [];
  for (const axis of [0, 1] as const) {
    for (let line = 0; line < CELLS; line++) {
      const spec = roadSpec(line);
      const kind = isAvenue(line) ? 'avenue' : 'street';
      for (let slot = 0; slot < spec.lanes.length; slot++) {
        for (const dir of [1, -1] as const) {
          lanes.push({ kind, axis, fixed: laneCoordinate(axis, line, dir, spec.lanes[slot]!), y: 0, dir, line, slot });
        }
      }
      if (!isAvenue(line)) continue;
      const altitudes = axis === 0 ? SKY_LANE_Y_X : SKY_LANE_Y_Z;
      for (let slot = 0; slot < altitudes.length; slot++) {
        for (const dir of [1, -1] as const) {
          lanes.push({ kind: 'sky', axis, fixed: laneCoordinate(axis, line, dir, SKY_LANE_OFFSET), y: altitudes[slot]!, dir, line, slot });
        }
      }
    }
  }
  return lanes;
}
