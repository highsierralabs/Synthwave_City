import { describe, expect, it } from 'vitest';
import { CRT_PITCH_CSS, crtPitch } from '../../../src/post/grade';

describe('CRT pitch', () => {
  it('keeps a scanline the same size in CSS pixels at any pixel ratio', () => {
    for (const ratio of [1, 1.5, 2, 2.625, 3]) expect(crtPitch(ratio) / ratio).toBeCloseTo(CRT_PITCH_CSS, 9);
  });
  it('never draws a line finer than 3 device pixels', () => {
    for (const ratio of [0.25, 0.5, 0.7, 0.85]) expect(crtPitch(ratio)).toBeGreaterThanOrEqual(3);
  });
});
