// A stand-in city plan for the harness, used only when src/city does not exist yet.
// One or two plain boxes per cell, no lanes, no sites. Deterministic.
import {
  BOX, BOX_FLAG, BOX_STRIDE, BOX_STYLE, CELL_FIELD, CELL_HEIGHT_UNIT, CELL_STRIDE, DISTRICT,
  type CityPlan, type MutableVec3,
} from '../src/contracts/city';
import { CELL, CELLS, TILE, roadSpec } from '../src/contracts/constants';
import { hashUnit } from '../src/core/random';

export function createFixturePlan(seed: number): CityPlan {
  const cells = new Uint8Array(CELLS * CELLS * CELL_STRIDE);
  const boxes: number[] = [];
  let building = 0;
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const dx = Math.min(Math.abs(cx - 20), CELLS - Math.abs(cx - 20));
      const dz = Math.min(Math.abs(cz - 20), CELLS - Math.abs(cz - 20));
      const centre = Math.exp(-(dx * dx + dz * dz) / 60);
      const h = 20 + 420 * centre * hashUnit(seed, cx, cz, 1) + 60 * hashUnit(seed, cx, cz, 2);
      const x0 = cx * CELL + roadSpec(cx).corridorHalf;
      const x1 = (cx + 1) * CELL - roadSpec(cx + 1).corridorHalf;
      const z0 = cz * CELL + roadSpec(cz).corridorHalf;
      const z1 = (cz + 1) * CELL - roadSpec(cz + 1).corridorHalf;
      const inset = 6 + 30 * hashUnit(seed, cx, cz, 3);
      boxes.push(
        (x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0 - inset * 2, h, z1 - z0 - inset * 2,
        BOX_STYLE.shaft, Math.floor(hashUnit(seed, cx, cz, 4) * 8), Math.floor(hashUnit(seed, cx, cz, 5) * 8),
        hashUnit(seed, cx, cz, 6), BOX_FLAG.roof | BOX_FLAG.street, building++,
      );
      const i = (cz * CELLS + cx) * CELL_STRIDE;
      cells[i + CELL_FIELD.district] = centre > 0.4 ? DISTRICT.downtown : DISTRICT.midtown;
      cells[i + CELL_FIELD.palette] = Math.floor(hashUnit(seed, cx, cz, 7) * 8);
      cells[i + CELL_FIELD.height] = Math.min(255, Math.round(h / CELL_HEIGHT_UNIT));
      cells[i + CELL_FIELD.seed] = Math.floor(hashUnit(seed, cx, cz, 8) * 256);
    }
  }
  const data = new Float32Array(boxes);
  return {
    seed,
    cells,
    boxCount: data.length / BOX_STRIDE,
    boxes: data,
    buildingCount: building,
    lanes: [],
    sites: [],
    landmarks: [{ kind: 'downtown', x: TILE / 2, z: TILE / 2, height: data[20 * CELLS * BOX_STRIDE + 20 * BOX_STRIDE + BOX.sy] ?? 300, cellX: 20, cellZ: 20 }],
    heightAt: () => 0,
    collide(pos: MutableVec3, radius: number): boolean {
      if (pos.y < radius) {
        pos.y = radius;
        return true;
      }
      return false;
    },
  };
}
