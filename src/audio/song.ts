// The composition: which note, when, how loud. Pure and deterministic: bar n of a seed is always the
// same events, whatever order bars are asked for in. Nothing here touches Web Audio.
//
// Shape of the music. The song is an endless chain of movements. A movement has a key (natural
// minor), a verse and a chorus chord progression, bass and arpeggio patterns and a two-bar lead
// motif pair, all drawn from its own seeded generator, and a form of six to eight 8-bar sections.
// The key moves at every movement boundary, always across a quiet section.
import { createRng, hashInts, type Rng } from '../core/random';
import { degreeToSemitones, DEGREES, intervalFrom, mod, placeAtOrAbove, snapToChord } from './theory';

export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = 16;
/** Length of one sixteenth-note step, in beats. */
export const STEP_BEATS = BEATS_PER_BAR / STEPS_PER_BAR;
export const BARS_PER_SECTION = 8;
/** No form is longer than this many sections. */
export const MAX_SECTIONS_PER_MOVEMENT = 8;

export const Voice = {
  kick: 0,
  snare: 1,
  hat: 2,
  openHat: 3,
  tom: 4,
  crash: 5,
  riser: 6,
  bass: 7,
  pad: 8,
  arp: 9,
  lead: 10,
  whoosh: 11,
} as const;
export type VoiceId = (typeof Voice)[keyof typeof Voice];
export const VOICE_NAMES: readonly string[] = Object.keys(Voice);

/** Voices whose `midi` is a note of the key. */
export function isMelodic(voice: VoiceId): boolean {
  return voice === Voice.bass || voice === Voice.pad || voice === Voice.arp || voice === Voice.lead;
}

export type SectionKind = 'intro' | 'verse' | 'chorus' | 'break';

export interface NoteEvent {
  readonly voice: VoiceId;
  /** Onset in beats from the start of the bar, in [0, BEATS_PER_BAR). */
  readonly beat: number;
  /** Length in beats. A pad may ring past the end of its bar. */
  readonly duration: number;
  /** MIDI note for melodic voices and toms; 0 for noise voices. */
  readonly midi: number;
  /** 0..1. */
  readonly velocity: number;
  /** Brightness, 0..1. For the snare and toms: how much gated reverb. */
  readonly tone: number;
  /** -1 (left) .. 1 (right). For a whoosh: the direction it travels. */
  readonly pan: number;
  /** Lead only: semitones away from `midi` the pitch starts and slides in from; 0 for none. */
  readonly glide: number;
}

export interface Chord {
  /** Scale degree of the root, 0..6 (0 is the tonic chord). */
  readonly root: number;
  /** The added colour note in scale steps above the root: 6 is the seventh, 8 the ninth. */
  readonly colour: number;
}

export interface SectionInfo {
  /** Counts sections from the start of the song. */
  readonly index: number;
  readonly kind: SectionKind;
  /** How many sections of this kind came before it in its movement. */
  readonly variant: number;
  readonly movement: number;
  readonly startBar: number;
  /** Pitch class of the key this section sounds in, 0 (C) .. 11 (B). */
  readonly tonic: number;
  /** Semitones this section sounds above its movement's key: 2 for a movement's third chorus, else 0. */
  readonly transpose: number;
  readonly nextKind: SectionKind;
  readonly prevKind: SectionKind | null;
}

export interface Bar {
  readonly index: number;
  readonly section: SectionInfo;
  /** 0..7. */
  readonly barInSection: number;
  readonly chord: Chord;
  /** Loudness of this bar, 0..1. */
  readonly energy: number;
  /** Sorted by beat, then voice. */
  readonly events: readonly NoteEvent[];
}

export interface Song {
  readonly seed: number;
  /** The events of one bar. Bars count from 0; a negative or fractional index is clamped and floored. */
  bar(index: number): Bar;
  sectionAt(bar: number): SectionInfo;
  /** Loudness 0..1 at a beat position, eased over the first beat of each bar. */
  energyAt(beat: number): number;
}

// ---- Material ---------------------------------------------------------------------------------------

/** Tonics a song may open in: A, D, E, F sharp, B, C, G. */
const HOME_KEYS: readonly number[] = [9, 2, 4, 6, 11, 0, 7];
/** Key changes between movements, in semitones: to the fourth, fifth, relative-style thirds, a tone. */
const KEY_MOVES: readonly number[] = [5, 7, 3, -3, 2, -2, -4];

const FIRST_FORM: readonly SectionKind[] = ['intro', 'verse', 'verse', 'chorus', 'break', 'verse', 'chorus', 'chorus'];
const LATER_FORMS: readonly (readonly SectionKind[])[] = [
  ['break', 'verse', 'chorus', 'verse', 'chorus', 'chorus'],
  ['intro', 'verse', 'verse', 'chorus', 'break', 'chorus', 'chorus'],
  ['break', 'verse', 'verse', 'chorus', 'break', 'verse', 'chorus'],
  ['intro', 'verse', 'chorus', 'break', 'verse', 'chorus', 'chorus'],
];

/** Four-bar progressions as scale degrees of natural minor (0 i, 2 III, 3 iv, 4 v, 5 VI, 6 VII). */
const HOME_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 5, 2, 6],
  [0, 6, 5, 6],
  [0, 2, 6, 3],
  [0, 4, 5, 3],
  [0, 5, 3, 6],
  [0, 0, 5, 6],
  [0, 3, 5, 6],
];
/** Progressions that start away from the tonic, for the lift into a chorus. */
const LIFT_PROGRESSIONS: readonly (readonly number[])[] = [
  [5, 6, 0, 0],
  [5, 2, 6, 0],
  [3, 5, 0, 6],
  [5, 6, 4, 0],
  [5, 6, 0, 2],
  [3, 6, 2, 5],
];

/** Sixteen steps of bass, as scale steps above the chord root (4 the fifth, 7 the octave); -1 rests. */
const BASS_PATTERNS: readonly (readonly number[])[] = [
  [0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 7, 7],
  [0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7],
  [0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 7, 4],
  [0, 4, 7, 4, 0, 4, 7, 9, 0, 4, 7, 4, 0, 7, 4, 7],
  [0, -1, 0, 0, 7, -1, 0, 0, 0, -1, 0, 0, 7, 0, 4, 7],
  [0, 0, 7, 0, 4, 0, 7, 0, 0, 0, 7, 0, 9, 7, 4, 7],
];

/** Sixteen steps of arpeggio as rungs of the chord ladder: root, third, fifth, root an octave up, ... */
const ARP_PATTERNS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
  [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 3, 2, 4, 2, 3, 2, 0, 2, 3, 2, 4, 2, 3, 2],
  [0, 2, 1, 3, 2, 4, 3, 5, 0, 2, 1, 3, 2, 4, 3, 2],
  [0, 1, 2, 0, 1, 2, 0, 1, 3, 4, 5, 3, 4, 5, 3, 4],
  [3, 2, 1, 0, 3, 2, 1, 0, 4, 3, 2, 1, 4, 3, 2, 1],
];

/** Onset steps of the first, busier bar of a lead motif. */
const CALL_RHYTHMS: readonly (readonly number[])[] = [
  [0, 3, 6, 8, 12],
  [0, 4, 6, 10, 12],
  [0, 6, 8, 14],
  [2, 4, 6, 8, 12],
  [0, 3, 6, 10, 12, 14],
  [0, 2, 4, 8, 11, 14],
  [0, 4, 8, 10, 12],
];
/** Onset steps of the second bar, which ends on a long note. */
const ANSWER_RHYTHMS: readonly (readonly number[])[] = [
  [0, 3, 6],
  [0, 4, 8],
  [0, 2, 4, 8],
  [0, 6, 8],
  [0, 3, 6, 8],
  [2, 4, 8],
];
/** Sizes of a melodic move in scale steps: mostly by step, some thirds, a rare fourth. */
const LEAD_SIZES: readonly number[] = [1, 1, 1, 1, 2, 2, 3];
/** How often the line repeats a note, and how often it keeps going the way it was going. */
/** A lead note at least this many steps long is moved to a chord tone wherever it falls. */
const LEAD_LONG_NOTE = 6;
const LEAD_REPEAT = 0.14;
const LEAD_KEEP_DIRECTION = 0.68;
/** The lead stays between these scale degrees, counted from the tonic in the lead octave. */
const LEAD_LOW = -3;
const LEAD_HIGH = 7;

/** Lowest notes of each part; the tonic or chord root is placed at or above these. */
const BASS_LOW = 33;
const PAD_LOW = 57;
const PAD_COLOUR_LOW = 65;
const ARP_LOW = 55;
const LEAD_LOW_MIDI = 65;

const TOM_HIGH = 50;
const TOM_MID = 45;
const TOM_LOW = 41;

const PAD_PANS: readonly number[] = [-0.45, 0.45, -0.2, 0.2];

/** Semitones the third chorus of a movement is raised by. */
const FINAL_CHORUS_LIFT = 2;

const TRIAD: readonly number[] = [0, 2, 4];
const ROOT_OR_FIFTH: readonly number[] = [0, 4];

interface MotifNote {
  readonly step: number;
  /** In steps. */
  readonly length: number;
  /** Scale degree from the tonic in the lead octave. */
  readonly degree: number;
}
type Motif = readonly [readonly MotifNote[], readonly MotifNote[]];

interface Movement {
  readonly index: number;
  readonly startBar: number;
  readonly firstSection: number;
  readonly kinds: readonly SectionKind[];
  readonly variants: readonly number[];
  readonly tonic: number;
  readonly verse: readonly Chord[];
  readonly chorus: readonly Chord[];
  /** The chord that replaces a tonic chord in the last bar of a section, to lead onwards. */
  readonly turnaround: Chord;
  readonly bassVerse: readonly number[];
  readonly bassChorus: readonly number[];
  readonly arp: readonly number[];
  readonly motifA: Motif;
  readonly motifB: Motif;
  /** Scale steps the last note of the second phrase moves by, so the repeat is not literal. */
  readonly answerShift: number;
  readonly leadTone: number;
}

function movementBars(mv: Movement): number {
  return mv.kinds.length * BARS_PER_SECTION;
}

function toChords(roots: readonly number[], rng: Rng): Chord[] {
  return roots.map((root) => ({ root, colour: colourFor(root, rng.chance(0.5)) }));
}

/**
 * The colour note for the chord on `root`: a ninth (8 scale steps) or a seventh (6). Two chords
 * have no choice. A seventh on VII is a dominant seventh, which pulls to the relative major, so
 * VII takes the ninth; the ninth on v is a minor ninth, a clash, so v takes the seventh.
 */
function colourFor(root: number, preferNinth: boolean): number {
  if (root === 6) return 8;
  if (root === 4) return 6;
  return preferNinth ? 8 : 6;
}

/**
 * A two-bar motif: a busier bar, then a bar that ends on a long note. The line is a walk through
 * the scale that mostly keeps its direction, moves mostly by step, sometimes repeats a note, and
 * turns back at the edges of the range. The second bar starts out heading back towards the first note.
 */
function buildMotif(rng: Rng, start: number): Motif {
  let degree = start;
  let direction = rng.chance(0.5) ? 1 : -1;
  let first = true;
  const phrase = (steps: readonly number[], end: number): MotifNote[] =>
    steps.map((step, i) => {
      if (!first && !rng.chance(LEAD_REPEAT)) {
        if (!rng.chance(LEAD_KEEP_DIRECTION)) direction = -direction;
        const size = rng.pick(LEAD_SIZES);
        if (degree + direction * size > LEAD_HIGH || degree + direction * size < LEAD_LOW) direction = -direction;
        degree += direction * size;
      }
      first = false;
      const until = i + 1 < steps.length ? steps[i + 1]! : end;
      return { step, length: Math.min(until - step, 8), degree };
    });
  const call = phrase(rng.pick(CALL_RHYTHMS), STEPS_PER_BAR);
  if (degree !== start) direction = degree > start ? -1 : 1;
  const answer = phrase(rng.pick(ANSWER_RHYTHMS), STEPS_PER_BAR - 1);
  return [call, answer];
}

function buildMovement(seed: number, index: number, previous: Movement | undefined): Movement {
  const rng = createRng(hashInts(seed, 0x5eed, index));
  const tonic = previous ? mod(previous.tonic + rng.pick(KEY_MOVES), 12) : rng.pick(HOME_KEYS);
  const kinds = previous ? rng.pick(LATER_FORMS) : FIRST_FORM;
  const seen: Record<SectionKind, number> = { intro: 0, verse: 0, chorus: 0, break: 0 };
  const variants = kinds.map((kind) => seen[kind]++);

  const verseRoots = rng.pick(HOME_PROGRESSIONS);
  let chorusRoots = rng.chance(0.75) ? rng.pick(LIFT_PROGRESSIONS) : rng.pick(HOME_PROGRESSIONS);
  if (chorusRoots === verseRoots) chorusRoots = LIFT_PROGRESSIONS[index % LIFT_PROGRESSIONS.length]!;

  const bassVerse = rng.pick(BASS_PATTERNS);
  let bassChorus = rng.pick(BASS_PATTERNS);
  if (bassChorus === bassVerse) bassChorus = BASS_PATTERNS[(BASS_PATTERNS.indexOf(bassVerse) + 3) % BASS_PATTERNS.length]!;

  const startA = rng.pick([0, 2, 4, 7]);
  const motifA = buildMotif(rng.fork(1), startA);
  const motifB = buildMotif(rng.fork(2), Math.min(LEAD_HIGH, startA + rng.int(2, 4)));

  return {
    index,
    startBar: previous ? previous.startBar + movementBars(previous) : 0,
    firstSection: previous ? previous.firstSection + previous.kinds.length : 0,
    kinds,
    variants,
    tonic,
    verse: toChords(verseRoots, rng),
    chorus: toChords(chorusRoots, rng),
    turnaround: rng.chance(0.6) ? { root: 6, colour: colourFor(6, true) } : { root: 4, colour: colourFor(4, true) },
    bassVerse,
    bassChorus,
    arp: rng.pick(ARP_PATTERNS),
    motifA,
    motifB,
    answerShift: rng.pick([-2, -1, 1, 2]),
    leadTone: rng.range(0.5, 0.8),
  };
}

function chordAt(mv: Movement, section: number, b: number): Chord {
  const kind = mv.kinds[section]!;
  // A break takes the verse progression at half speed, two bars a chord.
  if (kind === 'break') return mv.verse[(b >> 1) % 4]!;
  const chord = (kind === 'chorus' ? mv.chorus : mv.verse)[b % 4]!;
  // Do not end a section at rest on the tonic: lead into the next one.
  if (b === BARS_PER_SECTION - 1 && chord.root === 0) return mv.turnaround;
  return chord;
}

function sameChord(a: Chord, b: Chord): boolean {
  return a.root === b.root && a.colour === b.colour;
}

/** Loudness of one bar of a section, 0..1. */
function barEnergy(kind: SectionKind, variant: number, b: number): number {
  switch (kind) {
    case 'intro':
      return b < 4 ? 0.3 : 0.5;
    case 'verse':
      return variant === 0 ? 0.65 : 0.72;
    case 'chorus':
      return variant === 0 ? 0.92 : 1;
    case 'break':
      return b < 6 ? 0.35 : b === 6 ? 0.45 : 0.6;
  }
}

// ---- One bar ----------------------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function push(
  out: NoteEvent[], voice: VoiceId, step: number, steps: number, midi: number, velocity: number,
  tone = 0.5, pan = 0, glide = 0,
): void {
  out.push({ voice, beat: step * STEP_BEATS, duration: steps * STEP_BEATS, midi, velocity: clamp01(velocity), tone: clamp01(tone), pan, glide });
}

type Fill = 'none' | 'lift' | 'drop' | 'turn';

function fillFor(kind: SectionKind, nextKind: SectionKind, b: number): Fill {
  if (b !== BARS_PER_SECTION - 1 || kind === 'break') return 'none';
  if (nextKind === 'break' || nextKind === 'intro') return 'drop';
  if (kind === 'intro' || (kind === 'verse' && nextKind === 'chorus')) return 'lift';
  return 'turn';
}

function drums(out: NoteEvent[], section: SectionInfo, b: number, rng: Rng): void {
  const { kind, variant, nextKind, prevKind } = section;
  const groove = kind === 'verse' || kind === 'chorus';
  const introGroove = kind === 'intro' && b >= 4;
  const breakBuild = kind === 'break' && b >= 4;
  const fill = fillFor(kind, nextKind, b);

  // Four on the floor.
  if (groove || introGroove) {
    const hit = kind === 'chorus' ? 1 : kind === 'verse' ? 0.86 : 0.72;
    for (let beat = 0; beat < BEATS_PER_BAR; beat++) push(out, Voice.kick, beat * 4, 1, 0, hit);
  }
  if (kind === 'chorus' && (b === 1 || b === 5) && rng.chance(0.4)) push(out, Voice.kick, 14, 1, 0, 0.7);

  // The big snare on 2 and 4.
  if (groove) {
    const hit = kind === 'chorus' ? 1 : 0.88;
    push(out, Voice.snare, 4, 2, 0, hit, 0.9);
    push(out, Voice.snare, 12, 2, 0, hit, 0.9);
  }
  if (kind === 'intro' && b === 7) push(out, Voice.snare, 12, 1, 0, 0.9, 0.9);
  // A break ends in a snare build: quarters, then eighths, then sixteenths.
  if (kind === 'break' && b === 6) {
    for (let step = 0; step < STEPS_PER_BAR; step += 4) push(out, Voice.snare, step, 1, 0, 0.42 + step * 0.008, 0.45);
  }
  if (kind === 'break' && b === 7) {
    for (let step = 0; step < 8; step += 2) push(out, Voice.snare, step, 1, 0, 0.5 + step * 0.02, 0.45);
    for (let step = 8; step < STEPS_PER_BAR; step++) push(out, Voice.snare, step, 1, 0, 0.45 + (step - 8) * 0.055, 0.35);
  }

  if (fill === 'lift') {
    push(out, Voice.tom, 13, 1, TOM_HIGH, 0.8, 0.6);
    push(out, Voice.tom, 14, 1, TOM_MID, 0.9, 0.6);
    push(out, Voice.tom, 15, 1, TOM_LOW, 1, 0.6);
  } else if (fill === 'drop') {
    push(out, Voice.tom, 8, 2, TOM_HIGH, 0.85, 0.6);
    push(out, Voice.tom, 10, 2, TOM_HIGH - 2, 0.85, 0.6);
    push(out, Voice.tom, 14, 1, TOM_MID, 0.9, 0.6);
    push(out, Voice.tom, 15, 1, TOM_LOW, 1, 0.6);
  } else if (fill === 'turn') {
    if (kind === 'chorus') {
      push(out, Voice.tom, 10, 1, TOM_HIGH, 0.8, 0.6);
      push(out, Voice.tom, 11, 1, TOM_MID, 0.8, 0.6);
      push(out, Voice.snare, 14, 1, 0, 0.5, 0.5);
    }
    push(out, Voice.snare, 15, 1, 0, kind === 'chorus' ? 0.72 : 0.55, 0.5);
  }

  // Hats: eighths in a verse, sixteenths in a chorus, with open hats on the off-beats.
  if (groove || introGroove || breakBuild) {
    const sixteenths = kind === 'chorus' || (kind === 'verse' && variant >= 1 && b >= 4);
    const stop = fill === 'lift' ? 12 : fill === 'drop' ? 8 : STEPS_PER_BAR;
    const level = kind === 'intro' ? 0.7 : kind === 'break' ? 0.55 : 1;
    for (let step = 0; step < stop; step++) {
      const offBeat = step % 4 === 2;
      const open = kind === 'chorus'
        ? offBeat && (variant >= 1 || step === 6 || step === 14)
        : kind === 'verse' && step === 14 && (b & 1) === 1;
      const jitter = 0.94 + 0.12 * rng.next();
      if (open) {
        push(out, Voice.openHat, step, 2, 0, 0.7 * level * jitter, 0.5, -0.18);
      } else if (sixteenths) {
        const accent = step % 4 === 0 ? 0.62 : offBeat ? 0.88 : step % 4 === 1 ? 0.3 : 0.36;
        push(out, Voice.hat, step, 1, 0, accent * level * jitter, 0.5, 0.18);
      } else if (step % 2 === 0) {
        push(out, Voice.hat, step, 1, 0, (offBeat ? 0.85 : 0.5) * level * jitter, 0.5, 0.18);
      }
    }
  }

  // A later chorus marks its half-way point too.
  if (b === 4 && kind === 'chorus' && variant >= 1) push(out, Voice.crash, 0, 12, 0, 0.5);
  if (b === 0) {
    if (kind === 'chorus') push(out, Voice.crash, 0, 12, 0, 0.85);
    else if (kind === 'verse' && prevKind !== 'verse') push(out, Voice.crash, 0, 12, 0, 0.6);
    else if (kind === 'break') push(out, Voice.crash, 0, 12, 0, 0.45);
  }

  // Noise sweeps into the next section.
  if (kind === 'break' && b === 6) push(out, Voice.riser, 0, 2 * STEPS_PER_BAR, 0, 0.85);
  else if (kind === 'verse' && nextKind === 'chorus' && b === 7) push(out, Voice.riser, 0, STEPS_PER_BAR, 0, 0.6);
  else if (kind === 'intro' && b === 7) push(out, Voice.riser, 0, STEPS_PER_BAR, 0, 0.5);
}

function bass(out: NoteEvent[], mv: Movement, section: SectionInfo, b: number, chord: Chord): void {
  const { kind, variant } = section;
  const root = placeAtOrAbove(mv.tonic + degreeToSemitones(chord.root), BASS_LOW);
  if (kind === 'break') {
    // One long dark note a bar.
    push(out, Voice.bass, 0, 15.5, root, 0.8, 0.1 + 0.04 * b);
    return;
  }
  if (kind === 'intro') {
    if (b < 4) return;
    for (let step = 0; step < STEPS_PER_BAR; step += 2) push(out, Voice.bass, step, 1.6, root, step % 4 === 0 ? 0.72 : 0.56, 0.25);
    return;
  }
  const pattern = kind === 'chorus' ? mv.bassChorus : mv.bassVerse;
  const tone = kind === 'chorus' ? 0.72 : 0.45 + 0.06 * Math.min(variant, 2);
  const level = kind === 'chorus' ? 1 : 0.82;
  for (let step = 0; step < STEPS_PER_BAR; step++) {
    const offset = pattern[step]!;
    if (offset < 0) continue;
    const accent = step % 4 === 0 ? 1 : step % 4 === 2 ? 0.86 : 0.74;
    push(out, Voice.bass, step, 0.8, root + intervalFrom(chord.root, offset), accent * level, tone);
  }
}

/**
 * The four notes of a chord. The triad is voiced inside one octave, so chords move by small steps;
 * the colour note sits on top, and goes up an octave rather than rub a semitone against the triad.
 */
export function padVoicing(tonic: number, chord: Chord): number[] {
  const notes = TRIAD.map((k) => placeAtOrAbove(tonic + degreeToSemitones(chord.root + k), PAD_LOW));
  let colour = placeAtOrAbove(tonic + degreeToSemitones(chord.root + chord.colour), PAD_COLOUR_LOW);
  if (notes.some((n) => Math.abs(n - colour) === 1)) colour += 12;
  notes.push(colour);
  return notes.sort((a, c) => a - c);
}

function pad(out: NoteEvent[], mv: Movement, section: SectionInfo, sectionInMovement: number, b: number, chord: Chord): void {
  const { kind, variant } = section;
  // Two bars of the same chord are one long chord, started on the even bar.
  const odd = (b & 1) === 1;
  if (odd && sameChord(chordAt(mv, sectionInMovement, b - 1), chord)) return;
  const long = !odd && sameChord(chordAt(mv, sectionInMovement, b + 1), chord);
  const steps = (long ? 2 : 1) * STEPS_PER_BAR - 0.5;
  let tone: number;
  let velocity: number;
  if (kind === 'intro') { tone = 0.2 + 0.04 * b; velocity = 0.8; }
  else if (kind === 'verse') { tone = 0.42 + 0.06 * Math.min(variant, 2); velocity = 0.8; }
  else if (kind === 'chorus') { tone = 0.75; velocity = 1; }
  else { tone = 0.3 + 0.05 * b; velocity = 0.9; }
  // Spread the chord across the stereo field, inner notes nearer the middle.
  const notes = padVoicing(mv.tonic, chord);
  for (let i = 0; i < notes.length; i++) push(out, Voice.pad, 0, steps, notes[i]!, velocity, tone, PAD_PANS[i % PAD_PANS.length]!);
}

function arp(out: NoteEvent[], mv: Movement, section: SectionInfo, b: number, chord: Chord, rng: Rng): void {
  const { kind, variant } = section;
  let every: number;
  let velocity: number;
  let tone: number;
  if (kind === 'intro') { every = b < 4 ? 2 : 1; velocity = b < 4 ? 0.5 : 0.6; tone = 0.3 + 0.05 * b; }
  else if (kind === 'verse') {
    if (variant === 0 && b < 4) return;
    every = variant === 0 ? 2 : 1;
    velocity = variant === 0 ? 0.45 : 0.5;
    tone = 0.4;
  } else if (kind === 'chorus') { every = 1; velocity = 0.62; tone = 0.6; }
  else { every = 1; velocity = 0.8; tone = 0.25 + 0.09 * b; }
  const base = placeAtOrAbove(mv.tonic + degreeToSemitones(chord.root), ARP_LOW);
  for (let step = 0; step < STEPS_PER_BAR; step += every) {
    const rung = mv.arp[step]!;
    const steps = 2 * (rung % 3) + DEGREES * Math.floor(rung / 3);
    const accent = step % 4 === 0 ? 1 : 0.8;
    const jitter = 0.94 + 0.12 * rng.next();
    push(out, Voice.arp, step, 1, base + intervalFrom(chord.root, steps), velocity * accent * jitter, tone, (step & 1) === 1 ? 0.45 : -0.45);
  }
}

/**
 * One bar of the lead. `phrase` 0 states the motif, 1 repeats it with a changed ending, 2 is the
 * contrasting motif, 3 repeats the first and comes to rest on the root or fifth. Notes on beats one
 * and three, long notes and phrase endings are moved to the nearest chord tone; the rest keep the
 * motif's line and pass through the scale.
 */
function lead(
  out: NoteEvent[], mv: Movement, phrase: number, half: number, chord: Chord, velocity: number, tone: number, lift: number,
): void {
  const motif = phrase === 2 ? mv.motifB : mv.motifA;
  const notes = motif[half === 0 ? 0 : 1];
  const tonic = placeAtOrAbove(mv.tonic, LEAD_LOW_MIDI);
  let previousEnd = -1;
  let previousMidi = 0;
  let previousDegree = Number.NaN;
  let previousWritten = Number.NaN;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const last = i === notes.length - 1;
    const ending = last && half === 1;
    const written = n.degree + (phrase === 2 ? lift : 0) + (phrase === 1 && ending ? mv.answerShift : 0);
    let degree = written;
    if (phrase === 3 && ending) {
      degree = snapToChord(degree, chord.root, ROOT_OR_FIFTH);
    } else if (n.step % 8 === 0 || n.length >= LEAD_LONG_NOTE || ending) {
      degree = snapToChord(degree, chord.root, TRIAD);
      // Moving to a chord tone must not turn a line that moves into a repeated note.
      if (degree === previousDegree && written !== previousWritten) {
        const direction = written > previousWritten ? 1 : -1;
        do degree += direction; while (!TRIAD.includes(mod(degree - chord.root, DEGREES)));
      }
    }
    const midi = tonic + degreeToSemitones(degree);
    const legato = previousEnd === n.step && Math.abs(previousMidi - midi) <= 7;
    push(out, Voice.lead, n.step, n.length * 0.94, midi, velocity * (n.step % 4 === 0 ? 1 : 0.88), tone, 0, legato ? previousMidi - midi : 0);
    previousEnd = n.step + n.length;
    previousMidi = midi;
    previousDegree = degree;
    previousWritten = written;
  }
}

/**
 * Rare distant fly-bys for the city bed: at most one in any four-bar block, about one block in
 * three. They follow the bar clock but not the music.
 */
function ambience(out: NoteEvent[], seed: number, bar: number): void {
  const block = Math.floor(bar / 4);
  const rng = createRng(hashInts(seed, 0xf1b, block));
  if (!rng.chance(0.35) || rng.int(0, 3) !== bar - block * 4) return;
  const step = rng.int(0, STEPS_PER_BAR - 1);
  push(out, Voice.whoosh, step, rng.int(20, 34), 0, rng.range(0.5, 1), rng.next(), rng.chance(0.5) ? 1 : -1);
}

// ---- The song ---------------------------------------------------------------------------------------

const BAR_CACHE = 16;

export function createSong(seed = 1): Song {
  const movements: Movement[] = [];
  const cache = new Map<number, Bar>();

  function movementFor(bar: number): Movement {
    let last = movements[movements.length - 1];
    while (!last || last.startBar + movementBars(last) <= bar) {
      last = buildMovement(seed, movements.length, last);
      movements.push(last);
    }
    // No movement is longer than the longest form, so this index never overshoots.
    let i = Math.floor(bar / (MAX_SECTIONS_PER_MOVEMENT * BARS_PER_SECTION));
    while (movements[i]!.startBar + movementBars(movements[i]!) <= bar) i++;
    return movements[i]!;
  }

  function sectionOf(mv: Movement, s: number): SectionInfo {
    const lastOfMovement = s + 1 === mv.kinds.length;
    const nextKind = lastOfMovement ? movementFor(mv.startBar + movementBars(mv)).kinds[0]! : mv.kinds[s + 1]!;
    let prevKind: SectionKind | null = null;
    if (s > 0) prevKind = mv.kinds[s - 1]!;
    else if (mv.index > 0) {
      const before = movements[mv.index - 1]!;
      prevKind = before.kinds[before.kinds.length - 1]!;
    }
    // The third chorus of a movement steps up a tone, the old trick for a last chorus.
    const transpose = mv.kinds[s] === 'chorus' && mv.variants[s]! >= 2 ? FINAL_CHORUS_LIFT : 0;
    return {
      index: mv.firstSection + s,
      kind: mv.kinds[s]!,
      variant: mv.variants[s]!,
      movement: mv.index,
      startBar: mv.startBar + s * BARS_PER_SECTION,
      tonic: mod(mv.tonic + transpose, 12),
      transpose,
      nextKind,
      prevKind,
    };
  }

  function clampBar(index: number): number {
    return index > 0 ? Math.floor(index) : 0;
  }

  function build(index: number): Bar {
    const mv = movementFor(index);
    const s = Math.floor((index - mv.startBar) / BARS_PER_SECTION);
    const b = index - mv.startBar - s * BARS_PER_SECTION;
    const section = sectionOf(mv, s);
    const chord = chordAt(mv, s, b);
    const rng = createRng(hashInts(seed, 0xba5, index));
    const events: NoteEvent[] = [];

    drums(events, section, b, rng.fork(1));
    bass(events, mv, section, b, chord);
    pad(events, mv, section, s, b, chord);
    arp(events, mv, section, b, chord, rng.fork(2));
    if (section.kind === 'chorus') {
      lead(events, mv, b >> 1, b & 1, chord, 0.9, mv.leadTone, section.variant >= 1 ? 2 : 0);
    } else if (section.kind === 'verse' && section.variant >= 1 && b >= 4) {
      // The second verse hints at the chorus melody, quieter and darker.
      lead(events, mv, b < 6 ? 0 : 3, b & 1, chord, 0.6, mv.leadTone - 0.2, 0);
    }
    if (section.transpose !== 0) {
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (isMelodic(event.voice)) events[i] = { ...event, midi: event.midi + section.transpose };
      }
    }
    ambience(events, seed, index);

    events.sort((a, c) => a.beat - c.beat || a.voice - c.voice);
    return { index, section, barInSection: b, chord, energy: barEnergy(section.kind, section.variant, b), events };
  }

  function bar(index: number): Bar {
    const i = clampBar(index);
    const hit = cache.get(i);
    if (hit) return hit;
    const made = build(i);
    if (cache.size >= BAR_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(i, made);
    return made;
  }

  function energyOfBar(index: number): number {
    const i = clampBar(index);
    const mv = movementFor(i);
    const s = Math.floor((i - mv.startBar) / BARS_PER_SECTION);
    return barEnergy(mv.kinds[s]!, mv.variants[s]!, i - mv.startBar - s * BARS_PER_SECTION);
  }

  return {
    seed,
    bar,
    sectionAt(index: number): SectionInfo {
      const i = clampBar(index);
      const mv = movementFor(i);
      return sectionOf(mv, Math.floor((i - mv.startBar) / BARS_PER_SECTION));
    },
    energyAt(beat: number): number {
      const position = beat > 0 ? beat / BEATS_PER_BAR : 0;
      const index = Math.floor(position);
      const now = energyOfBar(index);
      if (index === 0) return now;
      // Ease in over the first beat of the bar so the picture does not step.
      const t = Math.min(1, (position - index) * BEATS_PER_BAR);
      const before = energyOfBar(index - 1);
      return before + (now - before) * t;
    },
  };
}
