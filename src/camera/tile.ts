// Tile wrapping for camera positions.
import { TILE } from '../contracts/constants';
import { wrap } from '../core/math';

/**
 * v wrapped into [0, TILE). core's wrap() adds the period to a negative remainder, and for a
 * remainder as small as -1e-13 that sum rounds to TILE itself; this folds that one value to 0.
 */
export function wrapTile(v: number): number {
  const r = wrap(v, TILE);
  return r >= TILE ? 0 : r;
}
