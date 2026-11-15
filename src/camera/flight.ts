// Free flight (plan T11, M1): a sphere with velocity that eases towards what the controls ask for
// and slides along building boxes. Pure: no DOM, no clock; the caller passes dt.
import type { CityPlan, MutableVec3 } from '../contracts/city';
import { TILE } from '../contracts/constants';
import { clamp } from '../core/math';
import { wrapTile } from './tile';

/** Radius of the camera's collision sphere, metres. It also sets the lowest eye height. */
export const CAMERA_RADIUS = 1.8;
/** Flight ceiling, metres. */
export const MAX_ALTITUDE = 1500;
/** Cruise speed at street level, metres per second. */
export const BASE_SPEED = 45;
/** Speed doubles every this many metres of altitude gained (linearly: 1 + y / ALTITUDE_SPEED). */
export const ALTITUDE_SPEED = 300;
export const BOOST = 3.5;
/** How fast velocity approaches its target, per second. */
export const RESPONSE = 3;
export const MAX_PITCH = 1.5;

/** Longest physics step, seconds. A longer frame is split, so 30 Hz and 60 Hz fly the same path. */
const MAX_STEP = 1 / 120;
/** Longest move between collision tests, metres. Shorter than the thinnest wall and the sphere. */
const SUB_STEP = 1.5;
const MAX_SUB_STEPS = 96;

export interface FlightState {
  /** Position: x and z are kept wrapped into 0..TILE. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
}

export function createFlightState(): FlightState {
  return { x: TILE / 2, y: 200, z: TILE / 2, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 };
}

const probe: MutableVec3 = { x: 0, y: 0, z: 0 };

/** Top speed at an altitude: faster higher up, where there is nothing close to judge speed by. */
export function topSpeed(y: number, boost: boolean): number {
  return BASE_SPEED * (1 + clamp(y, 0, MAX_ALTITUDE) / ALTITUDE_SPEED) * (boost ? BOOST : 1);
}

/**
 * Move by (dx, dy, dz) in steps short enough not to skip a wall. Where the sphere is pushed out of
 * a box, the rest of the move and the velocity lose their component into that wall, so it slides.
 * Returns true if it touched anything.
 */
export function moveAndSlide(plan: CityPlan, s: FlightState, dx: number, dy: number, dz: number): boolean {
  const dist = Math.hypot(dx, dy, dz);
  const steps = Math.min(MAX_SUB_STEPS, Math.max(1, Math.ceil(dist / SUB_STEP)));
  let sx = dx / steps, sy = dy / steps, sz = dz / steps;
  let touched = false;
  for (let i = 0; i < steps; i++) {
    const bx = s.x + sx, by = s.y + sy, bz = s.z + sz;
    probe.x = bx;
    probe.y = by;
    probe.z = bz;
    if (plan.collide(probe, CAMERA_RADIUS)) {
      const nx = probe.x - bx, ny = probe.y - by, nz = probe.z - bz;
      const n = Math.hypot(nx, ny, nz);
      if (n > 1e-9) {
        const ux = nx / n, uy = ny / n, uz = nz / n;
        const into = s.vx * ux + s.vy * uy + s.vz * uz;
        if (into < 0) {
          s.vx -= into * ux;
          s.vy -= into * uy;
          s.vz -= into * uz;
        }
        const stepInto = sx * ux + sy * uy + sz * uz;
        if (stepInto < 0) {
          sx -= stepInto * ux;
          sy -= stepInto * uy;
          sz -= stepInto * uz;
        }
      }
      touched = true;
    }
    s.x = probe.x;
    s.y = probe.y;
    s.z = probe.z;
  }
  if (s.y > MAX_ALTITUDE) {
    s.y = MAX_ALTITUDE;
    if (s.vy > 0) s.vy = 0;
  }
  s.x = wrapTile(s.x);
  s.z = wrapTile(s.z);
  return touched;
}

/**
 * One step of flight. The axes are -1..1 in the camera's frame: forward along the view direction
 * (so it climbs when looking up), right along the horizon, up along the world's y. Velocity
 * approaches the target exponentially, and the step is integrated exactly, so the path does not
 * depend on the frame rate (to within the change of top speed with altitude over 1/120 s).
 */
export function stepFlight(
  plan: CityPlan, s: FlightState, forward: number, right: number, up: number, boost: boolean, dt: number,
): boolean {
  if (!(dt > 0)) return false;
  const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  let ax = -sy * cp * forward + cy * right;
  let ay = sp * forward + up * 0.7;
  let az = -cy * cp * forward - sy * right;
  const mag = Math.hypot(ax, ay, az);
  if (mag > 1) {
    ax /= mag;
    ay /= mag;
    az /= mag;
  }
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-9));
  const h = dt / steps;
  const e = Math.exp(-RESPONSE * h);
  const k = (1 - e) / RESPONSE;
  let touched = false;
  for (let i = 0; i < steps; i++) {
    // Top speed depends on altitude; take it at the middle of the step.
    const top = topSpeed(s.y + s.vy * h * 0.5, boost);
    const tx = ax * top, ty = ay * top, tz = az * top;
    const ox = s.vx - tx, oy = s.vy - ty, oz = s.vz - tz;
    s.vx = tx + ox * e;
    s.vy = ty + oy * e;
    s.vz = tz + oz * e;
    if (moveAndSlide(plan, s, tx * h + ox * k, ty * h + oy * k, tz * h + oz * k)) touched = true;
  }
  return touched;
}

/**
 * One step of a critically damped spring pulling the sphere towards a point, with collision.
 * `reach` caps how far away the target is taken to be, which caps the speed at about reach * omega / 2.
 */
export function stepTowards(
  plan: CityPlan, s: FlightState, tx: number, ty: number, tz: number, omega: number, reach: number, dt: number,
): boolean {
  if (!(dt > 0)) return false;
  let ax = s.x - tx, ay = s.y - ty, az = s.z - tz;
  // Shortest way round the wrapped tile.
  ax -= TILE * Math.floor(ax / TILE + 0.5);
  az -= TILE * Math.floor(az / TILE + 0.5);
  const far = Math.hypot(ax, ay, az);
  if (far > reach) {
    const f = reach / far;
    ax *= f;
    ay *= f;
    az *= f;
  }
  // x(t) = target + (a + b t) e^(-omega t), with b = v0 + omega a.
  const e = Math.exp(-omega * dt);
  const bx = s.vx + omega * ax, by = s.vy + omega * ay, bz = s.vz + omega * az;
  const dx = (ax + bx * dt) * e - ax, dy = (ay + by * dt) * e - ay, dz = (az + bz * dt) * e - az;
  s.vx = (bx - omega * (ax + bx * dt)) * e;
  s.vy = (by - omega * (ay + by * dt)) * e;
  s.vz = (bz - omega * (az + bz * dt)) * e;
  return moveAndSlide(plan, s, dx, dy, dz);
}

/** One step of a critically damped spring on a single value; returns the new value and writes the new rate. */
export function springValue(value: number, rate: { v: number }, offset: number, omega: number, dt: number): number {
  // `offset` is value - target. The caller passes it so angles can take the short way round.
  const e = Math.exp(-omega * dt);
  const b = rate.v + omega * offset;
  const next = (offset + b * dt) * e;
  rate.v = (b - omega * (offset + b * dt)) * e;
  return value + (next - offset);
}
