// The camera contract (architecture.md section 7). No three types: the engine builds the matrices.
import type { FrameState } from './layer';

/**
 * Where the viewer is and where they look.
 * Position is in tile coordinates and need not be wrapped; the engine wraps it.
 * Orientation is yaw, then pitch, then roll (three's 'YXZ' Euler order), radians:
 *   forward = (-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))
 * so yaw 0 looks along -z, positive yaw turns left (towards -x), positive pitch looks up.
 */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface CameraDriver {
  /** Called once per frame before layers update. Write the pose; do not allocate. */
  update(frame: FrameState, pose: CameraPose): void;
}
