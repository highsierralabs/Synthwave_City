// Seeded, deterministic random numbers. Nothing here reads a clock or Math.random.

/** A well-mixed 32-bit hash of an integer. */
export function hash32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Combine several integers into one hash. */
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < values.length; i++) h = hash32(h ^ (values[i]! | 0));
  return h;
}

/** Hash to a float in [0, 1). */
export function hashUnit(...values: number[]): number {
  return hashInts(...values) / 4294967296;
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** A new independent generator derived from this one's seed and a label. */
  fork(label: number): Rng;
}

/** mulberry32: small, fast, good enough for layout decisions. */
export function createRng(seed: number): Rng {
  let state = hash32(seed) || 1;
  const base = state;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    fork: (label) => createRng(hashInts(base, label)),
  };
}
