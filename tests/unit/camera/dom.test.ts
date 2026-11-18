// src/camera/dom.ts is the only DOM code in the module. It is tested here against hand-made
// stand-ins built on Node's own EventTarget: no jsdom, and no claim about a real browser.
import { describe, expect, it } from 'vitest';
import { attachDom } from '../../../src/camera/dom';
import { InputMapper, type KeyAction } from '../../../src/camera/input';
import { createCameraRig } from '../../../src/camera/index';
import { emptyPlan, makeFrame, makePose } from './helpers';

interface FakePad { connected: boolean; axes: number[]; buttons: { value: number; pressed: boolean }[] }

function fakePage(): {
  element: HTMLElement; win: EventTarget; doc: EventTarget & { pointerLockElement: unknown; visibilityState: string };
  pads: (FakePad | null)[]; lockRequests: () => number; captured: number[];
} {
  const pads: (FakePad | null)[] = [];
  const win = Object.assign(new EventTarget(), { navigator: { getGamepads: () => pads } });
  const doc = Object.assign(new EventTarget(), {
    defaultView: win,
    pointerLockElement: null as unknown,
    visibilityState: 'visible',
    exitPointerLock(): void {
      doc.pointerLockElement = null;
      doc.dispatchEvent(new Event('pointerlockchange'));
    },
  });
  let requests = 0;
  const captured: number[] = [];
  const element = Object.assign(new EventTarget(), {
    ownerDocument: doc,
    style: { touchAction: 'auto' },
    tagName: 'CANVAS',
    requestPointerLock(): Promise<void> {
      requests++;
      doc.pointerLockElement = element;
      doc.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    },
    setPointerCapture(id: number): void {
      captured.push(id);
    },
  });
  return { element: element as unknown as HTMLElement, win, doc, pads, lockRequests: () => requests, captured };
}

function fire(target: EventTarget, type: string, fields: object = {}): Event {
  const event = new Event(type, { cancelable: true });
  // Own properties, because some (timeStamp) are getters on Event.prototype that assignment cannot shadow.
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(event, k, { value: v, configurable: true });
  target.dispatchEvent(event);
  return event;
}

function attach(): ReturnType<typeof fakePage> & { mapper: InputMapper; actions: KeyAction[]; binding: ReturnType<typeof attachDom> } {
  const page = fakePage();
  const mapper = new InputMapper();
  const actions: KeyAction[] = [];
  const binding = attachDom(page.element, mapper, (a) => actions.push(a));
  return { ...page, mapper, actions, binding };
}

describe('dom binding', () => {
  it('feeds keys from the window to the mapper and cancels their default', () => {
    const { win, mapper, actions } = attach();
    const down = fire(win, 'keydown', { code: 'KeyW' });
    expect(mapper.state.forward).toBe(1);
    expect(down.defaultPrevented).toBe(true);
    fire(win, 'keyup', { code: 'KeyW' });
    expect(mapper.state.forward).toBe(0);
    expect(fire(win, 'keydown', { code: 'Space' }).defaultPrevented).toBe(true);
    fire(win, 'keydown', { code: 'Digit2' });
    fire(win, 'keydown', { code: 'KeyM' });
    expect(actions).toEqual(['toggle', 'viewpoint:1', 'mute']);
  });

  it('leaves alone keys that are not the camera\'s, and browser shortcuts', () => {
    const { win, mapper, actions } = attach();
    expect(fire(win, 'keydown', { code: 'Tab' }).defaultPrevented).toBe(false);
    expect(fire(win, 'keydown', { code: 'KeyT', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(fire(win, 'keydown', { code: 'KeyW', metaKey: true }).defaultPrevented).toBe(false);
    expect(actions).toEqual([]);
    expect(mapper.active).toBe(false);
  });

  it('lets a focused button or field keep its keys, but always reports Escape', () => {
    const { win, mapper, actions } = attach();
    // A key event whose target is a control: dispatchEvent sets the real target, so shadow the getter.
    const keyIn = (target: object, code: string): Event => {
      const event = new Event('keydown', { cancelable: true });
      Object.assign(event, { code });
      Object.defineProperty(event, 'target', { get: () => target });
      win.dispatchEvent(event);
      return event;
    };
    for (const tagName of ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']) {
      const control = { tagName, isContentEditable: false };
      expect(keyIn(control, 'Space').defaultPrevented).toBe(false);
      expect(keyIn(control, 'KeyW').defaultPrevented).toBe(false);
      expect(keyIn(control, 'Digit1').defaultPrevented).toBe(false);
    }
    expect(keyIn({ tagName: 'DIV', isContentEditable: true }, 'KeyM').defaultPrevented).toBe(false);
    expect(actions).toEqual([]);
    expect(mapper.state.forward).toBe(0);
    const escape = keyIn({ tagName: 'BUTTON', isContentEditable: false }, 'Escape');
    expect(actions).toEqual(['menu']);
    expect(escape.defaultPrevented).toBe(false);
    // The canvas itself is not a control.
    expect(keyIn({ tagName: 'CANVAS', isContentEditable: false }, 'KeyW').defaultPrevented).toBe(true);
    expect(mapper.state.forward).toBe(1);
  });

  it('asks for pointer lock on a left click and looks while it is held', () => {
    const { element, mapper, lockRequests, doc } = attach();
    fire(element, 'pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, movementX: 50, movementY: 0 });
    expect(mapper.state.lookYaw).toBe(0);
    fire(element, 'pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, button: 0 });
    expect(lockRequests()).toBe(1);
    expect(doc.pointerLockElement).toBe(element);
    fire(element, 'pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, button: 0 });
    fire(element, 'pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, movementX: 50, movementY: 0 });
    expect(mapper.state.lookYaw).toBeLessThan(0);
    // Clicking again while locked does not ask again.
    fire(element, 'pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, button: 0 });
    expect(lockRequests()).toBe(1);
  });

  it('on the tour: a click asks for no lock, the wheel zooms, and a double click takes over and locks', () => {
    const { element, mapper, lockRequests, actions, doc } = attach();
    mapper.setTourLook(true);
    const m = (t: number): object => ({ pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 50, button: 0, timeStamp: t });
    fire(element, 'pointerdown', m(0));
    expect(lockRequests()).toBe(0);
    fire(element, 'pointerup', m(60));
    expect(actions).toEqual([]);
    const wheel = fire(element, 'wheel', { deltaY: 100, deltaMode: 0, ctrlKey: false });
    expect(wheel.defaultPrevented).toBe(true);
    expect(mapper.state.zoom).toBeGreaterThan(1);
    fire(element, 'pointerdown', m(150));
    expect(lockRequests()).toBe(0);
    fire(element, 'pointerup', m(210));
    expect(actions).toEqual(['takeover']);
    expect(lockRequests()).toBe(1);
    expect(doc.pointerLockElement).toBe(element);
    // Off the tour the wheel is the browser's.
    mapper.setTourLook(false);
    expect(fire(element, 'wheel', { deltaY: 100, deltaMode: 0, ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('a double tap takes over without asking for pointer lock, and a cancelled touch is never a tap', () => {
    const { element, mapper, lockRequests, actions } = attach();
    mapper.setTourLook(true);
    const t = (id: number, ms: number): object => ({ pointerId: id, pointerType: 'touch', clientX: 80, clientY: 80, timeStamp: ms });
    fire(element, 'pointerdown', t(1, 0));
    fire(element, 'pointerup', t(1, 50));
    fire(element, 'pointerdown', t(2, 100));
    fire(element, 'pointercancel', t(2, 150));
    expect(actions).toEqual([]);
    fire(element, 'pointerdown', t(3, 200));
    fire(element, 'pointerup', t(3, 250));
    fire(element, 'pointerdown', t(4, 300));
    fire(element, 'pointerup', t(4, 350));
    expect(actions).toEqual(['takeover']);
    expect(lockRequests()).toBe(0);
  });

  it('reports losing pointer lock as the menu key, once, and not when it gave the lock back itself', () => {
    const { element, doc, actions, binding } = attach();
    fire(element, 'pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, button: 0 });
    // The browser takes Escape and drops the lock.
    doc.pointerLockElement = null;
    fire(doc, 'pointerlockchange');
    expect(actions).toEqual(['menu']);
    // If the key press arrives as well, it is the same press.
    fire(element.ownerDocument.defaultView as unknown as EventTarget, 'keydown', { code: 'Escape' });
    expect(actions).toEqual(['menu']);
    actions.length = 0;
    fire(element, 'pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, button: 0 });
    binding.release();
    expect(doc.pointerLockElement).toBeNull();
    expect(actions).toEqual([]);
  });

  it('captures touches, stops the browser from scrolling, and restores the element on detach', () => {
    const { element, mapper, captured, binding, win } = attach();
    expect(element.style.touchAction).toBe('none');
    const down = fire(element, 'pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(down.defaultPrevented).toBe(true);
    expect(captured).toEqual([4]);
    expect(mapper.state.forward).toBe(1);
    fire(element, 'pointercancel', { pointerId: 4, pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(mapper.state.forward).toBe(0);
    fire(win, 'keydown', { code: 'KeyD' });
    binding.detach();
    expect(element.style.touchAction).toBe('auto');
    expect(mapper.active).toBe(false);
    fire(win, 'keydown', { code: 'KeyW' });
    fire(element, 'pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(mapper.active).toBe(false);
  });

  it('drops held keys when the window loses focus or the page is hidden', () => {
    const { win, doc, mapper } = attach();
    fire(win, 'keydown', { code: 'KeyW' });
    fire(win, 'blur');
    expect(mapper.state.forward).toBe(0);
    fire(win, 'keydown', { code: 'KeyW' });
    doc.visibilityState = 'hidden';
    fire(doc, 'visibilitychange');
    expect(mapper.state.forward).toBe(0);
  });

  it('polls a gamepad only once one has connected', () => {
    const { win, pads, mapper, binding } = attach();
    pads.push({ connected: true, axes: [1, 0, 0, 0], buttons: [] });
    binding.poll();
    expect(mapper.state.right).toBe(0);
    fire(win, 'gamepadconnected');
    binding.poll();
    expect(mapper.state.right).toBe(1);
    fire(win, 'gamepaddisconnected');
    expect(mapper.state.right).toBe(0);
  });
});

describe('rig.attachInput', () => {
  it('wires the page to the rig, and its detach function unwires it', () => {
    const page = fakePage();
    const actions: string[] = [];
    const rig = createCameraRig(emptyPlan(), { onAction: (a) => actions.push(a) });
    const frame = makeFrame(0, 0);
    const pose = makePose();
    rig.update(frame, pose);
    const detach = rig.attachInput(page.element);
    fire(page.win, 'keydown', { code: 'Space' });
    expect(rig.mode).toBe('free');
    fire(page.win, 'keydown', { code: 'KeyH' });
    fire(page.win, 'keydown', { code: 'Digit1' });
    expect(actions).toEqual(['mode', 'stats', 'viewpoint:0']);
    // Going back to the tour gives up pointer lock, so a resting mouse cannot take over again.
    fire(page.element, 'pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, button: 0 });
    expect(page.doc.pointerLockElement).toBe(page.element);
    rig.setMode('tour');
    expect(page.doc.pointerLockElement).toBeNull();
    expect(actions).toEqual(['mode', 'stats', 'viewpoint:0', 'mode']);
    detach();
    fire(page.win, 'keydown', { code: 'Space' });
    expect(rig.mode).toBe('tour');
    expect(page.element.style.touchAction).toBe('auto');
  });

  it('on the tour a drag does not take over, and a double tap does', () => {
    const page = fakePage();
    const actions: string[] = [];
    const rig = createCameraRig(emptyPlan(), { onAction: (a) => actions.push(a) });
    const frame = makeFrame(0, 0);
    const pose = makePose();
    rig.update(frame, pose);
    rig.attachInput(page.element);
    const t = (id: number, x: number, ms: number): object => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: 80, timeStamp: ms });
    fire(page.element, 'pointerdown', t(1, 100, 0));
    fire(page.element, 'pointermove', t(1, 300, 100));
    fire(page.element, 'pointerup', t(1, 300, 200));
    frame.dt = 1 / 60;
    frame.time += frame.dt;
    rig.update(frame, pose);
    expect(rig.mode).toBe('tour');
    fire(page.element, 'pointerdown', t(2, 100, 1000));
    fire(page.element, 'pointerup', t(2, 100, 1050));
    fire(page.element, 'pointerdown', t(3, 100, 1150));
    fire(page.element, 'pointerup', t(3, 100, 1200));
    expect(rig.mode).toBe('free');
    expect(actions).toEqual(['mode']);
    expect(page.lockRequests()).toBe(0);
  });
});
