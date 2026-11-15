// The one file in src/camera that touches the DOM (plan T11, M2): it forwards browser events to
// an InputMapper and owns pointer lock. Everything it decides is decided in ./input.ts.
import { isCameraKey, type InputMapper, type KeyAction } from './input';

export interface DomBinding {
  /** Remove every listener and give back pointer lock. */
  detach(): void;
  /** Read the gamepad, if one is connected. Call once per frame. */
  poll(): void;
  /** Give back pointer lock without reporting it as a request for the menu. */
  release(): void;
}

/** Two reports of the same Escape press closer than this are one press, milliseconds. */
const ESCAPE_WINDOW = 350;

function isControl(target: EventTarget | null): boolean {
  const el = target as (HTMLElement | null);
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName);
}

export function attachDom(element: HTMLElement, mapper: InputMapper, onAction: (action: KeyAction) => void): DomBinding {
  const doc = element.ownerDocument;
  const win = doc.defaultView ?? window;
  let pads = 0;
  let wasLocked = doc.pointerLockElement === element;
  let releasing = false;
  let lastMenu = -Infinity;

  const menu = (): void => {
    const now = performance.now();
    if (now - lastMenu < ESCAPE_WINDOW) return;
    lastMenu = now;
    onAction('menu');
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!isCameraKey(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') {
      // Reported wherever the focus is, and never cancelled: the browser may need it too.
      if (!e.repeat) menu();
      return;
    }
    // A focused button or field keeps its own keys: Space presses the button, digits type.
    if (isControl(e.target)) return;
    e.preventDefault();
    const action = mapper.keyDown(e);
    if (action !== null) onAction(action);
  };
  const onKeyUp = (e: KeyboardEvent): void => mapper.keyUp(e);
  const onBlur = (): void => mapper.reset();
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') mapper.reset();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0 && doc.pointerLockElement !== element) {
        try {
          const granted: unknown = element.requestPointerLock();
          if (granted instanceof Promise) granted.catch(() => undefined);
        } catch {
          // No pointer lock here: dragging with the button held still looks around.
        }
      }
    } else {
      e.preventDefault();
    }
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; nothing to capture.
    }
    mapper.pointerDown(e);
  };
  const onPointerMove = (e: PointerEvent): void => mapper.pointerMove(e, doc.pointerLockElement === element);
  const onPointerUp = (e: PointerEvent): void => mapper.pointerUp(e);

  const onLockChange = (): void => {
    const locked = doc.pointerLockElement === element;
    // Escape leaves pointer lock, and the browser keeps that key press to itself. Losing the lock
    // without having asked to is therefore reported as the menu key.
    if (wasLocked && !locked && !releasing) menu();
    releasing = false;
    wasLocked = locked;
  };

  const onPadConnected = (): void => {
    pads++;
  };
  const onPadDisconnected = (): void => {
    pads = Math.max(0, pads - 1);
    if (pads === 0) mapper.gamepad(0, 0, 0, 0, 0, 0, false);
  };

  const previousTouchAction = element.style.touchAction;
  element.style.touchAction = 'none';
  win.addEventListener('keydown', onKeyDown);
  win.addEventListener('keyup', onKeyUp);
  win.addEventListener('blur', onBlur);
  doc.addEventListener('visibilitychange', onVisibility);
  doc.addEventListener('pointerlockchange', onLockChange);
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  win.addEventListener('gamepadconnected', onPadConnected);
  win.addEventListener('gamepaddisconnected', onPadDisconnected);

  const release = (): void => {
    if (doc.pointerLockElement !== element) return;
    releasing = true;
    doc.exitPointerLock();
  };

  return {
    detach(): void {
      release();
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      win.removeEventListener('blur', onBlur);
      doc.removeEventListener('visibilitychange', onVisibility);
      doc.removeEventListener('pointerlockchange', onLockChange);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      win.removeEventListener('gamepadconnected', onPadConnected);
      win.removeEventListener('gamepaddisconnected', onPadDisconnected);
      element.style.touchAction = previousTouchAction;
      mapper.reset();
    },
    poll(): void {
      if (pads === 0) return;
      const list = win.navigator.getGamepads();
      for (let i = 0; i < list.length; i++) {
        const pad = list[i];
        if (!pad || !pad.connected || pad.axes.length < 4) continue;
        const b = pad.buttons;
        mapper.gamepad(
          pad.axes[0]!, pad.axes[1]!, pad.axes[2]!, pad.axes[3]!,
          b[6]?.value ?? 0, b[7]?.value ?? 0, (b[0]?.pressed ?? false) || (b[5]?.pressed ?? false),
        );
        return;
      }
    },
    release,
  };
}
