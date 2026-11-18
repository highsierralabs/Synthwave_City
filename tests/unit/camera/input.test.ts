import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_GAP, DOUBLE_TAP_REACH, InputMapper, MOUSE_SENSITIVITY, PINCH_WHEEL_ZOOM, STICK_DEAD_ZONE, TAP_SLOP, TAP_TIME,
  TOUCH_SENSITIVITY, WHEEL_ZOOM, isCameraKey, type PointerLike,
} from '../../../src/camera/input';

const key = (code: string, extra: object = {}): { code: string } => ({ code, ...extra });
const mouse = (movementX: number, movementY: number, button = 0): PointerLike =>
  ({ pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, movementX, movementY, button });
const touch = (pointerId: number, clientX: number, clientY: number): PointerLike =>
  ({ pointerId, pointerType: 'touch', clientX, clientY });

describe('input: keyboard', () => {
  it('maps W A S D, Q/E and Shift to axes and boost', () => {
    const m = new InputMapper();
    expect(m.active).toBe(false);
    m.keyDown(key('KeyW'));
    expect(m.state.forward).toBe(1);
    m.keyDown(key('KeyD'));
    expect(m.state.right).toBe(1);
    m.keyDown(key('KeyE'));
    expect(m.state.up).toBe(1);
    m.keyDown(key('ShiftLeft'));
    expect(m.state.boost).toBe(true);
    expect(m.active).toBe(true);
    m.keyUp(key('KeyW'));
    m.keyDown(key('KeyS'));
    expect(m.state.forward).toBe(-1);
    m.keyUp(key('KeyD'));
    m.keyDown(key('KeyA'));
    expect(m.state.right).toBe(-1);
    m.keyUp(key('KeyE'));
    m.keyDown(key('KeyQ'));
    expect(m.state.up).toBe(-1);
    m.keyUp(key('ShiftLeft'));
    expect(m.state.boost).toBe(false);
  });

  it('cancels opposite keys and survives releasing a key that was never down', () => {
    const m = new InputMapper();
    m.keyDown(key('KeyW'));
    m.keyDown(key('KeyS'));
    expect(m.state.forward).toBe(0);
    m.keyUp(key('KeyS'));
    expect(m.state.forward).toBe(1);
    m.keyUp(key('KeyX'));
    m.keyUp(key('KeyA'));
    expect(m.state.right).toBe(0);
  });

  it('uses the arrows to fly and to turn, so the keyboard alone can steer', () => {
    const m = new InputMapper();
    m.keyDown(key('ArrowUp'));
    expect(m.state.forward).toBe(1);
    m.keyDown(key('KeyW'));
    expect(m.state.forward).toBe(1);
    m.keyDown(key('ArrowLeft'));
    expect(m.state.turn).toBe(1);
    m.keyUp(key('ArrowLeft'));
    m.keyDown(key('ArrowRight'));
    expect(m.state.turn).toBe(-1);
    m.keyUp(key('ArrowUp'));
    m.keyUp(key('KeyW'));
    m.keyDown(key('ArrowDown'));
    expect(m.state.forward).toBe(-1);
  });

  it('reports action keys instead of holding them', () => {
    const m = new InputMapper();
    expect(m.keyDown(key('Space'))).toBe('toggle');
    expect(m.keyDown(key('Escape'))).toBe('menu');
    expect(m.keyDown(key('KeyM'))).toBe('mute');
    expect(m.keyDown(key('KeyH'))).toBe('stats');
    expect(m.keyDown(key('KeyT'))).toBe('mood');
    expect(m.keyDown(key('KeyR'))).toBe('station');
    expect(m.keyDown(key('KeyP'))).toBe('photo');
    expect(m.keyDown(key('Digit1'))).toBe('viewpoint:0');
    expect(m.keyDown(key('Digit6'))).toBe('viewpoint:5');
    expect(m.keyDown(key('Numpad3'))).toBe('viewpoint:2');
    expect(m.keyDown(key('Digit7'))).toBeNull();
    expect(m.keyDown(key('KeyW'))).toBeNull();
    expect(m.keyDown(key('KeyZ'))).toBeNull();
    expect(m.active).toBe(true);
    m.keyUp(key('KeyW'));
    expect(m.active).toBe(false);
  });

  it('ignores auto-repeat for actions and leaves browser shortcuts alone', () => {
    const m = new InputMapper();
    expect(m.keyDown(key('Space', { repeat: true }))).toBeNull();
    expect(m.keyDown(key('KeyT', { ctrlKey: true }))).toBeNull();
    expect(m.keyDown(key('KeyW', { ctrlKey: true }))).toBeNull();
    expect(m.keyDown(key('KeyD', { metaKey: true }))).toBeNull();
    expect(m.keyDown(key('KeyS', { altKey: true }))).toBeNull();
    expect(m.active).toBe(false);
    // A held movement key repeating is harmless.
    m.keyDown(key('KeyW'));
    m.keyDown(key('KeyW', { repeat: true }));
    expect(m.state.forward).toBe(1);
  });

  it('knows which keys are its own', () => {
    for (const code of ['KeyW', 'ArrowLeft', 'ShiftRight', 'Space', 'Digit4', 'Escape', 'KeyP']) expect(isCameraKey(code)).toBe(true);
    for (const code of ['KeyZ', 'Digit7', 'Tab', 'F5', 'Enter']) expect(isCameraKey(code)).toBe(false);
  });

  it('forgets everything on reset', () => {
    const m = new InputMapper();
    m.keyDown(key('KeyW'));
    m.keyDown(key('ShiftLeft'));
    m.pointerDown(touch(5, 10, 10));
    m.pointerDown(mouse(0, 0));
    m.pointerMove(mouse(30, 0), false);
    m.gamepad(1, 1, 1, 1, 1, 0, true);
    m.reset();
    expect(m.state).toEqual({
      forward: 0, right: 0, up: 0, boost: false, lookYaw: 0, lookPitch: 0, turn: 0, tilt: 0, panYaw: 0, panPitch: 0, zoom: 1,
    });
    expect(m.active).toBe(false);
    m.pointerMove(mouse(30, 0), false);
    expect(m.state.lookYaw).toBe(0);
  });
});

describe('input: mouse', () => {
  it('looks only with pointer lock or a held button', () => {
    const m = new InputMapper();
    m.pointerMove(mouse(100, 50), false);
    expect(m.state.lookYaw).toBe(0);
    expect(m.active).toBe(false);
    m.pointerMove(mouse(100, 50), true);
    // Mouse right turns right (yaw falls); mouse down looks down.
    expect(m.state.lookYaw).toBeCloseTo(-100 * MOUSE_SENSITIVITY, 12);
    expect(m.state.lookPitch).toBeCloseTo(-50 * MOUSE_SENSITIVITY, 12);
    expect(m.active).toBe(true);
  });

  it('accumulates until the rig takes it, and drags with the left button only', () => {
    const m = new InputMapper();
    m.pointerDown(mouse(0, 0, 2));
    m.pointerMove(mouse(10, 0), false);
    expect(m.state.lookYaw).toBe(0);
    m.pointerDown(mouse(0, 0, 0));
    m.pointerMove(mouse(10, 0), false);
    m.pointerMove(mouse(-30, 4), false);
    expect(m.state.lookYaw).toBeCloseTo(20 * MOUSE_SENSITIVITY, 12);
    expect(m.state.lookPitch).toBeCloseTo(-4 * MOUSE_SENSITIVITY, 12);
    m.pointerUp(mouse(0, 0, 0));
    m.state.lookYaw = 0;
    m.pointerMove(mouse(10, 0), false);
    expect(m.state.lookYaw).toBe(0);
    // A mouse never flies forward by itself.
    expect(m.state.forward).toBe(0);
  });
});

describe('input: touch', () => {
  it('one finger flies forward while held and looks when dragged', () => {
    const m = new InputMapper();
    m.pointerDown(touch(7, 200, 300));
    expect(m.state.forward).toBe(1);
    expect(m.state.boost).toBe(false);
    expect(m.state.lookYaw).toBe(0);
    m.pointerMove(touch(7, 240, 280), false);
    // Drag right to look right, drag up to look up, as with a mouse.
    expect(m.state.lookYaw).toBeCloseTo(-40 * TOUCH_SENSITIVITY, 12);
    expect(m.state.lookPitch).toBeCloseTo(20 * TOUCH_SENSITIVITY, 12);
    m.pointerUp(touch(7, 240, 280));
    expect(m.state.forward).toBe(0);
  });

  it('a second finger boosts and does not steer', () => {
    const m = new InputMapper();
    m.pointerDown(touch(1, 100, 100));
    m.pointerDown(touch(2, 500, 500));
    expect(m.state.boost).toBe(true);
    expect(m.state.forward).toBe(1);
    m.pointerMove(touch(2, 900, 900), false);
    expect(m.state.lookYaw).toBe(0);
    m.pointerUp(touch(2, 900, 900));
    expect(m.state.boost).toBe(false);
    expect(m.state.forward).toBe(1);
  });

  it('hands steering to the remaining finger without a jump', () => {
    const m = new InputMapper();
    m.pointerDown(touch(1, 100, 100));
    m.pointerDown(touch(2, 500, 500));
    m.pointerUp(touch(1, 100, 100));
    expect(m.state.forward).toBe(1);
    expect(m.state.boost).toBe(false);
    // Its first move only sets the anchor: 400 px between the fingers must not become a turn.
    m.pointerMove(touch(2, 510, 500), false);
    expect(m.state.lookYaw).toBe(0);
    m.pointerMove(touch(2, 520, 500), false);
    expect(m.state.lookYaw).toBeCloseTo(-10 * TOUCH_SENSITIVITY, 12);
  });

  it('ignores a repeated down and an up for a finger it never saw', () => {
    const m = new InputMapper();
    m.pointerDown(touch(1, 0, 0));
    m.pointerDown(touch(1, 0, 0));
    expect(m.state.boost).toBe(false);
    m.pointerUp(touch(9, 0, 0));
    expect(m.state.forward).toBe(1);
    m.pointerUp(touch(1, 0, 0));
    expect(m.state.forward).toBe(0);
  });

  it('does not report taps in free flight', () => {
    const m = new InputMapper();
    m.pointerDown(tap(1, 100, 100, 0));
    expect(m.pointerUp(tap(1, 100, 100, 80))).toBeNull();
    m.pointerDown(tap(2, 100, 100, 160));
    expect(m.pointerUp(tap(2, 100, 100, 240))).toBeNull();
  });
});

const tap = (pointerId: number, clientX: number, clientY: number, timeStamp: number, pointerType = 'touch'): PointerLike =>
  ({ pointerId, pointerType, clientX, clientY, timeStamp, button: 0, movementX: 0, movementY: 0 });

function touring(): InputMapper {
  const m = new InputMapper();
  m.setTourLook(true);
  return m;
}

/** Press and lift one pointer; returns what the lift reported. */
function press(m: InputMapper, id: number, x: number, y: number, down: number, up: number, type = 'touch'): string | null {
  m.pointerDown(tap(id, x, y, down, type));
  return m.pointerUp(tap(id, x, y, up, type));
}

describe('input: free look on the tour', () => {
  it('a one-finger drag pans, and a held finger neither flies, boosts nor counts as taking over', () => {
    const m = touring();
    m.pointerDown(touch(7, 200, 300));
    expect(m.state.forward).toBe(0);
    m.pointerMove(touch(7, 240, 280), false);
    // The same sense as free flight: drag right to look right, drag up to look up.
    expect(m.state.panYaw).toBeCloseTo(-40 * TOUCH_SENSITIVITY, 12);
    expect(m.state.panPitch).toBeCloseTo(20 * TOUCH_SENSITIVITY, 12);
    expect(m.state.lookYaw).toBe(0);
    expect(m.active).toBe(false);
    m.pointerDown(touch(8, 600, 300));
    expect(m.state.boost).toBe(false);
    expect(m.active).toBe(false);
  });

  it('two fingers pinch: spreading them zooms in, closing them zooms out, and they do not pan', () => {
    const m = touring();
    m.pointerDown(touch(1, 300, 300));
    m.pointerDown(touch(2, 400, 300));
    m.pointerMove(touch(2, 500, 300), false);
    expect(m.state.zoom).toBeCloseTo(0.5, 12);
    expect(m.state.panYaw).toBe(0);
    m.state.zoom = 1;
    m.pointerMove(touch(1, 400, 300), false);
    expect(m.state.zoom).toBeCloseTo(2, 12);
    // A third finger takes no part.
    m.state.zoom = 1;
    m.pointerDown(touch(3, 0, 0));
    m.pointerMove(touch(3, 900, 900), false);
    expect(m.state.zoom).toBe(1);
  });

  it('after a pinch the remaining finger pans from where it is, without a jump', () => {
    const m = touring();
    m.pointerDown(touch(1, 100, 100));
    m.pointerDown(touch(2, 500, 500));
    m.pointerMove(touch(1, 150, 100), false);
    m.pointerUp(touch(2, 500, 500));
    m.pointerMove(touch(1, 160, 100), false);
    expect(m.state.panYaw).toBeCloseTo(-10 * TOUCH_SENSITIVITY, 12);
  });

  it('a mouse drags to pan with the left button held, never with pointer lock alone', () => {
    const m = touring();
    m.pointerMove(mouse(50, 0), true);
    expect(m.state.panYaw).toBe(0);
    expect(m.state.lookYaw).toBe(0);
    m.pointerDown(mouse(0, 0));
    m.pointerMove(mouse(50, -10), false);
    expect(m.state.panYaw).toBeCloseTo(-50 * MOUSE_SENSITIVITY, 12);
    expect(m.state.panPitch).toBeCloseTo(10 * MOUSE_SENSITIVITY, 12);
    expect(m.active).toBe(false);
  });

  it('the wheel zooms on the tour only: down widens, and a trackpad pinch counts more per step', () => {
    const m = new InputMapper();
    expect(m.wheel({ deltaY: 100 })).toBe(false);
    expect(m.state.zoom).toBe(1);
    m.setTourLook(true);
    expect(m.wheel({ deltaY: 100 })).toBe(true);
    expect(m.state.zoom).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM), 12);
    m.state.zoom = 1;
    m.wheel({ deltaY: -3, deltaMode: 1 });
    expect(m.state.zoom).toBeCloseTo(Math.exp(-48 * WHEEL_ZOOM), 12);
    m.state.zoom = 1;
    m.wheel({ deltaY: -5, ctrlKey: true });
    expect(m.state.zoom).toBeCloseTo(Math.exp(-5 * PINCH_WHEEL_ZOOM), 12);
    // One huge step is limited to a factor of e.
    m.state.zoom = 1;
    m.wheel({ deltaY: 3, deltaMode: 2 });
    expect(m.state.zoom).toBeCloseTo(Math.E, 12);
  });

  it('two quick taps in the same place are a double tap', () => {
    const m = touring();
    expect(press(m, 1, 100, 100, 0, 90)).toBeNull();
    expect(press(m, 2, 110, 95, 90 + DOUBLE_TAP_GAP - 1, 90 + DOUBLE_TAP_GAP + 60)).toBe('takeover');
    // A third tap starts a new pair.
    expect(press(m, 3, 110, 95, 600, 650)).toBeNull();
  });

  it('a double click is a double tap', () => {
    const m = touring();
    expect(press(m, 1, 300, 200, 0, 70, 'mouse')).toBeNull();
    expect(press(m, 1, 300, 200, 150, 220, 'mouse')).toBe('takeover');
  });

  it('is not fooled by slow, distant, long, moving, pinching, cancelled or mixed presses', () => {
    let m = touring();
    press(m, 1, 100, 100, 0, 50);
    expect(press(m, 2, 100, 100, 50 + DOUBLE_TAP_GAP + 1, 500)).toBeNull();

    m = touring();
    press(m, 1, 100, 100, 0, 50);
    expect(press(m, 2, 100 + DOUBLE_TAP_REACH + 1, 100, 100, 150)).toBeNull();

    m = touring();
    press(m, 1, 100, 100, 0, TAP_TIME + 1);
    expect(press(m, 2, 100, 100, TAP_TIME + 50, TAP_TIME + 100)).toBeNull();

    m = touring();
    m.pointerDown(tap(1, 100, 100, 0));
    m.pointerMove(tap(1, 100 + TAP_SLOP + 1, 100, 20), false);
    m.pointerMove(tap(1, 100, 100, 40), false);
    expect(m.pointerUp(tap(1, 100, 100, 60))).toBeNull();
    expect(press(m, 2, 100, 100, 100, 150)).toBeNull();

    m = touring();
    press(m, 1, 100, 100, 0, 50);
    m.pointerDown(tap(2, 100, 100, 100));
    m.pointerDown(tap(3, 300, 100, 110));
    expect(m.pointerUp(tap(3, 300, 100, 120))).toBeNull();
    expect(m.pointerUp(tap(2, 100, 100, 130))).toBeNull();

    m = touring();
    press(m, 1, 100, 100, 0, 50);
    m.pointerDown(tap(2, 100, 100, 100));
    expect(m.pointerUp(tap(2, 100, 100, 150), true)).toBeNull();

    m = touring();
    press(m, 1, 100, 100, 0, 50);
    expect(press(m, 1, 100, 100, 100, 150, 'mouse')).toBeNull();

    // Without event times there are no taps at all.
    m = touring();
    m.pointerDown(touch(1, 100, 100));
    m.pointerUp(touch(1, 100, 100));
    m.pointerDown(touch(2, 100, 100));
    expect(m.pointerUp(touch(2, 100, 100))).toBeNull();
  });

  it('switching free look off restores flying, drops waiting look and forgets a half double tap', () => {
    const m = touring();
    m.pointerDown(touch(4, 100, 100));
    m.pointerMove(touch(4, 130, 100), false);
    m.wheel({ deltaY: 50 });
    m.setTourLook(false);
    expect(m.state.panYaw).toBe(0);
    expect(m.state.zoom).toBe(1);
    // The finger still down now flies, and steers from where it is.
    expect(m.state.forward).toBe(1);
    m.pointerMove(touch(4, 140, 100), false);
    expect(m.state.lookYaw).toBeCloseTo(-10 * TOUCH_SENSITIVITY, 12);
    m.pointerUp(touch(4, 140, 100));
    m.setTourLook(true);
    press(m, 6, 100, 100, 200, 240);
    m.setTourLook(false);
    m.setTourLook(true);
    expect(press(m, 5, 100, 100, 300, 340)).toBeNull();
  });
});

describe('input: gamepad', () => {
  it('maps sticks, triggers and the boost button', () => {
    const m = new InputMapper();
    m.gamepad(1, -1, -1, 1, 0, 1, true);
    expect(m.state.right).toBe(1);
    expect(m.state.forward).toBe(1);
    expect(m.state.turn).toBe(1);
    expect(m.state.tilt).toBe(-1);
    expect(m.state.up).toBe(1);
    expect(m.state.boost).toBe(true);
    m.gamepad(0, 0, 0, 0, 0.5, 0, false);
    expect(m.state.up).toBe(-0.5);
    expect(m.state.boost).toBe(false);
  });

  it('has a dead zone and rescales beyond it', () => {
    const m = new InputMapper();
    m.gamepad(STICK_DEAD_ZONE * 0.9, -STICK_DEAD_ZONE * 0.9, 0.05, -0.05, 0, 0, false);
    expect(m.active).toBe(false);
    m.gamepad((1 + STICK_DEAD_ZONE) / 2, 0, 0, 0, 0, 0, false);
    expect(m.state.right).toBeCloseTo(0.5, 12);
    m.gamepad(Number.NaN, 0, 0, 0, 0, 0, false);
    expect(m.state.right).toBe(0);
  });

  it('adds to the keyboard without exceeding full deflection', () => {
    const m = new InputMapper();
    m.keyDown(key('KeyW'));
    m.gamepad(0, -1, 0, 0, 0, 0, false);
    expect(m.state.forward).toBe(1);
  });
});
