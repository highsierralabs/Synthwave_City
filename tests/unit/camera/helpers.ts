// Shared fixtures for the camera tests.
import type { CameraPose } from '../../../src/contracts/camera';
import type { CityPlan, MutableVec3 } from '../../../src/contracts/city';
import { CAMERA_FOV, CELL, CELLS, TILE, roadSpec } from '../../../src/contracts/constants';
import { CELL_FIELD, CELL_HEIGHT_UNIT, CELL_STRIDE } from '../../../src/contracts/city';
import type { FrameState } from '../../../src/contracts/layer';
import { wrapDelta } from '../../../src/core/math';

export function makeFrame(time = 0, dt = 0): FrameState {
  return { time, dt, loop: 0, beat: 0, frame: 0, camX: 0, camY: 0, camZ: 0, camYaw: 0, camPitch: 0, width: 1280, height: 720 };
}

export function makePose(): CameraPose {
  return { x: TILE / 2, y: 200, z: TILE / 2, yaw: 0, pitch: 0, roll: 0, fov: CAMERA_FOV };
}

/** Advance a frame by dt the way the engine's clock does. */
export function tick(frame: FrameState, dt: number): void {
  frame.dt = dt;
  frame.time += dt;
  frame.frame++;
}

/** A plan with nothing in it: no boxes, no landmarks. The road is the only thing to hit. */
export function emptyPlan(seed = 1): CityPlan {
  return {
    seed,
    cells: new Uint8Array(CELLS * CELLS * 4),
    boxCount: 0,
    boxes: new Float32Array(0),
    buildingCount: 0,
    lanes: [],
    sites: [],
    landmarks: [],
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

export interface TestBox { x0: number; x1: number; y1: number; z0: number; z1: number }

/**
 * A plan made of a few boxes standing on the ground, with its own simple collide (sphere against
 * axis-aligned box). The boxes must not straddle the edge of the tile.
 */
export function boxPlan(boxes: readonly TestBox[]): CityPlan {
  const plan = emptyPlan();
  for (const b of boxes) {
    const cell = Math.floor(((b.z0 + b.z1) / 2) / CELL) * CELLS + Math.floor(((b.x0 + b.x1) / 2) / CELL);
    const i = cell * CELL_STRIDE + CELL_FIELD.height;
    plan.cells[i] = Math.max(plan.cells[i]!, Math.ceil(b.y1 / CELL_HEIGHT_UNIT));
  }
  const inTile = (v: number): number => ((v % TILE) + TILE) % TILE;
  return {
    ...plan,
    heightAt(x: number, z: number): number {
      const px = inTile(x), pz = inTile(z);
      let top = 0;
      for (const b of boxes) if (px >= b.x0 && px <= b.x1 && pz >= b.z0 && pz <= b.z1) top = Math.max(top, b.y1);
      return top;
    },
    collide(pos: MutableVec3, radius: number): boolean {
      let moved = false;
      if (pos.y < radius) {
        pos.y = radius;
        moved = true;
      }
      const px = inTile(pos.x), pz = inTile(pos.z);
      let x = px, y = pos.y, z = pz;
      for (const b of boxes) {
        const qx = Math.max(b.x0, Math.min(x, b.x1)), qy = Math.max(0, Math.min(y, b.y1)), qz = Math.max(b.z0, Math.min(z, b.z1));
        const dx = x - qx, dy = y - qy, dz = z - qz;
        const d = Math.hypot(dx, dy, dz);
        if (d >= radius) continue;
        if (d > 1e-9) {
          x += (dx / d) * (radius - d);
          y += (dy / d) * (radius - d);
          z += (dz / d) * (radius - d);
        } else {
          y = b.y1 + radius;
        }
        moved = true;
      }
      pos.x += x - px;
      pos.y = y;
      pos.z += z - pz;
      return moved;
    },
  };
}

const probe: MutableVec3 = { x: 0, y: 0, z: 0 };

/** True if a sphere at the point touches a box or the road. Does not move the point. */
export function blocked(plan: CityPlan, x: number, y: number, z: number, radius: number): boolean {
  probe.x = x;
  probe.y = y;
  probe.z = z;
  return plan.collide(probe, radius);
}

/**
 * Distance from a point to the nearest building line, measured inside whichever road corridor it
 * is deepest in. Negative means the point is over a block. Pure geometry: it knows nothing of boxes.
 */
export function corridorMargin(x: number, z: number): number {
  const lx = Math.round(x / CELL), lz = Math.round(z / CELL);
  const mx = roadSpec(lx).corridorHalf - Math.abs(wrapDelta(x, lx * CELL, TILE));
  const mz = roadSpec(lz).corridorHalf - Math.abs(wrapDelta(z, lz * CELL, TILE));
  return Math.max(mx, mz);
}

export function finitePose(pose: CameraPose): boolean {
  return Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.z)
    && Number.isFinite(pose.yaw) && Number.isFinite(pose.pitch) && Number.isFinite(pose.roll) && Number.isFinite(pose.fov);
}
