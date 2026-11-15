// The beam packer (plan T08): turns the plan's searchlight, pillar and laser sites into flat
// per-instance arrays. Pure: no three, no clock, no Math.random, so it is unit-tested in node.
//
// Every beam is one instance with the same seven attributes, whatever its kind. Its direction is a
// closed-form function of the loop phase (beamDirection below, mirrored in GLSL by BEAM_DIR in
// ./shaders.ts), so nothing is animated on the CPU.
import type { Site } from '../../contracts/city';
import { CELL, CELLS, LOOP_SECONDS, TILE } from '../../contracts/constants';
import { clamp, wrapDelta } from '../../core/math';
import { createRng, hashInts, type Rng } from '../../core/random';

export const BEAM_KIND = { searchlight: 0, pillar: 1, laser: 2 } as const;
export type BeamKind = (typeof BEAM_KIND)[keyof typeof BEAM_KIND];

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** The ranges the packer guarantees, whatever the sites say. Metres and radians. */
export const BEAM_LIMITS = {
  searchlight: {
    length: [600, 1500], startRadius: [1.2, 2.4], endRadius: [10, 64],
    /** Angle off vertical, at every moment of the sweep. */
    tilt: [20 * DEG, 60 * DEG], beams: [1, 3],
  },
  pillar: { length: [1500, 3000], radius: [3, 11] },
  laser: {
    length: [1200, 2600], radius: [0.12, 0.3], beams: [5, 9],
    /** Largest angle off vertical any beam of a fan may reach: always above the horizon. */
    maxTilt: 84 * DEG,
  },
} as const;

/** Floats per instance in each array of a BeamSet. */
export const BEAM_STRIDE = { origin: 3, shape: 4, look: 4, tilt: 4, azim: 4, fan: 4, roll: 4 } as const;

/** One set of beams that is drawn together. Arrays are exactly count * stride long. */
export interface BeamSet {
  readonly count: number;
  /** Emitter, tile coordinates: x, y, z. */
  readonly origin: Float32Array;
  /** length, radius at the emitter, radius at the far end, BEAM_KIND. */
  readonly shape: Float32Array;
  /** palette index, seed 0..1, intensity, position in its fan (-0.5..0.5; 0 when not in a fan). */
  readonly look: Float32Array;
  /** Angle off vertical: mid, amplitude, whole cycles per loop, phase. */
  readonly tilt: Float32Array;
  /** Azimuth: base, whole turns per loop (signed), sway amplitude, sway cycles per loop. */
  readonly azim: Float32Array;
  /** Fan opening (full angle): mid, amplitude, whole cycles per loop, phase. */
  readonly fan: Float32Array;
  /** Fan roll about its centre line: base, whole turns per loop (signed); then azimuth sway phase, flare share. */
  readonly roll: Float32Array;
}

export interface PackedBeams {
  /** Searchlights and lasers: left out of the reflection pass. */
  readonly sky: BeamSet;
  /** Pillars: reflected in the wet streets. */
  readonly pillars: BeamSet;
  /** How many sites of each kind were used. */
  readonly sites: { readonly searchlight: number; readonly pillar: number; readonly laser: number };
}

export type EmitterKind = 'searchlight' | 'plazaPillar' | 'laser';

/**
 * Least distance in metres between two lit emitters of one kind, at full density. Chosen in M5.
 * The plan clusters its sites (most laser sites share one downtown), and with every site lit the
 * beams read as fog and a net over the sky; a random share still left clumps that depended on the
 * seed. A spacing gives every seed an even spread. Megatower pillars are landmarks: always lit.
 */
export const EMITTER_SPACING: Readonly<Record<EmitterKind, number>> = { searchlight: 640, plazaPillar: 240, laser: 650 };

/** The spacing at a quality density (1 at `high`): the number of emitters falls about in proportion. */
export function emitterSpacing(kind: EmitterKind, density: number): number {
  return EMITTER_SPACING[kind] / Math.sqrt(clamp(density, 0.05, 1));
}

interface Draft {
  origin: number[]; shape: number[]; look: number[]; tilt: number[]; azim: number[]; fan: number[]; roll: number[];
}
const draft = (): Draft => ({ origin: [], shape: [], look: [], tilt: [], azim: [], fan: [], roll: [] });

function freeze(d: Draft): BeamSet {
  return {
    count: d.origin.length / BEAM_STRIDE.origin,
    origin: new Float32Array(d.origin),
    shape: new Float32Array(d.shape),
    look: new Float32Array(d.look),
    tilt: new Float32Array(d.tilt),
    azim: new Float32Array(d.azim),
    fan: new Float32Array(d.fan),
    roll: new Float32Array(d.roll),
  };
}

/** Whole cycles per loop for a period in seconds, at least one, so the motion wraps seamlessly. */
function cycles(periodSeconds: number): number {
  return Math.max(1, Math.round(LOOP_SECONDS / periodSeconds));
}
const sign = (rng: Rng): number => (rng.chance(0.5) ? 1 : -1);

/** A generator that belongs to one site: the same site gives the same beams whatever else is in the list. */
function siteRng(seed: number, site: Site, salt: number): Rng {
  return createRng(hashInts(seed, Math.floor(site.seed * 4294967296), salt));
}
const cellOf = (v: number): number => Math.floor(v / CELL);

/** Searchlights standing on a plaza floor come in rings; the ones on roofs stand alone. */
function onPlaza(site: Site): boolean {
  return site.y < 5;
}

/** A pillar that starts on a megatower spire is a landmark; one on a plaza floor is quieter. */
function isLandmark(site: Site): boolean {
  return site.y > 5;
}

interface Sweep {
  tiltMid: number; tiltAmp: number; tiltCycles: number; tiltPhase: number;
  turns: number;
}

/** A tilt that stays inside the searchlight limits, and a slow steady turn. */
function sweep(rng: Rng, turnChance: number): Sweep {
  const [lo, hi] = BEAM_LIMITS.searchlight.tilt;
  const tiltMid = rng.range(33, 47) * DEG;
  const room = Math.min(tiltMid - lo, hi - tiltMid) - 0.5 * DEG;
  const tiltAmp = rng.range(0.45, 1) * room;
  return {
    tiltMid,
    tiltAmp,
    tiltCycles: cycles(rng.range(16, 44)),
    tiltPhase: rng.range(0, TAU),
    turns: rng.chance(turnChance) ? sign(rng) * cycles(rng.range(55, 150)) : 0,
  };
}

function pushSearchlights(out: Draft, site: Site, seed: number): void {
  const L = BEAM_LIMITS.searchlight;
  const rng = siteRng(seed, site, 1);
  const length = clamp(site.w, L.length[0], L.length[1]);
  const push = (
    s: Sweep, azimBase: number, swayAmp: number, swayCycles: number, swayPhase: number, tiltLag: number, gain: number,
  ): void => {
    const r0 = rng.range(1.4, 2.2);
    const spread = rng.range(0.022, 0.04);
    const r1 = clamp(r0 + length * spread, L.endRadius[0], L.endRadius[1]);
    out.origin.push(site.x, site.y, site.z);
    out.shape.push(length, r0, r1, BEAM_KIND.searchlight);
    out.look.push(site.color, rng.next(), gain * rng.range(0.85, 1.15), 0);
    out.tilt.push(s.tiltMid, s.tiltAmp, s.tiltCycles, s.tiltPhase + tiltLag);
    out.azim.push(azimBase, s.turns, swayAmp, swayCycles);
    out.fan.push(0, 0, 0, 0);
    out.roll.push(0, 0, swayPhase, 1);
  };

  if (onPlaza(site)) {
    // A ring of lights round a plaza moves in loose formation: the motion comes from the cell the
    // plaza is in, so every light of the ring shares it, and each one lags a little behind the next.
    const cx = cellOf(site.x), cz = cellOf(site.z);
    const group = createRng(hashInts(seed, cx, cz, 77));
    const s = sweep(group, 1);
    const centreX = (cx + 0.5) * CELL, centreZ = (cz + 0.5) * CELL;
    const radial = Math.atan2(site.z - centreZ, site.x - centreX);
    push(s, radial, 0.22, cycles(group.range(20, 40)), radial, radial * 0.35, 1);
    return;
  }

  const n = clamp(Math.round(site.h), L.beams[0], L.beams[1]);
  const base = site.yaw;
  if (n === 1) {
    const s = sweep(rng, 0.5);
    // Without a steady turn it sways through a wide arc instead.
    const swayAmp = s.turns === 0 ? rng.range(0.6, 1.3) : rng.range(0.1, 0.3);
    push(s, base, swayAmp, cycles(rng.range(26, 60)), rng.range(0, TAU), 0, 1);
  } else if (n === 2) {
    const s = sweep(rng, 0.35);
    const swayCycles = cycles(rng.range(22, 48));
    const swayPhase = rng.range(0, TAU);
    if (rng.chance(0.6)) {
      // A crossing pair: the same sway with opposite sign, so the beams scissor through each other.
      const amp = rng.range(0.55, 1.1);
      push(s, base, amp, swayCycles, swayPhase, 0, 0.85);
      push(s, base, -amp, swayCycles, swayPhase, 0.4, 0.85);
    } else {
      // A V: opposite sides, opening and closing together while the pair turns.
      const turning: Sweep = s.turns === 0 ? { ...s, turns: sign(rng) * cycles(rng.range(60, 130)) } : s;
      push(turning, base, 0.12, swayCycles, swayPhase, 0, 0.85);
      push(turning, base + Math.PI, 0.12, swayCycles, swayPhase, 0, 0.85);
    }
  } else {
    // A tripod, turning, its legs breathing in a wave.
    const s = sweep(rng, 1);
    const swayCycles = cycles(rng.range(24, 50));
    const swayPhase = rng.range(0, TAU);
    for (let k = 0; k < 3; k++) push(s, base + (k * TAU) / 3, 0.1, swayCycles, swayPhase, k * 0.7, 0.75);
  }
}

function pushPillar(out: Draft, site: Site, seed: number): void {
  const L = BEAM_LIMITS.pillar;
  const rng = siteRng(seed, site, 2);
  const radius = clamp(site.w, L.radius[0], L.radius[1]);
  const landmark = isLandmark(site);
  out.origin.push(site.x, site.y, site.z);
  out.shape.push(clamp(site.h, L.length[0], L.length[1]), radius, radius, BEAM_KIND.pillar);
  out.look.push(site.color, rng.next(), landmark ? 1.3 : 0.65, 0);
  out.tilt.push(0, 0, 0, 0);
  out.azim.push(0, 0, 0, 0);
  out.fan.push(0, 0, 0, 0);
  out.roll.push(0, 0, 0, 1);
}

function pushLaserFan(out: Draft, site: Site, seed: number): void {
  const L = BEAM_LIMITS.laser;
  const rng = siteRng(seed, site, 3);
  const n = clamp(Math.round(site.h), L.beams[0], L.beams[1]);
  const length = clamp(site.w, L.length[0], L.length[1]);
  // The centre line of the fan leans at most 45 degrees and the fan opens at most 1.2 rad, so no
  // beam drops to the horizon (45 + 34 degrees, under BEAM_LIMITS.laser.maxTilt).
  const tiltMid = rng.range(24, 35) * DEG;
  const tiltAmp = rng.range(4, 10) * DEG;
  const tiltCycles = cycles(rng.range(28, 70));
  const tiltPhase = rng.range(0, TAU);
  const turns = sign(rng) * cycles(rng.range(80, 200));
  const openMid = rng.range(0.5, 0.75);
  const openAmp = Math.min(rng.range(0.25, 0.45), openMid - 0.12);
  const openCycles = cycles(rng.range(9, 22));
  const openPhase = rng.range(0, TAU);
  const rollBase = rng.range(0, TAU);
  const rollTurns = rng.chance(0.7) ? sign(rng) * cycles(rng.range(90, 240)) : 0;
  const radius = rng.range(0.15, 0.24);
  const gain = rng.range(0.85, 1.1);
  for (let k = 0; k < n; k++) {
    out.origin.push(site.x, site.y, site.z);
    out.shape.push(length, radius, radius, BEAM_KIND.laser);
    out.look.push(site.color, rng.next(), gain, k / (n - 1) - 0.5);
    out.tilt.push(tiltMid, tiltAmp, tiltCycles, tiltPhase);
    out.azim.push(site.yaw, turns, 0, 0);
    out.fan.push(openMid, openAmp, openCycles, openPhase);
    out.roll.push(rollBase, rollTurns, 0, 1 / n);
  }
}

interface Emitter {
  x: number;
  z: number;
  /** Lower ranks are placed first. */
  rank: number;
  /** Indices into the site list: one site, or every light of a plaza ring. */
  members: number[];
}

/**
 * Which sites are lit: one flag per site, false for every site that is not a beam emitter.
 * Each kind is thinned on its own, greedily in a seeded order, so that no two lit emitters of a
 * kind stand closer than emitterSpacing (wrap-aware). A plaza ring of searchlights counts as one
 * emitter at the centre of its cell, is kept or dropped whole, and is placed before roof lights.
 */
export function chooseEmitters(sites: readonly Site[], density: number, seed: number): boolean[] {
  const lit = new Array<boolean>(sites.length).fill(false);
  const emitters: Record<EmitterKind, Emitter[]> = { searchlight: [], plazaPillar: [], laser: [] };
  const rings = new Map<number, Emitter>();
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]!;
    if (site.kind === 'pillar') {
      if (isLandmark(site)) lit[i] = true;
      else emitters.plazaPillar.push({ x: site.x, z: site.z, rank: siteRng(seed, site, 0).next(), members: [i] });
    } else if (site.kind === 'laser') {
      emitters.laser.push({ x: site.x, z: site.z, rank: siteRng(seed, site, 0).next(), members: [i] });
    } else if (site.kind === 'searchlight') {
      if (!onPlaza(site)) {
        emitters.searchlight.push({ x: site.x, z: site.z, rank: 0.5 + 0.5 * siteRng(seed, site, 0).next(), members: [i] });
        continue;
      }
      const cx = cellOf(site.x), cz = cellOf(site.z);
      const key = cz * CELLS + cx;
      let ring = rings.get(key);
      if (!ring) {
        ring = { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL, rank: 0.5 * createRng(hashInts(seed, cx, cz, 78)).next(), members: [] };
        rings.set(key, ring);
        emitters.searchlight.push(ring);
      }
      ring.members.push(i);
    }
  }
  for (const kind of Object.keys(emitters) as EmitterKind[]) {
    const spacing = emitterSpacing(kind, density);
    const kept: Emitter[] = [];
    for (const e of emitters[kind].sort((a, b) => a.rank - b.rank)) {
      const clear = kept.every((k) => Math.hypot(wrapDelta(e.x, k.x, TILE), wrapDelta(e.z, k.z, TILE)) >= spacing);
      if (!clear) continue;
      kept.push(e);
      for (const i of e.members) lit[i] = true;
    }
  }
  return lit;
}

/**
 * Pack the beams for one page. `density` is QualitySettings.density; `seed` is the layer seed.
 * Sites of any other kind are ignored.
 */
export function packBeams(sites: readonly Site[], density: number, seed: number): PackedBeams {
  const sky = draft();
  const pillars = draft();
  const used = { searchlight: 0, pillar: 0, laser: 0 };
  const lit = chooseEmitters(sites, density, seed);
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]!;
    if (!lit[i]) continue;
    if (site.kind === 'searchlight') {
      pushSearchlights(sky, site, seed);
      used.searchlight++;
    } else if (site.kind === 'pillar') {
      pushPillar(pillars, site, seed);
      used.pillar++;
    } else if (site.kind === 'laser') {
      pushLaserFan(sky, site, seed);
      used.laser++;
    }
  }
  return { sky: freeze(sky), pillars: freeze(pillars), sites: used };
}

/**
 * Unit direction of beam i at loop phase `loop` (0..1). The CPU mirror of BEAM_DIR in ./shaders.ts,
 * used by the tests; the layer itself never calls it.
 */
export function beamDirection(set: BeamSet, i: number, loop: number): [number, number, number] {
  const o = i * 4;
  const wave = (cyclesPerLoop: number, phase: number): number => {
    const turn = cyclesPerLoop * loop;
    return Math.sin(TAU * (turn - Math.floor(turn)) + phase);
  };
  const th = set.tilt[o]! + set.tilt[o + 1]! * wave(set.tilt[o + 2]!, set.tilt[o + 3]!);
  const spin = set.azim[o + 1]! * loop;
  const ph = set.azim[o]! + TAU * (spin - Math.floor(spin)) + set.azim[o + 2]! * wave(set.azim[o + 3]!, set.roll[o + 2]!);
  const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
  const a = set.look[o + 3]! * (set.fan[o]! + set.fan[o + 1]! * wave(set.fan[o + 2]!, set.fan[o + 3]!));
  const rollTurn = set.roll[o + 1]! * loop;
  const ro = set.roll[o]! + TAU * (rollTurn - Math.floor(rollTurn));
  const cr = Math.cos(ro), sr = Math.sin(ro);
  // e1 and e2 span the plane across the centre line c; neither degenerates when c is vertical.
  const ux = cr * -sp + sr * ct * cp;
  const uy = sr * -st;
  const uz = cr * cp + sr * ct * sp;
  const ca = Math.cos(a), sa = Math.sin(a);
  return [ca * st * cp + sa * ux, ca * ct + sa * uy, ca * st * sp + sa * uz];
}
