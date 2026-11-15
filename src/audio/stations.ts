// The radio stations (plan T10, M6). Each one is a composition style (song.ts) and a sound
// (mix.ts and voices.ts) at its own tempo. SUNSET FM is the original soundtrack, unchanged; the
// other four are new styles of the same generator, so every station is endless and seeded by the
// city. The billboards that advertise them are drawn in src/layers/holograms/atlas.ts, which keeps
// its own copy of the names and frequencies (a layer may not import the audio module).
import { hashInts } from '../core/random';
import { SUNSET_SOUND, type SoundStyle } from './mix';
import { SUNSET_STYLE, type SongStyle } from './song';
import { DORIAN_SCALE, MAJOR_SCALE, PHRYGIAN_SCALE } from './theory';

export const STATION_IDS = ['sunset', 'obsidian', 'velvet', 'starport', 'plaza'] as const;
export type StationId = (typeof STATION_IDS)[number];

export interface Station {
  readonly id: StationId;
  /** As on the billboards. */
  readonly name: string;
  /** MHz, as written on the dial. */
  readonly frequency: string;
  /** One or two words for the menu. */
  readonly genre: string;
  readonly song: SongStyle;
  readonly sound: SoundStyle;
}

export const DEFAULT_STATION: StationId = 'sunset';

const SUNSET: Station = {
  id: 'sunset',
  name: 'Sunset FM',
  frequency: '88.8',
  genre: 'Outrun',
  song: SUNSET_STYLE,
  sound: SUNSET_SOUND,
};

/**
 * Darksynth. Phrygian, so the chord a semitone above home (bII) is there to lean on; power chords
 * (root doubled, no sevenths); a driving sixteenth-note bass through a saturated bus; low, hard kick.
 */
const OBSIDIAN: Station = {
  id: 'obsidian',
  name: 'Obsidian',
  frequency: '93.3',
  genre: 'Darksynth',
  song: {
    ...SUNSET_STYLE,
    scale: PHRYGIAN_SCALE,
    homeKeys: [9, 10, 11, 0],
    homeProgressions: [
      [0, 0, 5, 1],
      [0, 5, 6, 1],
      [0, 1, 0, 5],
      [0, 3, 5, 1],
      [0, 6, 5, 1],
    ],
    liftProgressions: [
      [5, 1, 0, 0],
      [5, 6, 1, 0],
      [3, 5, 1, 1],
      [5, 2, 1, 0],
      [1, 5, 0, 6],
    ],
    turnarounds: [1, 5],
    colour: 'plain',
    bassPatterns: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 1, 0],
      [0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 4, 0],
    ],
    groove: 'drive',
  },
  sound: {
    ...SUNSET_SOUND,
    bpm: 112,
    kick: { from: 200, to: 47, tail: 38, drop: 0.075, length: 0.4, click: 0.24 },
    kickDrive: 3.4,
    bass: 'grit',
    bassDrive: 3,
    pad: 'dark',
    reverbSeconds: 1.9,
    delayBeats: 0.5,
    delayFeedback: 0.32,
    chorusDepth: 0.6,
    duck: 1.1,
    level: { kick: 0.7, bass: 0.55, sum: 0.9 },
  },
};

/**
 * Chillwave. Major, with sevenths and ninths; half time; a smooth held bass; glassy pads with a deep
 * chorus; a bell arpeggio in eighths; a breathy lead; a long room; a little tape wobble and roll-off.
 */
const VELVET: Station = {
  id: 'velvet',
  name: 'Velvet',
  frequency: '97.1',
  genre: 'Chillwave',
  song: {
    ...SUNSET_STYLE,
    scale: MAJOR_SCALE,
    homeKeys: [2, 4, 5, 7],
    homeProgressions: [
      [0, 3, 5, 3],
      [0, 5, 3, 4],
      [0, 2, 3, 3],
      [0, 0, 3, 3],
      [0, 3, 0, 4],
    ],
    liftProgressions: [
      [3, 4, 2, 5],
      [5, 3, 0, 4],
      [3, 4, 0, 0],
      [5, 4, 3, 3],
    ],
    turnarounds: [4, 3],
    bassPatterns: [
      [0, -1, -1, -1, -1, -1, -1, -1, -1, -1, 4, -1, -1, -1, -1, -1],
      [0, -1, -1, -1, -1, -1, -1, 0, -1, -1, -1, -1, 4, -1, -1, -1],
      [0, -1, -1, -1, -1, -1, -1, -1, 4, -1, -1, -1, 7, -1, -1, -1],
      [0, -1, -1, 7, -1, -1, -1, -1, 0, -1, -1, -1, -1, -1, 4, -1],
    ],
    bassLegato: true,
    arpEvery: 2,
    groove: 'half',
  },
  sound: {
    ...SUNSET_SOUND,
    bpm: 84,
    kick: { from: 150, to: 55, tail: 50, drop: 0.08, length: 0.3, click: 0.08 },
    kickDrive: 1.4,
    snare: 'soft',
    bass: 'round',
    pad: 'glass',
    arp: 'bell',
    lead: 'flute',
    reverbSeconds: 3.8,
    delayBeats: 0.75,
    delayFeedback: 0.5,
    chorusDepth: 2,
    tape: 9500,
    wow: 0.0015,
    duck: 0.6,
    level: { kick: 1.4, snare: 1.8, bass: 0.6, pad: 0.4, lead: 0.8, sum: 1.25 },
  },
};

/**
 * Spacesynth. Dorian, so the IV chord is major and bright; four on the floor with an open hat on
 * every off-beat and syndrum pickups; an octave-bouncing bass; square arpeggios and a square lead.
 */
const STARPORT: Station = {
  id: 'starport',
  name: 'Starport',
  frequency: '101.5',
  genre: 'Spacesynth',
  song: {
    ...SUNSET_STYLE,
    scale: DORIAN_SCALE,
    homeProgressions: [
      [0, 6, 3, 6],
      [0, 3, 6, 0],
      [0, 2, 6, 3],
      [0, 0, 6, 3],
      [0, 4, 6, 3],
    ],
    liftProgressions: [
      [3, 6, 0, 0],
      [2, 6, 3, 0],
      [6, 3, 0, 6],
      [3, 4, 6, 0],
    ],
    turnarounds: [6, 3],
    bassPatterns: [
      [0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7],
      [0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 4, 11, 4, 11],
      [0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 7, 7],
      [0, 7, 0, 7, 0, 7, 0, 7, 2, 9, 2, 9, 4, 11, 4, 11],
    ],
    groove: 'disco',
  },
  sound: {
    ...SUNSET_SOUND,
    bpm: 120,
    kick: { from: 175, to: 52, tail: 46, drop: 0.085, length: 0.3, click: 0.25 },
    snare: 'clap',
    bass: 'pluck',
    arp: 'square',
    lead: 'square',
    reverbSeconds: 2.2,
    delayBeats: 0.5,
    delayFeedback: 0.38,
    chorusDepth: 1.2,
    level: { snare: 2.5, lead: 0.8 },
  },
};

/**
 * Mallsoft. Major with jazz colour (dominant sevenths allowed); slow and swung; a lazy kick; a
 * round held bass; electric piano chords; a mallet arpeggio; a muted lead; heavy tape wobble and
 * a dark tape roll-off, like a cassette played in an empty atrium.
 */
const PLAZA: Station = {
  id: 'plaza',
  name: 'Plaza',
  frequency: '104.3',
  genre: 'Mallsoft',
  song: {
    ...SUNSET_STYLE,
    scale: MAJOR_SCALE,
    homeKeys: [5, 7, 0, 2],
    homeProgressions: [
      [0, 5, 1, 4],
      [0, 2, 3, 4],
      [0, 3, 2, 5],
      [0, 0, 3, 3],
      [0, 5, 3, 4],
    ],
    liftProgressions: [
      [3, 4, 2, 5],
      [1, 4, 0, 5],
      [3, 2, 1, 4],
      [3, 4, 0, 0],
    ],
    turnarounds: [4, 1],
    avoidDominant: false,
    bassPatterns: [
      [0, -1, -1, 4, -1, -1, 7, -1, 0, -1, -1, -1, 4, -1, 5, -1],
      [0, -1, -1, -1, -1, -1, 7, -1, -1, -1, 4, -1, -1, -1, 2, -1],
      [0, -1, -1, 0, -1, -1, -1, -1, 4, -1, -1, 4, -1, -1, 6, -1],
      [0, -1, -1, -1, 4, -1, -1, -1, 7, -1, -1, -1, 4, -1, -1, -1],
    ],
    bassLegato: true,
    arpEvery: 2,
    groove: 'lazy',
    swing: 0.33,
  },
  sound: {
    ...SUNSET_SOUND,
    bpm: 78,
    kick: { from: 140, to: 58, tail: 52, drop: 0.08, length: 0.26, click: 0.05 },
    kickDrive: 1.2,
    snare: 'soft',
    bass: 'round',
    pad: 'keys',
    arp: 'mallet',
    lead: 'muted',
    reverbSeconds: 2.2,
    delayBeats: 0.75,
    delayFeedback: 0.3,
    chorusDepth: 1.4,
    tape: 5200,
    wow: 0.0042,
    duck: 0.5,
    level: { kick: 1.4, snare: 1.8, bass: 0.55, arp: 1.4, lead: 0.75, sum: 1.25 },
  },
};

export const STATIONS: Readonly<Record<StationId, Station>> = {
  sunset: SUNSET,
  obsidian: OBSIDIAN,
  velvet: VELVET,
  starport: STARPORT,
  plaza: PLAZA,
};

export function isStationId(value: unknown): value is StationId {
  return typeof value === 'string' && (STATION_IDS as readonly string[]).includes(value);
}

/** The station after `id` on the dial, wrapping round. */
export function nextStation(id: StationId): StationId {
  return STATION_IDS[(STATION_IDS.indexOf(id) + 1) % STATION_IDS.length]!;
}

/**
 * The song seed of a station in a city. SUNSET FM plays the city's own seed, so its music is what it
 * was before there were stations; the others hash the city seed with their place on the dial.
 */
export function stationSeed(id: StationId, citySeed: number): number {
  if (id === 'sunset') return citySeed;
  return hashInts(citySeed, 0x7ad10, STATION_IDS.indexOf(id)) >>> 0;
}
