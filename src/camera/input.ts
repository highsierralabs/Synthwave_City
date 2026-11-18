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
/** A tap is a press no longer than this, milliseconds... */
export const TAP_TIME = 300;
/** ...that moves no further than this, pixels. */
export const TAP_SLOP = 12;
/** The second tap of a double tap goes down within this long after the first one lifted, milliseconds... */
export const DOUBLE_TAP_GAP = 350;
/** ...and this close to where the first one went down, pixels. */
export const DOUBLE_TAP_REACH = 40;
/** Lens zoom per pixel of wheel travel (a factor of e every 1/WHEEL_ZOOM pixels). */
export const WHEEL_ZOOM = 0.0015;
/** The same for a trackpad pinch, which browsers send as small wheel steps with ctrlKey set. */
export const PINCH_WHEEL_ZOOM = 0.01;
/** Fingers closer than this, pixels, do not zoom: the ratio of tiny distances is noise. */
const PINCH_MIN = 8;

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
  /**
   * Free look on the tour, radians, waiting to be applied: a drag while `tourLook` is on. Same signs
   * as lookYaw and lookPitch. Kept apart from them so it never counts as taking over. The rig zeroes them.
   */
  panYaw: number;
  panPitch: number;
  /** Lens zoom waiting to be applied, as a factor on tan(fov / 2): below 1 zooms in. The rig resets it to 1. */
  zoom: number;
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
  /** Event time, milliseconds. Taps are only recognised when it is present. */
  readonly timeStamp?: number;
}

/** The fields of a WheelEvent the mapper reads. */
export interface WheelLike {
  readonly deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode?: number;
  readonly ctrlKey?: boolean;
}

/**
 * Actions a key press can stand for. 'toggle', 'takeover' and 'viewpoint:n' are for the rig; the
 * rest are for the app, which the rig passes on untouched. 'takeover' comes from a double tap or
 * double click on the tour, not from a key.
 */
export type KeyAction =
  'toggle' | 'takeover' | 'menu' | 'mute' | 'stats' | 'mood' | 'photo' | 'station' | `viewpoint:${number}`;

const ACTION_KEYS: Readonly<Record<string, KeyAction>> = {
  Space: 'toggle',
  Escape: 'menu',
  KeyM: 'mute',
  KeyH: 'stats',
  KeyT: 'mood',
  KeyP: 'photo',
  KeyR: 'station',
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
    panYaw: 0, panPitch: 0, zoom: 1,
  };

  private readonly keys = new Set<string>();
  /** Touch pointers that are down, oldest first. The first one steers. */
  private readonly touches: number[] = [];
  /** Where each of `touches` was last seen, same order. */
  private readonly touchXs: number[] = [];
  private readonly touchYs: number[] = [];
  private look = false;
  // The press that may become a tap, and the last tap.
  private tapId = -1;
  private tapValid = false;
  private tapMouse = false;
  private tapStart = 0;
  private tapX = 0;
  private tapY = 0;
  private lastTapEnd = -Infinity;
  private lastTapMouse = false;
  private lastTapX = 0;
  private lastTapY = 0;
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
   * Free look on the tour. While on, a drag (one finger, or the left mouse button) pans instead of
   * flying, two fingers pinch to zoom, the wheel zooms, a held finger does not fly, and a double tap
   * or double click is reported by pointerUp as 'takeover'. The rig keeps it equal to "on the tour".
   */
  get tourLook(): boolean {
    return this.look;
  }

  setTourLook(on: boolean): void {
    if (on === this.look) return;
    this.look = on;
    this.tapValid = false;
    this.lastTapEnd = -Infinity;
    this.state.panYaw = 0;
    this.state.panPitch = 0;
    this.state.zoom = 1;
    this.refresh();
  }

  /**
   * A pointer went down on the view. A mouse button starts a drag look (pointer lock, when the page
   * grants it, takes over from there). The first finger steers and flies; a second one boosts.
   * On the tour (`tourLook`) the same presses pan, pinch and tap instead.
   */
  pointerDown(e: PointerLike): void {
    if (e.pointerType === 'mouse') {
      if ((e.button ?? 0) !== 0) return;
      this.mouseDown = true;
      this.tapBegin(e, true);
      return;
    }
    if (this.touches.includes(e.pointerId)) return;
    this.touches.push(e.pointerId);
    this.touchXs.push(e.clientX);
    this.touchYs.push(e.clientY);
    if (this.touches.length === 1) {
      this.anchor(e);
      this.tapBegin(e, false);
    } else {
      // A second finger makes this a pinch, not a tap.
      this.tapValid = false;
    }
    this.refresh();
  }

  /** A pointer moved. `locked` says the page holds pointer lock, so a mouse looks without a button held. */
  pointerMove(e: PointerLike, locked: boolean): void {
    const s = this.state;
    if (e.pointerType === 'mouse') {
      if (this.look) {
        if (!this.mouseDown) return;
        this.tapTrack(e);
        s.panYaw -= (e.movementX ?? 0) * MOUSE_SENSITIVITY;
        s.panPitch -= (e.movementY ?? 0) * MOUSE_SENSITIVITY;
        return;
      }
      if (!locked && !this.mouseDown) return;
      s.lookYaw -= (e.movementX ?? 0) * MOUSE_SENSITIVITY;
      s.lookPitch -= (e.movementY ?? 0) * MOUSE_SENSITIVITY;
      return;
    }
    const i = this.touches.indexOf(e.pointerId);
    if (i < 0) return;
    const px = this.touchXs[i]!, py = this.touchYs[i]!;
    this.touchXs[i] = e.clientX;
    this.touchYs[i] = e.clientY;
    if (this.look) {
      this.tapTrack(e);
      if (this.touches.length === 1) {
        s.panYaw -= (e.clientX - px) * TOUCH_SENSITIVITY;
        s.panPitch -= (e.clientY - py) * TOUCH_SENSITIVITY;
      } else if (i < 2) {
        // The first two fingers pinch: their distance before and after this move.
        const j = 1 - i;
        const ox = this.touchXs[j]!, oy = this.touchYs[j]!;
        const before = Math.hypot(px - ox, py - oy);
        const after = Math.hypot(e.clientX - ox, e.clientY - oy);
        if (before > PINCH_MIN && after > PINCH_MIN) s.zoom *= before / after;
      }
      // Keep the steering anchor current, so leaving the tour mid-touch does not jump.
      if (i === 0) this.anchor(e);
      return;
    }
    if (i !== 0) return;
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

  /**
   * A pointer went up, or was cancelled (`cancelled`, which is never a tap). Returns 'takeover' when
   * this completes a double tap or double click on the tour, else null.
   */
  pointerUp(e: PointerLike, cancelled = false): KeyAction | null {
    if (e.pointerType === 'mouse') {
      if ((e.button ?? 0) !== 0) return null;
      this.mouseDown = false;
      return this.tapEnd(e, cancelled);
    }
    const i = this.touches.indexOf(e.pointerId);
    if (i < 0) return null;
    this.touches.splice(i, 1);
    this.touchXs.splice(i, 1);
    this.touchYs.splice(i, 1);
    const action = this.tapEnd(e, cancelled);
    this.refresh();
    return action;
  }

  /** A wheel turned over the view. Zooms the lens on the tour; returns true if it was used. */
  wheel(e: WheelLike): boolean {
    if (!this.look) return false;
    const mode = e.deltaMode ?? 0;
    const pixels = e.deltaY * (mode === 1 ? 16 : mode === 2 ? 400 : 1);
    const rate = e.ctrlKey ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM;
    // Scrolling down (or pinching in) widens the view, as on a map.
    this.state.zoom *= Math.exp(clamp(pixels * rate, -1, 1));
    return true;
  }

  private tapBegin(e: PointerLike, mouse: boolean): void {
    this.tapId = e.pointerId;
    this.tapMouse = mouse;
    this.tapValid = this.look && e.timeStamp !== undefined;
    this.tapStart = e.timeStamp ?? 0;
    this.tapX = e.clientX;
    this.tapY = e.clientY;
    // A second press that starts too late, too far away or with another kind of pointer starts afresh.
    if (!this.tapValid || mouse !== this.lastTapMouse || this.tapStart - this.lastTapEnd > DOUBLE_TAP_GAP
      || Math.hypot(this.tapX - this.lastTapX, this.tapY - this.lastTapY) > DOUBLE_TAP_REACH) {
      this.lastTapEnd = -Infinity;
    }
  }

  private tapTrack(e: PointerLike): void {
    if (this.tapValid && e.pointerId === this.tapId && Math.hypot(e.clientX - this.tapX, e.clientY - this.tapY) > TAP_SLOP) {
      this.tapValid = false;
    }
  }

  private tapEnd(e: PointerLike, cancelled: boolean): KeyAction | null {
    if (e.pointerId !== this.tapId) return null;
    const time = e.timeStamp;
    const tap = this.tapValid && !cancelled && this.look && time !== undefined && time - this.tapStart <= TAP_TIME
      && Math.hypot(e.clientX - this.tapX, e.clientY - this.tapY) <= TAP_SLOP;
    this.tapValid = false;
    this.tapId = -1;
    if (!tap) {
      this.lastTapEnd = -Infinity;
      return null;
    }
    if (this.lastTapEnd > -Infinity) {
      // tapBegin already checked that this press started in time and in reach of the last tap.
      this.lastTapEnd = -Infinity;
      return 'takeover';
    }
    this.lastTapEnd = time;
    this.lastTapMouse = this.tapMouse;
    this.lastTapX = this.tapX;
    this.lastTapY = this.tapY;
    return null;
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
    this.touchXs.length = 0;
    this.touchYs.length = 0;
    this.mouseDown = false;
    this.anchorId = -1;
    this.tapId = -1;
    this.tapValid = false;
    this.lastTapEnd = -Infinity;
    this.padForward = this.padRight = this.padUp = this.padTurn = this.padTilt = 0;
    this.padBoost = false;
    this.state.lookYaw = 0;
    this.state.lookPitch = 0;
    this.state.panYaw = 0;
    this.state.panPitch = 0;
    this.state.zoom = 1;
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
    // On the tour a finger looks and zooms; it neither flies nor boosts.
    const fingers = this.look ? 0 : this.touches.length;
    const touching = fingers > 0 ? 1 : 0;
    s.forward = clamp(this.axis('KeyW', 'KeyS') + this.axis('ArrowUp', 'ArrowDown') + touching + this.padForward, -1, 1);
    s.right = clamp(this.axis('KeyD', 'KeyA') + this.padRight, -1, 1);
    s.up = clamp(this.axis('KeyE', 'KeyQ') + this.padUp, -1, 1);
    s.turn = clamp(this.axis('ArrowLeft', 'ArrowRight') + this.padTurn, -1, 1);
    s.tilt = clamp(this.padTilt, -1, 1);
    s.boost = k.has('ShiftLeft') || k.has('ShiftRight') || fingers > 1 || this.padBoost;
  }
}
