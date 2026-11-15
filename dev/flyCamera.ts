// A minimal fly camera for the harness: drag to look, W A S D to move, Q/E down/up, Shift faster.
// No collision. The real camera rig is src/camera (T11).
import type { CameraDriver, CameraPose } from '../src/contracts/camera';
import type { FrameState } from '../src/contracts/layer';

export function createFlyCamera(element: HTMLElement): CameraDriver {
  const keys = new Set<string>();
  let dragging = false;
  let dYaw = 0;
  let dPitch = 0;
  let last = 0;
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  element.addEventListener('pointerdown', (e) => {
    dragging = true;
    element.setPointerCapture(e.pointerId);
  });
  element.addEventListener('pointerup', () => { dragging = false; });
  element.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dYaw -= e.movementX * 0.003;
    dPitch -= e.movementY * 0.003;
  });
  return {
    update(_frame: FrameState, pose: CameraPose): void {
      const now = performance.now();
      const dt = last > 0 ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      pose.yaw += dYaw;
      pose.pitch = Math.max(-1.55, Math.min(1.55, pose.pitch + dPitch));
      dYaw = 0;
      dPitch = 0;
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 300 : 60) * dt;
      const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const u = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
      const cp = Math.cos(pose.pitch);
      const fx = -Math.sin(pose.yaw) * cp;
      const fy = Math.sin(pose.pitch);
      const fz = -Math.cos(pose.yaw) * cp;
      const rx = Math.cos(pose.yaw);
      const rz = -Math.sin(pose.yaw);
      pose.x += (fx * f + rx * r) * speed;
      pose.y = Math.max(1, pose.y + (fy * f + u) * speed);
      pose.z += (fz * f + rz * r) * speed;
    },
  };
}
