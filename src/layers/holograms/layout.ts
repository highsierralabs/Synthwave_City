// The ad atlas layout (plan T09, M1): where each ad sits in the 2048 x 2048 canvas. Pure data.
//
//   y    0..1024   16 wide ads, 512 x 256 (2:1): roof billboards, avenue panels, megatower panels
//   y 1024..1536    8 tall ads, 256 x 512 (1:2): banners across streets
//   y 1536..2048    4 ticker strips, 2048 x 128 (16:1): the full width, so they wrap with RepeatWrapping

export const ATLAS_SIZE = 2048;

export type CellKind = 'wide' | 'tall' | 'strip';

export interface AtlasCell {
  readonly kind: CellKind;
  /** Position among the cells of its kind. */
  readonly index: number;
  /** Top-left corner and size in canvas pixels (y down). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const WIDE = { w: 512, h: 256, count: 16 } as const;
export const TALL = { w: 256, h: 512, count: 8 } as const;
export const STRIP = { w: 2048, h: 128, count: 4 } as const;

/** Pixels of every cell's edge that the art leaves black, so mip levels do not bleed between ads. */
export const CELL_PAD = 10;

export function atlasLayout(): AtlasCell[] {
  const cells: AtlasCell[] = [];
  const perRow = ATLAS_SIZE / WIDE.w;
  for (let i = 0; i < WIDE.count; i++) {
    cells.push({ kind: 'wide', index: i, x: (i % perRow) * WIDE.w, y: Math.floor(i / perRow) * WIDE.h, w: WIDE.w, h: WIDE.h });
  }
  const tallY = (WIDE.count / perRow) * WIDE.h;
  for (let i = 0; i < TALL.count; i++) {
    cells.push({ kind: 'tall', index: i, x: i * TALL.w, y: tallY, w: TALL.w, h: TALL.h });
  }
  const stripY = tallY + TALL.h;
  for (let i = 0; i < STRIP.count; i++) {
    cells.push({ kind: 'strip', index: i, x: 0, y: stripY + i * STRIP.h, w: STRIP.w, h: STRIP.h });
  }
  return cells;
}

export function cellsOfKind(cells: readonly AtlasCell[], kind: CellKind): AtlasCell[] {
  return cells.filter((c) => c.kind === kind);
}

/**
 * A cell as a texture rectangle [u0, v0, du, dv] for a canvas uploaded with flipY (v = 0 at the
 * bottom of the canvas), pulled in by inset pixels on every side.
 */
export function cellRect(cell: AtlasCell, inset = 1): [number, number, number, number] {
  return [
    (cell.x + inset) / ATLAS_SIZE,
    1 - (cell.y + cell.h - inset) / ATLAS_SIZE,
    (cell.w - 2 * inset) / ATLAS_SIZE,
    (cell.h - 2 * inset) / ATLAS_SIZE,
  ];
}
