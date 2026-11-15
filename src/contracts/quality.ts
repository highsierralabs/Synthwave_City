// Quality tiers (architecture.md section 9). Fixed for the life of a page; changing tier reloads.

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  readonly tier: QualityTier;
  /** Cap on devicePixelRatio. */
  readonly maxPixelRatio: number;
  /** MSAA samples on the scene target; 0 is off. */
  readonly msaa: number;
  /** Size of the reflection target relative to the frame; 0 turns the reflection pass off. */
  readonly reflectionScale: number;
  /** Multiplier on instance counts: traffic, crowds, lamps, beams, holograms. */
  readonly density: number;
  /** Far fade (section 4.2): heights start sinking at fadeStart and reach zero at fadeEnd, metres. */
  readonly fadeStart: number;
  readonly fadeEnd: number;
  readonly crowds: boolean;
  readonly sunShafts: boolean;
  /** Bounds for the adaptive render scale. */
  readonly minRenderScale: number;
  readonly maxRenderScale: number;
}

export const QUALITY: Readonly<Record<QualityTier, QualitySettings>> = {
  low: {
    tier: 'low', maxPixelRatio: 1, msaa: 0, reflectionScale: 0, density: 0.35,
    fadeStart: 1300, fadeEnd: 1800, crowds: false, sunShafts: false, minRenderScale: 0.5, maxRenderScale: 0.85,
  },
  medium: {
    tier: 'medium', maxPixelRatio: 1.5, msaa: 0, reflectionScale: 0.5, density: 0.6,
    fadeStart: 1900, fadeEnd: 2400, crowds: true, sunShafts: false, minRenderScale: 0.6, maxRenderScale: 1,
  },
  high: {
    tier: 'high', maxPixelRatio: 2, msaa: 4, reflectionScale: 0.5, density: 1,
    fadeStart: 2500, fadeEnd: 3100, crowds: true, sunShafts: true, minRenderScale: 0.7, maxRenderScale: 1,
  },
};

export const QUALITY_ORDER: readonly QualityTier[] = ['low', 'medium', 'high'];
