import { describe, expect, it } from 'vitest';
import {
  InputMapper, MOUSE_SENSITIVITY, STICK_DEAD_ZONE, TOUCH_SENSITIVITY, isCameraKey, type PointerLike,
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
    expect(m.state).toEqual({ forward: 0, right: 0, up: 0, boost: false, lookYaw: 0, lookPitch: 0, turn: 0, tilt: 0 });
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
