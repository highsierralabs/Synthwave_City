// Districts (plan T01, M1): a periodic skyline field over the cells, classified into districts.
import { CELL_FIELD, CELL_STRIDE, DISTRICT, type District } from '../contracts/city';
import { CELLS } from '../contracts/constants';
import { smoothstep, wrapDelta } from '../core/math';
import { hashUnit, type Rng } from '../core/random';

export interface DistrictMap {
  /** CELLS * CELLS * CELL_STRIDE bytes; the height field is filled in later by the massing step. */
  readonly cells: Uint8Array;
  /** Skyline field per cell, 0..1. */
  readonly field: Float32Array;
  readonly megaCells: readonly number[];
  readonly plazaCells: readonly number[];
  /** Cell index of the highest point of the field. */
  readonly peakCell: number;
}

export const cellIndex = (cx: number, cz: number): number => ((cz + CELLS) % CELLS) * CELLS + ((cx + CELLS) % CELLS);

/** Wrapped Chebyshev distance between two cells. */
export function cellDistance(a: number, b: number): number {
  const dx = Math.abs(wrapDelta(a % CELLS, b % CELLS, CELLS));
  const dz = Math.abs(wrapDelta(Math.floor(a / CELLS), Math.floor(b / CELLS), CELLS));
  return Math.max(dx, dz);
}

/** Periodic value noise on a coarse lattice that divides CELLS. */
function periodicNoise(seed: number, x: number, z: number, lattice: number): number {
  const n = CELLS / lattice;
  const fx = x / lattice, fz = z / lattice;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const ux = smoothstep(0, 1, fx - ix), uz = smoothstep(0, 1, fz - iz);
  const at = (i: number, j: number): number => hashUnit(seed, ((i % n) + n) % n, ((j % n) + n) % n);
  const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

const PALETTE_WEIGHTS: readonly [number, number][] = [
  [0, 0.28], [1, 0.28], [2, 0.18], [3, 0.12], [4, 0.08], [5, 0.04], [6, 0.02],
];

function pickPalette(u: number): number {
  let acc = 0;
  for (const [index, weight] of PALETTE_WEIGHTS) {
    acc += weight;
    if (u < acc) return index;
  }
  return 0;
}

export function buildDistricts(seed: number, rng: Rng): DistrictMap {
  // Downtown peaks, kept apart.
  const peaks: { x: number; z: number; sigma: number; gain: number }[] = [];
  for (let tries = 0; peaks.length < 3 && tries < 200; tries++) {
    const x = rng.range(0, CELLS), z = rng.range(0, CELLS);
    const far = peaks.every((p) => Math.hypot(wrapDelta(x, p.x, CELLS), wrapDelta(z, p.z, CELLS)) > 13);
    if (far) peaks.push({ x, z, sigma: rng.range(3.2, 4.6), gain: peaks.length === 0 ? 1 : rng.range(0.78, 0.95) });
  }

  const field = new Float32Array(CELLS * CELLS);
  let peakCell = 0;
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      let f = 0;
      for (const p of peaks) {
        const dx = wrapDelta(cx + 0.5, p.x, CELLS), dz = wrapDelta(cz + 0.5, p.z, CELLS);
        f = Math.max(f, p.gain * Math.exp(-(dx * dx + dz * dz) / (2 * p.sigma * p.sigma)));
      }
      f = f * 0.82 + 0.3 * periodicNoise(seed ^ 0x51, cx + 0.5, cz + 0.5, 5) * (0.35 + f) + 0.06 * hashUnit(seed, cx, cz, 11);
      const i = cellIndex(cx, cz);
      field[i] = Math.min(1, f);
      if (field[i]! > field[peakCell]!) peakCell = i;
    }
  }

  const district = new Uint8Array(CELLS * CELLS);
  for (let i = 0; i < district.length; i++) {
    const f = field[i]!;
    district[i] = f > 0.6 ? DISTRICT.downtown : f > 0.3 ? DISTRICT.midtown : DISTRICT.lowrise;
  }

  // Megatowers: on the shoulders of the skyline, far apart, never the very peak.
  const megaCells: number[] = [];
  const order = Array.from({ length: CELLS * CELLS }, (_, i) => i).sort((a, b) => hashUnit(seed, a, 21) - hashUnit(seed, b, 21));
  for (const i of order) {
    if (megaCells.length >= 12) break;
    const f = field[i]!;
    if (f < 0.18 || f > 0.85 || i === peakCell) continue;
    if (megaCells.every((m) => cellDistance(i, m) >= 7)) megaCells.push(i);
  }
  for (const i of megaCells) district[i] = DISTRICT.mega;

  // Plazas: one beside every megatower, plus a scatter; never two side by side.
  const plazaCells: number[] = [];
  const isPlazaOrMega = (i: number): boolean => district[i] === DISTRICT.plaza || district[i] === DISTRICT.mega;
  const neighbours = (i: number): number[] => {
    const cx = i % CELLS, cz = Math.floor(i / CELLS);
    return [cellIndex(cx + 1, cz), cellIndex(cx - 1, cz), cellIndex(cx, cz + 1), cellIndex(cx, cz - 1)];
  };
  const tryPlaza = (i: number): boolean => {
    if (isPlazaOrMega(i) || i === peakCell) return false;
    if (neighbours(i).some((n) => district[n] === DISTRICT.plaza)) return false;
    district[i] = DISTRICT.plaza;
    plazaCells.push(i);
    return true;
  };
  for (const m of megaCells) {
    const options = neighbours(m);
    const start = Math.floor(hashUnit(seed, m, 31) * 4);
    for (let k = 0; k < 4; k++) if (tryPlaza(options[(start + k) % 4]!)) break;
  }
  for (const i of order) {
    if (plazaCells.length >= 80) break;
    if (hashUnit(seed, i, 41) < 0.06) tryPlaza(i);
  }

  const cells = new Uint8Array(CELLS * CELLS * CELL_STRIDE);
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const i = cellIndex(cx, cz);
      const o = i * CELL_STRIDE;
      cells[o + CELL_FIELD.district] = district[i]!;
      // Colour neighbourhoods: a slow noise picks the cell's main palette entry.
      const u = (periodicNoise(seed ^ 0x77, cx + 0.5, cz + 0.5, 4) * 0.75 + hashUnit(seed, cx, cz, 51) * 0.25) % 1;
      cells[o + CELL_FIELD.palette] = pickPalette(u);
      cells[o + CELL_FIELD.seed] = Math.floor(hashUnit(seed, cx, cz, 61) * 256);
    }
  }
  return { cells, field, megaCells, plazaCells, peakCell };
}

export function districtOf(cells: Uint8Array, i: number): District {
  return cells[i * CELL_STRIDE + CELL_FIELD.district] as District;
}
