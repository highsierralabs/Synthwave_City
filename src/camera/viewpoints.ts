// The six viewpoints (plan T11, M3), derived from the plan's landmarks. Every one but the rooftop
// stands in the air above a road, which is free at every height (architecture.md section 4.4).
import type { CameraPose } from '../contracts/camera';
import type { CityPlan, Landmark, MutableVec3 } from '../contracts/city';
import { AVENUE_EVERY, CAMERA_FOV, CELL, CELLS, TILE } from '../contracts/constants';
import { wrapDelta } from '../core/math';
import { CAMERA_RADIUS } from './flight';
import { wrapTile } from './tile';

export interface Viewpoint {
  readonly name: string;
  readonly pose: CameraPose;
}

/** Yaw that looks from (x, z) towards (tx, tz), by the shortest way round the tile. */
export function yawTowards(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-wrapDelta(tx, x, TILE), -wrapDelta(tz, z, TILE));
}

function pose(x: number, y: number, z: number, yaw: number, pitch: number): CameraPose {
  return { x: wrapTile(x), y, z: wrapTile(z), yaw, pitch, roll: 0, fov: CAMERA_FOV };
}

/**
 * A place to stand on the tallest flat roof of a cell, three metres back from its edge on the sun's
 * side, or null if the cell has no roof wide enough.
 */
function rooftop(plan: CityPlan, cellX: number, cellZ: number): { x: number; y: number; z: number } | null {
  const x0 = cellX * CELL, z0 = cellZ * CELL;
  let best = 0, bx = 0, bz = 0;
  for (let gz = 6; gz < CELL; gz += 6) {
    for (let gx = 6; gx < CELL; gx += 6) {
      const x = x0 + gx, z = z0 + gz;
      const h = plan.heightAt(x, z);
      if (h <= best) continue;
      // Flat for five metres each way: a roof, not a spire or a ledge.
      if (plan.heightAt(x - 5, z) !== h || plan.heightAt(x + 5, z) !== h) continue;
      if (plan.heightAt(x, z - 5) !== h || plan.heightAt(x, z + 5) !== h) continue;
      best = h;
      bx = x;
      bz = z;
    }
  }
  if (best <= 0) return null;
  // Walk towards the sun (-z) to the edge of that roof.
  let edge = bz;
  while (edge > z0 && plan.heightAt(bx, edge - 1) === best) edge -= 1;
  return { x: bx, y: best + 2.4, z: Math.min(bz, edge + 3) };
}

export function computeViewpoints(plan: CityPlan): Viewpoint[] {
  const fallback: Landmark = { kind: 'downtown', x: TILE / 2, z: TILE / 2, height: 300, cellX: CELLS / 2, cellZ: CELLS / 2 };
  const downtown = plan.landmarks.find((l) => l.kind === 'downtown') ?? fallback;
  const mega = plan.landmarks.find((l) => l.kind === 'megatower') ?? downtown;
  // The plaza nearest downtown, so the view has towers behind it.
  let plaza = downtown;
  let nearest = Infinity;
  for (const l of plan.landmarks) {
    if (l.kind !== 'plaza') continue;
    const d = Math.hypot(wrapDelta(l.x, downtown.x, TILE), wrapDelta(l.z, downtown.z, TILE));
    if (d < nearest) {
      nearest = d;
      plaza = l;
    }
  }

  // The avenue that runs towards the sun beside the downtown cell.
  const avenueX = Math.round(downtown.cellX / AVENUE_EVERY) * AVENUE_EVERY * CELL;
  const roof = rooftop(plan, downtown.cellX, downtown.cellZ);
  // Beside the megatower: on the road along the east side of its block, a block and a half back.
  const megaRoadX = (mega.cellX + 1) * CELL;
  const megaZ = mega.z + 1.5 * CELL;
  // Over the plaza: above the intersection at its far corner, looking back across it at the sun.
  const plazaX = (plaza.cellX + 1) * CELL, plazaZ = (plaza.cellZ + 1) * CELL;

  const views: Viewpoint[] = [
    { name: 'Sunset Avenue', pose: pose(avenueX, 2.4, (downtown.cellZ + 1.5) * CELL, 0, 0.07) },
    { name: 'Downtown Canyon', pose: pose(avenueX, 120, (downtown.cellZ + 3.5) * CELL, 0, 0.02) },
    {
      name: 'Rooftop',
      pose: roof
        ? pose(roof.x, roof.y, roof.z, 0.25, -0.1)
        : pose(avenueX, Math.max(60, downtown.height + 4), (downtown.cellZ + 0.5) * CELL, 0.5, -0.14),
    },
    { name: 'Panorama', pose: pose(avenueX, 900, downtown.z + 1500, 0, -0.3) },
    {
      name: 'Megatower',
      pose: pose(megaRoadX, Math.max(120, mega.height * 0.5), megaZ, 0.35 * yawTowards(megaRoadX, megaZ, mega.x, mega.z), 0.12),
    },
    { name: 'Plaza', pose: pose(plazaX, 70, plazaZ, yawTowards(plazaX, plazaZ, plaza.x, plaza.z), -0.5) },
  ];

  // Belt and braces: if a plan ever puts something there, stand just outside it.
  const p: MutableVec3 = { x: 0, y: 0, z: 0 };
  for (const v of views) {
    p.x = v.pose.x;
    p.y = v.pose.y;
    p.z = v.pose.z;
    for (let i = 0; i < 4 && plan.collide(p, CAMERA_RADIUS + 0.2); i++) { /* pushed out; test again */ }
    v.pose.x = wrapTile(p.x);
    v.pose.y = p.y;
    v.pose.z = wrapTile(p.z);
  }
  return views;
}
