// Named camera views for the harness, derived from the plan so they are the same for every task.
import type { CityPlan, Landmark } from '../src/contracts/city';
import { AVENUE_EVERY, CELL, TILE } from '../src/contracts/constants';

export interface View {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** x (or z) of the avenue centre line nearest a coordinate. */
function avenueNear(coord: number): number {
  const pitch = CELL * AVENUE_EVERY;
  return Math.round(coord / pitch) * pitch;
}

/** Yaw that looks from (x, z) towards (tx, tz); see CameraPose. */
export function yawTowards(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

export function computeViews(plan: CityPlan): Record<string, View> {
  const fallback: Landmark = { kind: 'downtown', x: TILE / 2, z: TILE / 2, height: 300, cellX: 20, cellZ: 20 };
  const downtown = plan.landmarks.find((l) => l.kind === 'downtown') ?? fallback;
  const mega = plan.landmarks.find((l) => l.kind === 'megatower') ?? downtown;
  const plaza = plan.landmarks.find((l) => l.kind === 'plaza') ?? downtown;
  const ax = avenueNear(downtown.x);
  const megaAx = avenueNear(mega.x + CELL);
  return {
    // Over the city, looking at downtown with the sun behind it.
    high: { x: ax, y: 650, z: downtown.z + 1500, yaw: 0, pitch: -0.22 },
    // The same, looking away from the sun.
    away: { x: ax, y: 650, z: downtown.z - 1500, yaw: Math.PI, pitch: -0.22 },
    // Above the roofs, level, straight at the sun.
    sun: { x: ax, y: 300, z: downtown.z + 900, yaw: 0, pitch: 0.03 },
    // Between the towers on an avenue.
    canyon: { x: ax + 3, y: 110, z: downtown.z + 520, yaw: 0, pitch: 0.02 },
    // Standing in an avenue.
    street: { x: ax + 9, y: 1.8, z: downtown.z + 310, yaw: 0.04, pitch: 0.07 },
    // On a street (not an avenue), looking along x.
    side: { x: downtown.x + 300, y: 2.2, z: avenueNear(downtown.z) + CELL + 3, yaw: Math.PI / 2, pitch: 0.05 },
    // Roof height, looking across the skyline.
    roof: { x: ax, y: Math.max(140, downtown.height * 0.55), z: downtown.z + 260, yaw: 0.55, pitch: -0.12 },
    // Beside a plaza.
    // From the street corner, so no neighbouring building is in the way.
    plaza: { x: plaza.x + CELL / 2, y: 26, z: plaza.z + CELL / 2, yaw: yawTowards(plaza.x + CELL / 2, plaza.z + CELL / 2, plaza.x, plaza.z), pitch: 0.2 },
    // Looking up at the tallest megatower from an avenue.
    mega: { x: megaAx, y: 160, z: mega.z + 620, yaw: yawTowards(megaAx, mega.z + 620, mega.x, mega.z), pitch: 0.28 },
    // Straight down.
    top: { x: downtown.x, y: 2400, z: downtown.z, yaw: 0, pitch: -Math.PI / 2 + 0.001 },
    // Low over an avenue, good for traffic.
    low: { x: ax - 6, y: 28, z: downtown.z + 700, yaw: 0, pitch: -0.06 },
  };
}
