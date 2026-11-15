// The city plan (architecture.md section 4.5): a seed in, pure data out.
import { CELL_FIELD, CELL_HEIGHT_UNIT, CELL_STRIDE, type CityPlan, type Landmark, type MutableVec3 } from '../contracts/city';
import { CELL, CELLS } from '../contracts/constants';
import { createRng } from '../core/random';
import { buildDistricts } from './districts';
import { buildLanes } from './lanes';
import { blockRect, buildMassing } from './massing';
import { buildBoxIndex, collide, heightAt } from './queries';
import { buildSites } from './sites';
import { DISTRICT } from '../contracts/city';

export function createCityPlan(seed: number): CityPlan {
  const rng = createRng(seed);
  const map = buildDistricts(seed, rng.fork(1));
  const massing = buildMassing(rng.fork(2), map);
  const index = buildBoxIndex(massing.boxes, massing.boxCount);
  const sites = buildSites(rng.fork(3), map, massing.buildings, massing.boxes, index);
  const lanes = buildLanes();

  const centre = (i: number): { x: number; z: number; cellX: number; cellZ: number } => {
    const cellX = i % CELLS, cellZ = Math.floor(i / CELLS);
    return { x: (cellX + 0.5) * CELL, z: (cellZ + 0.5) * CELL, cellX, cellZ };
  };
  const megas: Landmark[] = massing.buildings
    .filter((b) => b.district === DISTRICT.mega)
    .map((b) => ({ kind: 'megatower' as const, ...centre(b.cell), x: b.x, z: b.z, height: b.spireTop }))
    .sort((a, b) => b.height - a.height);
  const plazas: Landmark[] = map.plazaCells.map((i) => {
    const c = centre(i);
    const rect = blockRect(c.cellX, c.cellZ);
    return { kind: 'plaza' as const, ...c, x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, height: 0 };
  });
  const downtown: Landmark = {
    kind: 'downtown',
    ...centre(map.peakCell),
    height: map.cells[map.peakCell * CELL_STRIDE + CELL_FIELD.height]! * CELL_HEIGHT_UNIT,
  };

  const { boxes, boxCount } = massing;
  return {
    seed,
    cells: map.cells,
    boxCount,
    boxes,
    buildingCount: massing.buildings.length,
    lanes,
    sites,
    landmarks: [...megas, ...plazas, downtown],
    heightAt: (x: number, z: number): number => heightAt(boxes, index, x, z),
    collide: (pos: MutableVec3, radius: number): boolean => collide(boxes, index, pos, radius),
  };
}
