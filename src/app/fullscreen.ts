// Full screen (plan T12, M7). Pure helpers over the small part of `document` they need, so they run
// under Vitest without a DOM. Safari on iPad before 16.4 has only the webkit-prefixed API; Safari on
// iPhone has neither, for anything but video.

interface FullscreenTarget {
  requestFullscreen?: (options?: { navigationUI?: 'auto' | 'hide' | 'show' }) => Promise<void>;
  webkitRequestFullscreen?: () => void;
}

export interface FullscreenDoc {
  readonly documentElement: FullscreenTarget;
  readonly fullscreenEnabled?: boolean;
  readonly webkitFullscreenEnabled?: boolean;
  readonly fullscreenElement?: unknown;
  readonly webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
  addEventListener(type: string, listener: () => void): void;
}

/** Whether this page may put the document into full screen. */
export function fullscreenSupported(doc: FullscreenDoc): boolean {
  const el = doc.documentElement;
  if (doc.fullscreenEnabled === true && typeof el.requestFullscreen === 'function') return true;
  return doc.webkitFullscreenEnabled === true && typeof el.webkitRequestFullscreen === 'function';
}

/** Whether something is in full screen right now. */
export function isFullscreen(doc: FullscreenDoc): boolean {
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
}

/**
 * Enter or leave full screen. Entering must run inside a user gesture. Resolves once the request
 * has been made; the real state arrives through onFullscreenChange. Never rejects.
 */
export async function setFullscreen(doc: FullscreenDoc, on: boolean): Promise<void> {
  if (on === isFullscreen(doc)) return;
  try {
    if (on) {
      const el = doc.documentElement;
      if (doc.fullscreenEnabled === true && typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        el.webkitRequestFullscreen();
      }
    } else if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen();
    } else if (typeof doc.webkitExitFullscreen === 'function') {
      doc.webkitExitFullscreen();
    }
  } catch (error) {
    // Refused (no gesture, an iframe without permission, the user declined): stay as we are.
    console.warn('full screen refused:', error instanceof Error ? error.message : String(error));
  }
}

/** Call `listener` whenever full screen is entered or left, by us or by the browser. */
export function onFullscreenChange(doc: FullscreenDoc, listener: () => void): void {
  doc.addEventListener('fullscreenchange', listener);
  doc.addEventListener('webkitfullscreenchange', listener);
}

/** Launched from a home-screen icon, with no browser bars to hide. */
export function isStandalone(
  matchMedia: (query: string) => { matches: boolean },
  nav: { standalone?: boolean },
): boolean {
  return nav.standalone === true
    || matchMedia('(display-mode: fullscreen)').matches
    || matchMedia('(display-mode: standalone)').matches;
}
