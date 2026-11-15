// Which city to build (plan T12, M9). The seed decides the whole plan; these are the rules for
// reading one from a person or an address, and for rolling a new one.

/** The city the project was designed on. */
export const DEFAULT_SEED = 1984;

/** Largest distinct seed: the hashes reduce a seed to 32 bits, so anything above repeats. */
export const MAX_SEED = 4294967295;

/** Rolled seeds stay short enough to read out or type. */
export const MAX_ROLLED = 999999;

/** A whole number from 1 to MAX_SEED, in digits, spaces around allowed; anything else is null. */
export function parseSeed(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_SEED ? n : null;
}

/** Whether a stored value is a seed this page can use. */
export function isSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SEED;
}

/** A new seed from 1 to MAX_ROLLED, never `current`. `random` returns [0, 1). */
export function rollSeed(random: () => number, current: number): number {
  for (let i = 0; i < 8; i++) {
    const seed = 1 + Math.min(MAX_ROLLED - 1, Math.floor(random() * MAX_ROLLED));
    if (seed !== current) return seed;
  }
  return current === 1 ? 2 : 1;
}

/** The seed to build: a valid address seed, else the stored one, else the default. */
export function chooseSeed(fromAddress: string | null, stored: number | null): number {
  return parseSeed(fromAddress) ?? (isSeed(stored) ? stored : DEFAULT_SEED);
}
