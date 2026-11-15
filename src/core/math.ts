// Small maths helpers shared by pure modules.

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite step. Requires edge0 < edge1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** v wrapped into [0, period). */
export function wrap(v: number, period: number): number {
  const r = v % period;
  if (r >= 0) return r;
  // A tiny negative remainder plus the period rounds to the period itself; that is 0 on the circle.
  const s = r + period;
  return s >= period ? 0 : s;
}

/** Shortest signed difference a - b on a circle of the given period: in [-period/2, period/2). */
export function wrapDelta(a: number, b: number, period: number): number {
  const d = a - b;
  return d - period * Math.floor(d / period + 0.5);
}

/** Frame-rate independent smoothing factor: how far to move towards a target in dt seconds. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Shortest signed angle from a to b, radians. */
export function angleDelta(a: number, b: number): number {
  return wrapDelta(b, a, Math.PI * 2);
}
