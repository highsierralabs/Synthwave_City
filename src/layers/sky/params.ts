// Tunables of the sky layer (plan T03). Pure data: no three, no DOM. The shaders in ./shaders.ts are
// generated from these numbers, and tests/unit/sky checks the invariants that keep the dome seamless.
//
// Angles on the dome: "tan" values are tan(elevation); "rad" values are radians of arc.

export interface MountainRange {
  /** Ridge vertices round the whole horizon. An integer, so the ridge closes on itself. */
  readonly cols: number;
  /** Ridge vertices per massif (the low-frequency swell). cols must be a multiple of it. */
  readonly massif: number;
  /** Hash seed; small exact integer, different per range. */
  readonly seed: number;
  /** Tallest ridge, tan(elevation) above the base line. */
  readonly amp: number;
  /** Subtracted from the ridge profile (0..1) before scaling, so low stretches drop under the horizon. */
  readonly sink: number;
  /** Height multiplier away from the sun (towards it the multiplier is 1). */
  readonly awayScale: number;
  /** How far the ridge drops directly in front of the sun, 0..1, so the stripes stay visible. */
  readonly notch: number;
  /** Near-edge to far-edge distance ratio of the slope, 0..1. Smaller bunches the rows towards the ridge. */
  readonly rho: number;
  /** Mesh rows up the slope. */
  readonly rows: number;
  /** How far a mesh vertex may leave its row, as a share of the row spacing (under 0.5 keeps rows in order). */
  readonly jitter: number;
  /** Palette index of the wireframe. */
  readonly color: number;
  /** Brightness of the ridge line and of the slope grid, linear (section 5.2). */
  readonly ridgeGain: number;
  readonly gridGain: number;
  /** 0 near (dark fill) .. 1 far (fill lifted towards the fog colour). */
  readonly aerial: number;
}

export const SKY = {
  gradient: {
    /** Fall-off of the mid band and of the horizon glow with sin(elevation). */
    midRate: 4.2,
    horizonRateSun: 10.5,
    horizonRateAway: 16.0,
    /** Horizon brightness looking away from the sun, relative to looking at it. */
    horizonAway: 0.42,
  },
  haze: {
    /** The sky shows through the horizon haze as exp(-depth / sin(elevation)): the optical depth of a
     *  ground-hugging layer along the view ray. It is zero at the horizon with zero slope, so the sky
     *  rises out of the fog colour with no edge. About 40% of the sky shows at this sin(elevation). */
    depth: 0.009,
  },
  sun: {
    radiusDeg: 9,
    /** Where the first cut-out opens, in disc radii above the centre. */
    stripeStart: 0.5,
    /** Stripe period in disc radii. */
    stripePeriod: 0.17,
    /** Cut-out share of a period at the horizon. */
    stripeDutyMax: 0.66,
    /** Stripe periods scrolled per loop. An integer, so the scroll wraps without a jump. */
    stripeLaps: 384,
    /** The disc runs from uSunBottom * bottomGain at the horizon to uSunTop * topGain at the top. The
     *  bottom stays near L1 so it keeps its colour under the bloom; the top is L3. */
    bottomGain: 0.42,
    topGain: 0.85,
    gradientPower: 2.2,
    haloNear: 0.07,
    haloNearRate: 2.8,
    haloWide: 0.028,
    haloWideRate: 0.75,
  },
  stars: {
    /** Cells per cube-face side. */
    fineCells: 96,
    brightCells: 18,
    /** Share of cells holding a star when uStars is 1. */
    fineDensity: 0.3,
    brightDensity: 0.5,
    /** Share of bright-layer cells that carry a four-point sparkle. */
    sparkleShare: 0.035,
    /** Unit normal of the great circle the dense band follows. */
    bandNormal: [0.42, 0.52, -0.74],
    bandWidth: 0.17,
  },
  clouds: {
    /** Turns of the cloud field round the vertical axis per loop. An integer. */
    driftLaps: 1,
    /** Horizontal stretch of the streaks. */
    stretch: 11,
    scale: 4.2,
    gain: 0.22,
  },
  mountains: {
    /** tan(elevation) of the base line and of the slope foot (just below the horizon, in the haze). */
    base: -0.002,
    foot: -0.012,
    /** Half-widths of the ridge and grid lines, radians. */
    ridgeWidth: 0.00085,
    gridWidth: 0.00042,
    ranges: [
      { cols: 150, massif: 6, seed: 11, amp: 0.18, sink: 0.12, awayScale: 0.5, notch: 0.76, rho: 0.5, rows: 5, jitter: 0.42, color: 2, ridgeGain: 1.5, gridGain: 0.7, aerial: 1 },
      { cols: 180, massif: 6, seed: 23, amp: 0.11, sink: 0.2, awayScale: 0.6, notch: 0.68, rho: 0.55, rows: 4, jitter: 0.42, color: 0, ridgeGain: 1.9, gridGain: 0.8, aerial: 0.5 },
      { cols: 210, massif: 7, seed: 37, amp: 0.055, sink: 0.3, awayScale: 0.75, notch: 0.45, rho: 0.65, rows: 3, jitter: 0.35, color: 1, ridgeGain: 1.7, gridGain: 0.8, aerial: 0 },
    ] as readonly MountainRange[],
  },
  lights: {
    /** Light cells round the horizon. An integer. */
    cols: 1500,
    /** Height of one row of lights, tan(elevation), and the number of rows. */
    rowHeight: 0.0034,
    rows: 4,
    density: 0.55,
    gain: 1.6,
  },
} as const;

type Widen<T> = T extends number ? number : T extends readonly (infer U)[] ? readonly Widen<U>[] : { readonly [K in keyof T]: Widen<T[K]> };
/** The shape of SKY with plain number fields, so a test can check a changed copy. */
export type SkyParams = Widen<typeof SKY>;

/** Chord length of an arc: the distance between two unit vectors that many degrees apart. */
export function chord(degrees: number): number {
  return 2 * Math.sin((degrees * Math.PI) / 360);
}

/** Problems that would show as a seam or a jump. Empty when the parameters are sound. */
export function skyParamProblems(p: SkyParams = SKY): string[] {
  const out: string[] = [];
  const whole = (name: string, v: number): void => {
    if (!Number.isInteger(v) || v <= 0) out.push(`${name} must be a positive integer, got ${v}`);
  };
  whole('sun.stripeLaps', p.sun.stripeLaps);
  whole('clouds.driftLaps', p.clouds.driftLaps);
  whole('lights.cols', p.lights.cols);
  whole('lights.rows', p.lights.rows);
  whole('stars.fineCells', p.stars.fineCells);
  whole('stars.brightCells', p.stars.brightCells);
  if (!(p.sun.stripeDutyMax > 0 && p.sun.stripeDutyMax < 1)) out.push('sun.stripeDutyMax must be inside 0..1');
  if (!(p.sun.stripeStart > 0.2 && p.sun.stripeStart < 1)) out.push('sun.stripeStart must be inside 0.2..1');
  if (!(p.mountains.foot < p.mountains.base && p.mountains.base <= 0)) out.push('mountains: foot < base <= 0 is required');
  const seeds = new Set<number>();
  p.mountains.ranges.forEach((r, i) => {
    const at = `mountains.ranges[${i}]`;
    whole(`${at}.cols`, r.cols);
    whole(`${at}.massif`, r.massif);
    whole(`${at}.rows`, r.rows);
    whole(`${at}.seed`, r.seed);
    if (r.cols % r.massif !== 0) out.push(`${at}.cols must be a multiple of massif`);
    if (!(r.rho > 0 && r.rho <= 1)) out.push(`${at}.rho must be inside 0..1`);
    if (!(r.jitter >= 0 && r.jitter < 0.5)) out.push(`${at}.jitter must be inside 0..0.5`);
    if (r.rows > 8) out.push(`${at}.rows above 8 costs too much per pixel`);
    if (!(r.notch >= 0 && r.notch < 1)) out.push(`${at}.notch must be inside 0..1`);
    if (!(r.sink >= 0 && r.sink < 0.5)) out.push(`${at}.sink must be inside 0..0.5`);
    if (!(r.amp > 0)) out.push(`${at}.amp must be positive`);
    if (!Number.isInteger(r.color) || r.color < 0 || r.color > 7) out.push(`${at}.color must be a palette index`);
    if (seeds.has(r.seed)) out.push(`${at}.seed repeats another range`);
    seeds.add(r.seed);
  });
  return out;
}
