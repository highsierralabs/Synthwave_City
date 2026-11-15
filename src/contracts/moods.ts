// Moods (architecture.md section 5.7): the numbers that tint the whole city. All colours linear RGB.
// T13 may retune any value here.
import { hex, type RGB } from './palette';

export interface Mood {
  readonly id: MoodId;
  readonly name: string;
  readonly skyTop: RGB;
  readonly skyMid: RGB;
  readonly skyHorizon: RGB;
  readonly sunTop: RGB;
  readonly sunBottom: RGB;
  /** Unit vector towards the sun. */
  readonly sunDir: RGB;
  /** Fog colour looking towards the sun, and away from it. */
  readonly fogWarm: RGB;
  readonly fogCool: RGB;
  /** x: uniform density per metre, y: extra density at ground level, z: height falloff per metre, w: cap on fog amount. */
  readonly fog: readonly [number, number, number, number];
  readonly ambient: RGB;
  readonly stars: number;
  readonly exposure: number;
  /** Multiplier on all neon emission. */
  readonly glow: number;
  /** Per-channel multiplier applied to the palette. */
  readonly tint: RGB;
}

export type MoodId = 'sunset' | 'midnight' | 'miami';

function unit(x: number, y: number, z: number): RGB {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

export const MOODS: Readonly<Record<MoodId, Mood>> = {
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    skyTop: hex('#06021c'),
    skyMid: hex('#3a0d6e', 0.9),
    skyHorizon: hex('#ff3f8e', 1.1),
    sunTop: hex('#ffe85a', 6.0),
    sunBottom: hex('#ff2f8a', 4.0),
    sunDir: unit(0, 0.075, -1),
    fogWarm: hex('#a8247c', 0.3),
    fogCool: hex('#2c1670', 0.45),
    fog: [0.00011, 0.00055, 1 / 260, 0.96],
    ambient: hex('#20104a', 0.5),
    stars: 0.8,
    exposure: 1.0,
    glow: 1.0,
    tint: [1, 1, 1],
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    skyTop: hex('#010210'),
    skyMid: hex('#07103a', 0.9),
    skyHorizon: hex('#2a2a9c', 0.9),
    sunTop: hex('#e8f4ff', 3.0),
    sunBottom: hex('#56c8ff', 2.4),
    sunDir: unit(0.35, 0.16, -1),
    fogWarm: hex('#2c3aa8', 0.4),
    fogCool: hex('#100e40', 0.5),
    fog: [0.00009, 0.00045, 1 / 300, 0.95],
    ambient: hex('#0a0c38', 0.5),
    stars: 1.6,
    exposure: 1.1,
    glow: 1.1,
    tint: [0.9, 1.0, 1.15],
  },
  miami: {
    id: 'miami',
    name: 'Miami',
    skyTop: hex('#1b0a52'),
    skyMid: hex('#b03aa8', 0.9),
    skyHorizon: hex('#ffb07a', 1.2),
    sunTop: hex('#fff3a0', 6.0),
    sunBottom: hex('#ff5a5a', 4.5),
    sunDir: unit(-0.25, 0.11, -1),
    fogWarm: hex('#d0607a', 0.5),
    fogCool: hex('#46309a', 0.5),
    fog: [0.00013, 0.0006, 1 / 240, 0.96],
    ambient: hex('#3a1a66', 0.6),
    stars: 0.35,
    exposure: 0.92,
    glow: 0.95,
    tint: [1.05, 1.0, 0.95],
  },
};

export const MOOD_ORDER: readonly MoodId[] = ['sunset', 'midnight', 'miami'];
