// Pitch helpers for the composition: natural minor scale, MIDI numbers, frequencies. Pure.

/** Semitones of the natural minor scale above its tonic. */
export const MINOR_SCALE: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

/** Scale degrees per octave. */
export const DEGREES = 7;

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** v reduced into [0, m). */
export function mod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

/** Semitones above the tonic of any scale degree: 0 is the tonic, 7 the octave, -1 the seventh below. */
export function degreeToSemitones(degree: number): number {
  const octave = Math.floor(degree / DEGREES);
  return octave * 12 + MINOR_SCALE[degree - octave * DEGREES]!;
}

/** Semitones from scale degree `from` up (or down) to `from + steps`. */
export function intervalFrom(from: number, steps: number): number {
  return degreeToSemitones(from + steps) - degreeToSemitones(from);
}

/** The lowest MIDI note at or above `low` whose pitch class is `pitchClass` (any integer, taken mod 12). */
export function placeAtOrAbove(pitchClass: number, low: number): number {
  return low + mod(pitchClass - low, 12);
}

/** True when `midi` is a note of the natural minor scale on `tonic` (a pitch class or any MIDI tonic). */
export function isInScale(midi: number, tonic: number): boolean {
  return MINOR_SCALE.includes(mod(midi - tonic, 12));
}

/**
 * The scale degree nearest to `degree` that is a chord tone of the chord on `root`. `allowed` lists the
 * accepted distances above the root in scale steps (0 root, 2 third, 4 fifth). Ties go downwards.
 */
export function snapToChord(degree: number, root: number, allowed: readonly number[]): number {
  for (let k = 0; k < DEGREES; k++) {
    if (allowed.includes(mod(degree - k - root, DEGREES))) return degree - k;
    if (allowed.includes(mod(degree + k - root, DEGREES))) return degree + k;
  }
  return degree;
}
