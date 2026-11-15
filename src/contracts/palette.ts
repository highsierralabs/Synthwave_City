// The neon palette (architecture.md section 5.1). Values are linear RGB, ready for uniforms.

export type RGB = readonly [number, number, number];

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' in sRGB to linear RGB, optionally scaled. */
export function hex(value: string, gain = 1): RGB {
  const n = parseInt(value.slice(1), 16);
  return [channel((n >> 16) & 255) * gain, channel((n >> 8) & 255) * gain, channel(n & 255) * gain];
}

export const NEON = {
  magenta: 0,
  cyan: 1,
  violet: 2,
  orange: 3,
  yellow: 4,
  green: 5,
  red: 6,
  white: 7,
} as const;

export const PALETTE_SIZE = 8;

export const PALETTE_HEX: readonly string[] = [
  '#ff2bd6', // hot magenta
  '#19f0ff', // electric cyan
  '#9b4dff', // ultraviolet
  '#ff7a1a', // sunset orange
  '#ffe14d', // laser yellow
  '#49ff7a', // acid green
  '#ff2740', // signal red
  '#dff4ff', // ice white
];

export const PALETTE: readonly RGB[] = PALETTE_HEX.map((h) => hex(h));
