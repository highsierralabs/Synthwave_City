// The camera rig (plan T11, M5): one CameraDriver that is either on the tour or in the viewer's
// hands, and moves between the two without a jump.
//
//   tour   the pose is tour.sample(tourTime)
//   free   flight physics driven by the InputMapper
//   join   returning to the tour, part one: flight physics pulled to the nearest road, with collision
//   blend  part two: a new tour has started from that point and the pose cross-fades onto it
//   ease   a one-second glide to a viewpoint, after which the mode is free
//
// `mode` reports 'tour' for tour, join and blend, and 'free' for free and ease.
import type { CameraDriver, CameraPose } from '../contracts/camera';
import { CELL_FIELD, CELL_HEIGHT_UNIT, CELL_STRIDE, type CityPlan, type MutableVec3 } from '../contracts/city';
import { CAMERA_FOV, CELL, CELLS, TILE } from '../contracts/constants';
import type { FrameState } from '../contracts/layer';
import { angleDelta, clamp, damp, smoothstep, wrapDelta } from '../core/math';
import { hashInts } from '../core/random';
import { attachDom, type DomBinding } from './dom';
import {
  CAMERA_RADIUS, MAX_ALTITUDE, MAX_PITCH, createFlightState, springValue, stepFlight, stepTowards,
  type FlightState,
} from './flight';
import { InputMapper, type KeyAction } from './input';
import { wrapTile } from './tile';
import { Tour, createTourSample, type TourStart } from './tour';
import { computeViewpoints, type Viewpoint } from './viewpoints';

export type CameraMode = 'tour' | 'free';

export interface CameraRigOptions {
  /** Seed for the tour. Defaults to the plan's seed. */
  seed?: number;
  /** Mode to start in. Defaults to 'tour'. In 'free' the rig starts from the pose the engine already has. */
  mode?: CameraMode;
  reducedMotion?: boolean;
  /**
   * Told about keys that belong to the app, and about changes of state:
   * 'menu' (Esc), 'mute' (M), 'stats' (H), 'mood' (T), 'photo' (P), 'mode' after the mode changed,
   * and 'viewpoint:<index>' after a viewpoint was chosen (the index goToViewpoint takes, from 0).
   */
  onAction?: (action: string) => void;
}

export interface CameraRig extends CameraDriver {
  readonly mode: CameraMode;
  setMode(mode: CameraMode): void;
  /** Glide to viewpoints[index] and stay there in free flight. Out-of-range indices are ignored. */
  goToViewpoint(index: number): void;
  readonly viewpoints: readonly Viewpoint[];
  /** Listen for keyboard, mouse, touch and gamepad on an element (keys on its window). Returns the detach function. */
  attachInput(element: HTMLElement): () => void;
  /** Slower tour, no banking, no speed zoom, and viewpoints cut instead of gliding. */
  setReducedMotion(on: boolean): void;
  /** Current speed, metres per second. */
  readonly speed: number;
  readonly reducedMotion: boolean;
  /** True once free flight has had no input for IDLE_OFFER seconds: the app may offer to resume the tour. */
  readonly resumeSuggested: boolean;
  /** The mapper behind attachInput, for on-screen controls and tests. */
  readonly input: InputMapper;
  /**
   * Act on a key action as attachInput does: 'toggle' switches mode, 'viewpoint:<index>' goes to a
   * viewpoint, and anything else is passed to options.onAction.
   */
  handleKey(action: KeyAction): void;
}

/** Seconds without input in free flight before resumeSuggested turns true. */
export const IDLE_OFFER = 30;
/** Seconds a glide to a viewpoint takes. */
export const EASE_TIME = 1;
/** Seconds the cross-fade back onto the tour takes. */
export const BLEND_TIME = 2.5;
/** Tour speed under reduced motion, as a fraction. */
export const REDUCED_RATE = 0.6;
/** Yaw and pitch rate of the arrow keys and a gamepad stick at full deflection, radians per second. */
export const TURN_RATE = 1.3;
/** Seconds a free look on the tour holds after the last drag before it eases back. */
export const LOOK_HOLD = 5;
/** Narrowest and widest lens a pinch can choose on the tour, degrees. */
export const MIN_TOUR_FOV = 25;
export const MAX_TOUR_FOV = 85;

/** Stiffness of the spring that returns a free look to the tour's own direction; about 3 s to settle. */
const LOOK_RETURN_OMEGA = 1.6;
/** How fast the lens follows a pinch, and how fast it returns to CAMERA_FOV off the tour. */
const LENS_FOLLOW = 14;
const LENS_RETURN = 3;
const DEG = Math.PI / 180;

const JOIN_OMEGA = 1.6;
const JOIN_REACH = 120;
const JOIN_TURN_OMEGA = 1.1;
const JOIN_MIN_TIME = 0.8;
const JOIN_TIMEOUT = 9;
const FREE_ROLL = 0.07;
const TWO_PI = Math.PI * 2;

const PHASE = { tour: 0, free: 1, join: 2, blend: 3, ease: 4 } as const;
type Phase = (typeof PHASE)[keyof typeof PHASE];

function smoother(u: number): number {
  const t = clamp(u, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

class Rig implements CameraRig {
  readonly viewpoints: readonly Viewpoint[];
  readonly input = new InputMapper();

  private readonly plan: CityPlan;
  private readonly seed: number;
  private readonly tour: Tour;
  private readonly onAction: ((action: string) => void) | undefined;
  private readonly sample = createTourSample();
  private readonly free: FlightState = createFlightState();
  private readonly probe: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly joinStart: TourStart = { x: 0, y: 0, z: 0, heading: 0 };
  private readonly yawRate = { v: 0 };
  private readonly pitchRate = { v: 0 };
  private binding: DomBinding | null = null;

  private phase: Phase;
  private reduced: boolean;
  /** Tour clock rate and bank scale, eased so that switching reduced motion is not a jolt. */
  private rate: number;
  private bank: number;
  private started = false;
  private lastTime = NaN;
  private tourT = 0;
  private epoch = 0;
  private idle = 0;
  private freeRoll = 0;
  private fovKick = 0;

  // Free look on the tour: an offset from the tour's view, and a lens.
  private readonly lookYawRate = { v: 0 };
  private readonly lookPitchRate = { v: 0 };
  private lookYaw = 0;
  private lookPitch = 0;
  private lookIdle = 0;
  private tourFov = CAMERA_FOV;
  private lens = CAMERA_FOV;

  // The pose and velocity last written.
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private oYaw = 0;
  private oPitch = 0;
  private oRoll = 0;
  private ovx = 0;
  private ovy = 0;
  private ovz = 0;

  // Returning to the tour.
  private joinX = 0;
  private joinY = 0;
  private joinZ = 0;
  private joinYaw = 0;
  private joinPitch = 0;
  private joinT = 0;
  private blendT = 0;
  private joinLimit = JOIN_TIMEOUT;
  private viaActive = false;
  private viaY = 0;

  // Gliding to a viewpoint.
  private easeT = 0;
  private easeIndex = 0;
  private fromX = 0;
  private fromY = 0;
  private fromZ = 0;
  private fromYaw = 0;
  private fromPitch = 0;
  private fromRoll = 0;

  constructor(plan: CityPlan, options: CameraRigOptions) {
    this.plan = plan;
    this.seed = options.seed ?? plan.seed;
    this.onAction = options.onAction;
    this.reduced = options.reducedMotion ?? false;
    this.rate = this.reduced ? REDUCED_RATE : 1;
    this.bank = this.reduced ? 0 : 1;
    this.phase = options.mode === 'free' ? PHASE.free : PHASE.tour;
    this.tour = new Tour(plan, this.seed);
    this.viewpoints = computeViewpoints(plan);
    this.input.setTourLook(this.mode === 'tour');
    this.writeTour();
  }

  get mode(): CameraMode {
    return this.phase === PHASE.free || this.phase === PHASE.ease ? 'free' : 'tour';
  }

  get speed(): number {
    return Math.hypot(this.ovx, this.ovy, this.ovz);
  }

  get reducedMotion(): boolean {
    return this.reduced;
  }

  get resumeSuggested(): boolean {
    return this.phase === PHASE.free && this.idle >= IDLE_OFFER;
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    if (mode === 'free') this.takeOver();
    else this.startJoin();
  }

  goToViewpoint(index: number): void {
    const view = this.viewpoints[index];
    if (!view || !Number.isInteger(index)) return;
    const was = this.mode;
    this.fromX = this.ox;
    this.fromY = this.oy;
    this.fromZ = this.oz;
    this.fromYaw = this.oYaw;
    this.fromPitch = this.oPitch;
    this.fromRoll = this.oRoll;
    this.easeIndex = index;
    this.easeT = 0;
    this.idle = 0;
    this.phase = PHASE.ease;
    this.dropLook();
    if (this.reduced) this.arrive();
    if (was !== 'free') this.emit('mode');
    this.emit(`viewpoint:${index}`);
  }

  attachInput(element: HTMLElement): () => void {
    this.binding?.detach();
    const binding = attachDom(element, this.input, (action) => this.handleKey(action));
    this.binding = binding;
    return () => {
      binding.detach();
      if (this.binding === binding) this.binding = null;
    };
  }

  handleKey(action: KeyAction): void {
    if (action === 'toggle') this.setMode(this.mode === 'tour' ? 'free' : 'tour');
    else if (action === 'takeover') this.setMode('free');
    else if (action.startsWith('viewpoint:')) this.goToViewpoint(Number(action.slice(10)));
    else this.emit(action);
  }

  private emit(action: string): void {
    if (this.onAction) this.onAction(action);
  }

  // ---- changes of phase

  /** Hand control to the viewer from wherever the camera is, keeping its velocity and the view. */
  private takeOver(): void {
    const f = this.free;
    if (this.phase !== PHASE.join) {
      f.x = this.ox;
      f.y = this.oy;
      f.z = this.oz;
      f.vx = this.ovx;
      f.vy = this.ovy;
      f.vz = this.ovz;
      // The pose last written already carries any free look.
      f.yaw = this.oYaw;
      f.pitch = clamp(this.oPitch, -MAX_PITCH, MAX_PITCH);
      this.freeRoll = this.oRoll;
    } else {
      // The join flies `free` itself; the free look was only added on output.
      f.yaw = wrapDelta(f.yaw + this.lookYaw, 0, TWO_PI);
      f.pitch = clamp(f.pitch + this.lookPitch, -MAX_PITCH, MAX_PITCH);
    }
    this.phase = PHASE.free;
    this.idle = 0;
    this.dropLook();
    this.emit('mode');
  }

  /** Off the tour: no look offset, and the lens heads back to CAMERA_FOV. Tells the mapper. */
  private dropLook(): void {
    this.lookYaw = this.lookPitch = 0;
    this.lookYawRate.v = this.lookPitchRate.v = 0;
    this.lookIdle = 0;
    this.tourFov = CAMERA_FOV;
    this.input.setTourLook(this.mode === 'tour');
  }

  /** On the tour: add the viewer's free look to the pose just written, and take any zoom. */
  private applyLook(dt: number): void {
    const input = this.input.state;
    if (input.panYaw !== 0 || input.panPitch !== 0) {
      this.lookYaw = wrapDelta(this.lookYaw + input.panYaw, 0, TWO_PI);
      this.lookPitch += input.panPitch;
      this.lookIdle = 0;
      this.lookYawRate.v = this.lookPitchRate.v = 0;
    } else {
      this.lookIdle += dt;
      if (this.lookIdle > LOOK_HOLD) {
        // Ease back, starting from rest, the short way round.
        this.lookYaw = springValue(this.lookYaw, this.lookYawRate, this.lookYaw, LOOK_RETURN_OMEGA, dt);
        this.lookPitch = springValue(this.lookPitch, this.lookPitchRate, this.lookPitch, LOOK_RETURN_OMEGA, dt);
      }
    }
    // Keep the sum inside the free-flight pitch limit, so dragging back responds at once.
    this.lookPitch = clamp(this.lookPitch, -MAX_PITCH - this.oPitch, MAX_PITCH - this.oPitch);
    this.oYaw = wrapDelta(this.oYaw + this.lookYaw, 0, TWO_PI);
    this.oPitch += this.lookPitch;
    if (input.zoom !== 1 && input.zoom > 0) {
      const half = Math.atan(Math.tan(this.tourFov * DEG * 0.5) * input.zoom);
      this.tourFov = clamp(2 * half / DEG, MIN_TOUR_FOV, MAX_TOUR_FOV);
    }
  }

  /** True if a sphere can travel straight from the camera to a point at height y without touching a box. */
  private clearTo(x: number, y: number, z: number): boolean {
    const f = this.free;
    const dx = wrapDelta(x, f.x, TILE), dy = y - f.y, dz = wrapDelta(z, f.z, TILE);
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / 1.5));
    const p = this.probe;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      p.x = f.x + dx * u;
      p.y = f.y + dy * u;
      p.z = f.z + dz * u;
      if (this.plan.collide(p, 1)) return false;
    }
    return true;
  }

  /** Start returning to the tour: pick the nearest road that can be reached, and begin a tour there. */
  private startJoin(): void {
    const f = this.free;
    if (this.phase === PHASE.ease) {
      f.x = this.ox;
      f.y = this.oy;
      f.z = this.oz;
      f.vx = f.vy = f.vz = 0;
      f.yaw = this.oYaw;
      f.pitch = clamp(this.oPitch, -MAX_PITCH, MAX_PITCH);
      this.freeRoll = this.oRoll;
    }
    const px = wrapTile(f.x), pz = wrapTile(f.z);
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    const lx = px - cx * CELL, lz = pz - cz * CELL;
    let y = Math.max(f.y, 3);

    // The four road lines round this cell: 0 and 1 run along z, 2 and 3 along x.
    let best = -1, bestD = Infinity, near = 0, nearD = Infinity;
    for (let c = 0; c < 4; c++) {
      const d = c === 0 ? lx : c === 1 ? CELL - lx : c === 2 ? lz : CELL - lz;
      if (d < nearD) {
        nearD = d;
        near = c;
      }
      if (d >= bestD) continue;
      const tx = c === 0 ? cx * CELL : c === 1 ? (cx + 1) * CELL : px;
      const tz = c === 2 ? cz * CELL : c === 3 ? (cz + 1) * CELL : pz;
      if (this.clearTo(tx, y, tz)) {
        best = c;
        bestD = d;
      }
    }
    this.viaActive = false;
    this.joinLimit = JOIN_TIMEOUT;
    if (best < 0) {
      // Boxed in: rise above this cell's roofs first, then cross to the nearest road.
      best = near;
      const top = this.plan.cells[(cz * CELLS + cx) * CELL_STRIDE + CELL_FIELD.height]! * CELL_HEIGHT_UNIT;
      y = Math.min(MAX_ALTITUDE - 20, Math.max(y, top + 25));
      this.viaActive = true;
      this.viaY = y;
      this.joinLimit = JOIN_TIMEOUT + (y - f.y) / 50;
    }
    const alongZ = best < 2;
    const jx = best === 0 ? cx * CELL : best === 1 ? (cx + 1) * CELL : px;
    const jz = best === 2 ? cz * CELL : best === 3 ? (cz + 1) * CELL : pz;

    // Fly on in the direction the camera is already going, or failing that, looking.
    const moving = Math.hypot(f.vx, f.vz) > 3;
    const wantX = moving ? f.vx : -Math.sin(f.yaw);
    const wantZ = moving ? f.vz : -Math.cos(f.yaw);
    const start = this.joinStart;
    start.x = jx;
    start.y = y;
    start.z = jz;
    start.heading = alongZ ? (wantZ <= 0 ? 0 : 2) : wantX <= 0 ? 1 : 3;
    this.epoch++;
    this.tour.restart(start, hashInts(this.seed, this.epoch));
    this.tour.sample(0, this.sample);
    this.joinX = this.sample.x;
    this.joinY = this.sample.y;
    this.joinZ = this.sample.z;
    this.joinYaw = this.sample.yaw;
    this.joinPitch = this.sample.pitch;
    this.joinT = 0;
    this.tourT = 0;
    this.yawRate.v = 0;
    this.pitchRate.v = 0;
    this.phase = PHASE.join;
    this.input.setTourLook(true);
    // A mouse that is still locked would take over again at its next twitch.
    this.binding?.release();
    this.emit('mode');
  }

  /** Land on the viewpoint and hand over to free flight. */
  private arrive(): void {
    const target = this.viewpoints[this.easeIndex]!.pose;
    const f = this.free;
    f.x = target.x;
    f.y = target.y;
    f.z = target.z;
    f.vx = f.vy = f.vz = 0;
    f.yaw = target.yaw;
    f.pitch = target.pitch;
    this.freeRoll = 0;
    this.phase = PHASE.free;
    this.writeFree();
  }

  // ---- per frame

  update(frame: FrameState, pose: CameraPose): void {
    const dt = frame.dt > 0 ? frame.dt : 0;
    // Time moved without a step: the clock was set by hand (a screenshot, a scrub).
    const scrubbed = dt === 0 && frame.time !== this.lastTime;
    this.lastTime = frame.time;
    this.binding?.poll();
    const input = this.input.state;

    if (!this.started) {
      this.started = true;
      if (this.phase === PHASE.free) {
        const f = this.free;
        f.x = wrapTile(pose.x);
        f.y = pose.y;
        f.z = wrapTile(pose.z);
        f.yaw = pose.yaw;
        f.pitch = clamp(pose.pitch, -MAX_PITCH, MAX_PITCH);
        this.writeFree();
      }
    }

    this.rate += ((this.reduced ? REDUCED_RATE : 1) - this.rate) * damp(2, dt);
    this.bank += ((this.reduced ? 0 : 1) - this.bank) * damp(2, dt);

    if (this.phase !== PHASE.free && this.phase !== PHASE.ease && this.input.active) this.takeOver();
    if (scrubbed && (this.phase === PHASE.join || this.phase === PHASE.blend)) this.phase = PHASE.tour;

    switch (this.phase) {
      case PHASE.tour:
        this.tourT = scrubbed ? frame.time : this.tourT + dt * this.rate;
        this.writeTour();
        break;
      case PHASE.free:
        this.updateFree(dt);
        break;
      case PHASE.join:
        this.updateJoin(dt);
        break;
      case PHASE.blend:
        this.updateBlend(dt);
        break;
      default:
        this.updateEase(dt);
    }
    const touring = this.mode === 'tour';
    if (touring) this.applyLook(dt);
    // Look that arrived while it could not be used is dropped, not saved up.
    input.lookYaw = 0;
    input.lookPitch = 0;
    input.panYaw = 0;
    input.panPitch = 0;
    input.zoom = 1;

    const kick = this.phase === PHASE.free && !this.reduced ? 7 * smoothstep(90, 420, this.speed) : 0;
    this.fovKick += (kick - this.fovKick) * damp(3, dt);
    const lensTarget = touring ? this.tourFov : CAMERA_FOV;
    this.lens += (lensTarget - this.lens) * damp(touring ? LENS_FOLLOW : LENS_RETURN, dt);
    if (Math.abs(lensTarget - this.lens) < 0.01) this.lens = lensTarget;

    pose.x = this.ox;
    pose.y = this.oy;
    pose.z = this.oz;
    pose.yaw = this.oYaw;
    pose.pitch = this.oPitch;
    pose.roll = this.oRoll;
    pose.fov = Math.round((this.lens + this.fovKick) * 20) / 20;
  }

  private writeTour(): void {
    const s = this.sample;
    this.tour.sample(this.tourT, s);
    this.ox = s.x;
    this.oy = s.y;
    this.oz = s.z;
    this.oYaw = s.yaw;
    this.oPitch = s.pitch;
    this.oRoll = s.roll * this.bank;
    this.ovx = s.vx * this.rate;
    this.ovy = s.vy * this.rate;
    this.ovz = s.vz * this.rate;
  }

  private writeFree(): void {
    const f = this.free;
    this.ox = f.x;
    this.oy = f.y;
    this.oz = f.z;
    this.oYaw = f.yaw;
    this.oPitch = f.pitch;
    this.oRoll = this.freeRoll;
    this.ovx = f.vx;
    this.ovy = f.vy;
    this.ovz = f.vz;
  }

  private updateFree(dt: number): void {
    const f = this.free;
    const input = this.input.state;
    f.yaw = wrapDelta(f.yaw + input.lookYaw + input.turn * TURN_RATE * dt, 0, TWO_PI);
    f.pitch = clamp(f.pitch + input.lookPitch + input.tilt * TURN_RATE * dt, -MAX_PITCH, MAX_PITCH);
    stepFlight(this.plan, f, input.forward, input.right, input.up, input.boost, dt);
    // Lean a little into a sideways slide.
    const sideways = f.vx * Math.cos(f.yaw) - f.vz * Math.sin(f.yaw);
    const lean = -FREE_ROLL * this.bank * clamp(sideways / 70, -1, 1);
    this.freeRoll += (lean - this.freeRoll) * damp(4, dt);
    this.idle = this.input.active ? 0 : this.idle + dt;
    this.writeFree();
  }

  /** Turn the free camera towards a direction with a critically damped spring. */
  private turnTowards(yaw: number, pitch: number, dt: number): void {
    const f = this.free;
    const omega = JOIN_TURN_OMEGA * (this.reduced ? 0.7 : 1);
    f.yaw = wrapDelta(springValue(f.yaw, this.yawRate, angleDelta(yaw, f.yaw), omega, dt), 0, TWO_PI);
    f.pitch = springValue(f.pitch, this.pitchRate, f.pitch - pitch, omega, dt);
    this.freeRoll -= this.freeRoll * damp(4, dt);
  }

  private updateJoin(dt: number): void {
    const f = this.free;
    this.joinT += dt;
    if (this.viaActive) {
      // Straight up, then across at that height.
      stepTowards(this.plan, f, f.x, this.viaY, f.z, JOIN_OMEGA, JOIN_REACH, dt);
      if (Math.abs(f.y - this.viaY) < 6) this.viaActive = false;
    } else {
      stepTowards(this.plan, f, this.joinX, this.joinY, this.joinZ, JOIN_OMEGA, JOIN_REACH, dt);
    }
    this.turnTowards(this.joinYaw, this.joinPitch, dt);
    this.writeFree();
    const off = Math.hypot(wrapDelta(this.joinX, f.x, TILE), this.joinY - f.y, wrapDelta(this.joinZ, f.z, TILE));
    const settled = !this.viaActive && off < 2.5 && Math.hypot(f.vx, f.vy, f.vz) < 6
      && Math.abs(angleDelta(this.joinYaw, f.yaw)) < 0.6 && this.joinT >= JOIN_MIN_TIME;
    if (settled || this.joinT > this.joinLimit) {
      this.phase = PHASE.blend;
      this.blendT = 0;
      this.tourT = 0;
    }
  }

  private updateBlend(dt: number): void {
    const f = this.free;
    const s = this.sample;
    this.blendT += dt;
    this.tourT += dt * this.rate;
    this.tour.sample(this.tourT, s);
    stepTowards(this.plan, f, this.joinX, this.joinY, this.joinZ, JOIN_OMEGA, JOIN_REACH, dt);
    this.turnTowards(s.yaw, s.pitch, dt);
    const b = smoother(this.blendT / BLEND_TIME);
    const p = this.probe;
    p.x = f.x + wrapDelta(s.x, f.x, TILE) * b;
    p.y = f.y + (s.y - f.y) * b;
    p.z = f.z + wrapDelta(s.z, f.z, TILE) * b;
    // Both ends are on the same straight road, so this does nothing unless the join timed out far away.
    this.plan.collide(p, CAMERA_RADIUS);
    this.ox = wrapTile(p.x);
    this.oy = p.y;
    this.oz = wrapTile(p.z);
    this.oYaw = wrapDelta(f.yaw + angleDelta(f.yaw, s.yaw) * b, 0, TWO_PI);
    this.oPitch = f.pitch + (s.pitch - f.pitch) * b;
    this.oRoll = this.freeRoll * (1 - b) + s.roll * this.bank * b;
    this.ovx = f.vx + (s.vx * this.rate - f.vx) * b;
    this.ovy = f.vy + (s.vy * this.rate - f.vy) * b;
    this.ovz = f.vz + (s.vz * this.rate - f.vz) * b;
    if (this.blendT >= BLEND_TIME) this.phase = PHASE.tour;
  }

  private updateEase(dt: number): void {
    // With the clock stopped the glide would never end, so it lands at once.
    this.easeT = dt > 0 ? this.easeT + dt : EASE_TIME;
    if (this.easeT >= EASE_TIME) {
      this.arrive();
      return;
    }
    const target = this.viewpoints[this.easeIndex]!.pose;
    const e = smoother(this.easeT / EASE_TIME);
    const dx = wrapDelta(target.x, this.fromX, TILE), dz = wrapDelta(target.z, this.fromZ, TILE);
    const previousX = this.ox, previousY = this.oy, previousZ = this.oz;
    this.ox = wrapTile(this.fromX + dx * e);
    this.oy = this.fromY + (target.y - this.fromY) * e;
    this.oz = wrapTile(this.fromZ + dz * e);
    this.oYaw = wrapDelta(this.fromYaw + angleDelta(this.fromYaw, target.yaw) * e, 0, TWO_PI);
    this.oPitch = this.fromPitch + (target.pitch - this.fromPitch) * e;
    this.oRoll = this.fromRoll * (1 - e);
    this.ovx = wrapDelta(this.ox, previousX, TILE) / dt;
    this.ovy = (this.oy - previousY) / dt;
    this.ovz = wrapDelta(this.oz, previousZ, TILE) / dt;
  }
}

export function createCameraRig(plan: CityPlan, options: CameraRigOptions = {}): CameraRig {
  return new Rig(plan, options);
}
