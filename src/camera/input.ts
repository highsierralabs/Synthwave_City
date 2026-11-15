// Input mapping (plan T11, M2): events in, a plain InputState out. Pure: it reads only the fields
// of the event-like objects it is handed, so tests drive it with synthetic events. The DOM
// listeners that feed it live in ./dom.ts.
import { clamp } from '../core/math';

/** Radians of look per pixel of mouse movement. */
export const MOUSE_SENSITIVITY = 0.0022;
/** Radians of look per pixel of touch drag. */
export const TOUCH_SENSITIVITY = 0.0045;
/** Gamepad stick dead zone. */
export const STICK_DEAD_ZONE = 0.16;

/** What the controls ask for right now. Axes are -1..1. */
export interface InputState {
  /** Along the view direction. */
  forward: number;
  /** Along the horizon to the right. */
  right: number;
  /** Along the world's up. */
  up: number;
  boost: boolean;
  /** Look waiting to be applied, radians. Positive yaw turns left, positive pitch looks up. The rig zeroes them. */
  lookYaw: number;
  lookPitch: number;
  /** Steady turning from keys or a stick, -1..1: positive turns left, positive tilt looks up. */
  turn: number;
  tilt: number;
}

/** The fields of a KeyboardEvent the mapper reads. */
export interface KeyLike {
  readonly code: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

/** The fields of a PointerEvent the mapper reads. */
export interface PointerLike {
  readonly pointerId: number;
  /** 'mouse', 'touch' or 'pen'. */
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly movementX?: number;
  readonly movementY?: number;
  readonly button?: number;
}

/**
 * Actions a key press can stand for. 'toggle' and 'viewpoint:n' are for the rig; the rest are for
 * the app, which the rig passes on untouched.
 */
export type KeyAction = 'toggle' | 'menu' | 'mute' | 'stats' | 'mood' | 'photo' | `viewpoint:${number}`;

const ACTION_KEYS: Readonly<Record<string, KeyAction>> = {
  Space: 'toggle',
  Escape: 'menu',
  KeyM: 'mute',
  KeyH: 'stats',
  KeyT: 'mood',
  KeyP: 'photo',
  Digit1: 'viewpoint:0', Digit2: 'viewpoint:1', Digit3: 'viewpoint:2',
  Digit4: 'viewpoint:3', Digit5: 'viewpoint:4', Digit6: 'viewpoint:5',
  Numpad1: 'viewpoint:0', Numpad2: 'viewpoint:1', Numpad3: 'viewpoint:2',
  Numpad4: 'viewpoint:3', Numpad5: 'viewpoint:4', Numpad6: 'viewpoint:5',
};

const HELD_KEYS: ReadonlySet<string> = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
]);

/** True if the mapper uses this key, so the page should not also scroll or act on it. */
export function isCameraKey(code: string): boolean {
  return HELD_KEYS.has(code) || code in ACTION_KEYS;
}

function deadZone(v: number): number {
  const a = Math.abs(v);
  if (!(a > STICK_DEAD_ZONE)) return 0;
  return Math.sign(v) * ((a - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
}

export class InputMapper {
  readonly state: InputState = {
    forward: 0, right: 0, up: 0, boost: false, lookYaw: 0, lookPitch: 0, turn: 0, tilt: 0,
  };

  private readonly keys = new Set<string>();
  /** Touch pointers that are down, oldest first. The first one steers. */
  private readonly touches: number[] = [];
  private anchorId = -1;
  private touchX = 0;
  private touchY = 0;
  private mouseDown = false;
  private padForward = 0;
  private padRight = 0;
  private padUp = 0;
  private padTurn = 0;
  private padTilt = 0;
  private padBoost = false;

  /** A key went down. Returns the action it stands for, or null for a held key or a key that is not ours. */
  keyDown(e: KeyLike): KeyAction | null {
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    const action = ACTION_KEYS[e.code];
    if (action !== undefined) return e.repeat ? null : action;
    if (HELD_KEYS.has(e.code)) {
      this.keys.add(e.code);
      this.refresh();
    }
    return null;
  }

  keyUp(e: KeyLike): void {
    if (this.keys.delete(e.code)) this.refresh();
  }

  /**
   * A pointer went down on the view. A mouse button starts a drag look (pointer lock, when the page
   * grants it, takes over from there). The first finger steers and flies; a second one boosts.
   */
  pointerDown(e: PointerLike): void {
    if (e.pointerType === 'mouse') {
      if ((e.button ?? 0) === 0) this.mouseDown = true;
      return;
    }
    if (this.touches.includes(e.pointerId)) return;
    this.touches.push(e.pointerId);
    if (this.touches.length === 1) this.anchor(e);
    this.refresh();
  }

  /** A pointer moved. `locked` says the page holds pointer lock, so a mouse looks without a button held. */
  pointerMove(e: PointerLike, locked: boolean): void {
    const s = this.state;
    if (e.pointerType === 'mouse') {
      if (!locked && !this.mouseDown) return;
      s.lookYaw -= (e.movementX ?? 0) * MOUSE_SENSITIVITY;
      s.lookPitch -= (e.movementY ?? 0) * MOUSE_SENSITIVITY;
      return;
    }
    if (this.touches[0] !== e.pointerId) return;
    // After the steering finger lifts, the next one steers from wherever it is now.
    if (this.anchorId !== e.pointerId) {
      this.anchor(e);
      return;
    }
    // Like a mouse: drag right to look right, drag up to look up.
    s.lookYaw -= (e.clientX - this.touchX) * TOUCH_SENSITIVITY;
    s.lookPitch -= (e.clientY - this.touchY) * TOUCH_SENSITIVITY;
    this.touchX = e.clientX;
    this.touchY = e.clientY;
  }

  private anchor(e: PointerLike): void {
    this.anchorId = e.pointerId;
    this.touchX = e.clientX;
    this.touchY = e.clientY;
  }

  /** A pointer went up or was cancelled. */
  pointerUp(e: PointerLike): void {
    if (e.pointerType === 'mouse') {
      if ((e.button ?? 0) === 0) this.mouseDown = false;
      return;
    }
    const i = this.touches.indexOf(e.pointerId);
    if (i < 0) return;
    this.touches.splice(i, 1);
    this.refresh();
  }

  /**
   * A gamepad snapshot in the standard mapping: left stick moves, right stick looks, the triggers go
   * down and up, and A or the right bumper boosts. Stick y is positive when pulled back.
   */
  gamepad(
    leftX: number, leftY: number, rightX: number, rightY: number, down: number, up: number, boost: boolean,
  ): void {
    this.padRight = deadZone(leftX);
    this.padForward = -deadZone(leftY);
    this.padTurn = -deadZone(rightX);
    this.padTilt = -deadZone(rightY);
    this.padUp = clamp(up, 0, 1) - clamp(down, 0, 1);
    this.padBoost = boost;
    this.refresh();
  }

  /** Forget everything held: the window lost focus, or the page was hidden. */
  reset(): void {
    this.keys.clear();
    this.touches.length = 0;
    this.mouseDown = false;
    this.anchorId = -1;
    this.padForward = this.padRight = this.padUp = this.padTurn = this.padTilt = 0;
    this.padBoost = false;
    this.state.lookYaw = 0;
    this.state.lookPitch = 0;
    this.refresh();
  }

  /** True while anything asks the camera to move or turn. */
  get active(): boolean {
    const s = this.state;
    return s.forward !== 0 || s.right !== 0 || s.up !== 0 || s.turn !== 0 || s.tilt !== 0
      || s.lookYaw !== 0 || s.lookPitch !== 0;
  }

  private axis(positive: string, negative: string): number {
    return (this.keys.has(positive) ? 1 : 0) - (this.keys.has(negative) ? 1 : 0);
  }

  private refresh(): void {
    const s = this.state;
    const k = this.keys;
    const touching = this.touches.length > 0 ? 1 : 0;
    s.forward = clamp(this.axis('KeyW', 'KeyS') + this.axis('ArrowUp', 'ArrowDown') + touching + this.padForward, -1, 1);
    s.right = clamp(this.axis('KeyD', 'KeyA') + this.padRight, -1, 1);
    s.up = clamp(this.axis('KeyE', 'KeyQ') + this.padUp, -1, 1);
    s.turn = clamp(this.axis('ArrowLeft', 'ArrowRight') + this.padTurn, -1, 1);
    s.tilt = clamp(this.padTilt, -1, 1);
    s.boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.touches.length > 1 || this.padBoost;
  }
}
