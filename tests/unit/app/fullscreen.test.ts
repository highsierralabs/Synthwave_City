import { describe, expect, it, vi } from 'vitest';
import {
  fullscreenSupported, isFullscreen, isStandalone, onFullscreenChange, setFullscreen, type FullscreenDoc,
} from '../../../src/app/fullscreen';

type Fake = FullscreenDoc & { calls: string[]; fullscreenElement: unknown; webkitFullscreenElement: unknown };

function standardDoc(enabled = true): Fake {
  const doc: Fake = {
    calls: [],
    fullscreenEnabled: enabled,
    fullscreenElement: null,
    webkitFullscreenElement: undefined,
    documentElement: {
      requestFullscreen: (options) => {
        doc.calls.push(`request:${options?.navigationUI ?? ''}`);
        doc.fullscreenElement = doc.documentElement;
        return Promise.resolve();
      },
    },
    exitFullscreen: () => {
      doc.calls.push('exit');
      doc.fullscreenElement = null;
      return Promise.resolve();
    },
    addEventListener: (type) => {
      doc.calls.push(`listen:${type}`);
    },
  };
  return doc;
}

function webkitDoc(): Fake {
  const doc: Fake = {
    calls: [],
    webkitFullscreenEnabled: true,
    fullscreenElement: undefined,
    webkitFullscreenElement: null,
    documentElement: {
      webkitRequestFullscreen: () => {
        doc.calls.push('webkit-request');
        doc.webkitFullscreenElement = doc.documentElement;
      },
    },
    webkitExitFullscreen: () => {
      doc.calls.push('webkit-exit');
      doc.webkitFullscreenElement = null;
    },
    addEventListener: () => {},
  };
  return doc;
}

describe('fullscreen', () => {
  it('detects the standard and the prefixed API, and their absence', () => {
    expect(fullscreenSupported(standardDoc())).toBe(true);
    expect(fullscreenSupported(webkitDoc())).toBe(true);
    // Disabled by the browser (an iframe without permission, for example).
    expect(fullscreenSupported(standardDoc(false))).toBe(false);
    // Safari on iPhone: no element full screen at all.
    expect(fullscreenSupported({ documentElement: {}, addEventListener: () => {} })).toBe(false);
  });

  it('enters and leaves with the standard API, hiding navigation', async () => {
    const doc = standardDoc();
    expect(isFullscreen(doc)).toBe(false);
    await setFullscreen(doc, true);
    expect(isFullscreen(doc)).toBe(true);
    await setFullscreen(doc, true); // already there: no second request
    await setFullscreen(doc, false);
    expect(isFullscreen(doc)).toBe(false);
    expect(doc.calls).toEqual(['request:hide', 'exit']);
  });

  it('falls back to the webkit API', async () => {
    const doc = webkitDoc();
    await setFullscreen(doc, true);
    expect(isFullscreen(doc)).toBe(true);
    await setFullscreen(doc, false);
    expect(isFullscreen(doc)).toBe(false);
    expect(doc.calls).toEqual(['webkit-request', 'webkit-exit']);
  });

  it('never rejects when the browser refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = standardDoc();
    doc.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Permissions check failed'));
    await expect(setFullscreen(doc, true)).resolves.toBeUndefined();
    expect(isFullscreen(doc)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('listens to both change events', () => {
    const doc = standardDoc();
    onFullscreenChange(doc, () => {});
    expect(doc.calls).toEqual(['listen:fullscreenchange', 'listen:webkitfullscreenchange']);
  });

  it('recognises a home-screen launch', () => {
    const media = (hit: string) => (q: string) => ({ matches: q === hit });
    expect(isStandalone(media('none'), {})).toBe(false);
    expect(isStandalone(media('(display-mode: standalone)'), {})).toBe(true);
    expect(isStandalone(media('(display-mode: fullscreen)'), {})).toBe(true);
    expect(isStandalone(media('none'), { standalone: true })).toBe(true);
  });
});
