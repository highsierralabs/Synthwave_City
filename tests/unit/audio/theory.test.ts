import { describe, expect, it } from 'vitest';
import {
  degreeToSemitones, intervalFrom, isInScale, midiToHz, MINOR_SCALE, mod, placeAtOrAbove, snapToChord,
} from '../../../src/audio/theory';

describe('theory', () => {
  it('midiToHz: concert pitch and octaves', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(57)).toBeCloseTo(220, 9);
    expect(midiToHz(81)).toBeCloseTo(880, 9);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
  });

  it('degreeToSemitones walks the natural minor scale through every octave', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(degreeToSemitones)).toEqual([...MINOR_SCALE]);
    expect(degreeToSemitones(7)).toBe(12);
    expect(degreeToSemitones(9)).toBe(15);
    expect(degreeToSemitones(-1)).toBe(-2);
    expect(degreeToSemitones(-7)).toBe(-12);
    for (let d = -20; d < 20; d++) {
      expect(degreeToSemitones(d + 7) - degreeToSemitones(d)).toBe(12);
      expect(degreeToSemitones(d + 1)).toBeGreaterThan(degreeToSemitones(d));
    }
  });

  it('intervalFrom: fifths are perfect on every chord root the song uses', () => {
    for (const root of [0, 2, 3, 4, 5, 6]) {
      expect(intervalFrom(root, 4)).toBe(7);
      expect(intervalFrom(root, 7)).toBe(12);
    }
    // The second degree carries the diminished chord, which is why no progression uses it.
    expect(intervalFrom(1, 4)).toBe(6);
  });

  it('placeAtOrAbove lands in the octave starting at the floor', () => {
    for (let pc = -24; pc < 24; pc++) {
      for (const low of [33, 55, 57, 62]) {
        const midi = placeAtOrAbove(pc, low);
        expect(midi).toBeGreaterThanOrEqual(low);
        expect(midi).toBeLessThan(low + 12);
        expect(mod(midi - pc, 12)).toBe(0);
      }
    }
  });

  it('isInScale accepts exactly the seven notes of the key', () => {
    const a = [];
    for (let midi = 57; midi < 69; midi++) if (isInScale(midi, 9)) a.push(midi - 57);
    expect(a).toEqual([...MINOR_SCALE]);
    expect(isInScale(60 + 3, 0)).toBe(true);
    expect(isInScale(60 + 4, 0)).toBe(false);
    expect(isInScale(60 + 4, 12 * 5)).toBe(false);
  });

  it('snapToChord returns the nearest chord tone and leaves chord tones alone', () => {
    const triad = [0, 2, 4];
    for (let root = 0; root < 7; root++) {
      for (let degree = -10; degree < 15; degree++) {
        const snapped = snapToChord(degree, root, triad);
        expect(triad).toContain(mod(snapped - root, 7));
        expect(Math.abs(snapped - degree)).toBeLessThanOrEqual(1);
        if (triad.includes(mod(degree - root, 7))) expect(snapped).toBe(degree);
      }
    }
    // Root or fifth only: the third is two steps from both, and a tie goes down.
    expect(snapToChord(2, 0, [0, 4])).toBe(0);
    expect(snapToChord(3, 0, [0, 4])).toBe(4);
    expect([0, 4]).toContain(mod(snapToChord(9, 3, [0, 4]) - 3, 7));
  });
});
