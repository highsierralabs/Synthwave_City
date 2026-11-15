// Spatial queries over the plan's boxes (plan T01, M5). Every box lies inside one block, so it
// belongs to exactly one cell, and a point needs only its own cell's boxes.
import { BOX, BOX_FLAG, BOX_STRIDE, type MutableVec3 } from '../contracts/city';
import { CELL, CELLS, STREET, TILE } from '../contracts/constants';
import { wrap } from '../core/math';

export interface BoxIndex {
  /** For cell i, its boxes are list[start[i] .. start[i + 1]). */
  readonly start: Int32Array;
  readonly list: Int32Array;
}

export function buildBoxIndex(boxes: Float32Array, boxCount: number): BoxIndex {
  const counts = new Int32Array(CELLS * CELLS + 1);
  const cellOf = new Int32Array(boxCount);
  for (let b = 0; b < boxCount; b++) {
    const o = b * BOX_STRIDE;
    const cx = Math.floor(wrap(boxes[o + BOX.cx]!, TILE) / CELL);
    const cz = Math.floor(wrap(boxes[o + BOX.cz]!, TILE) / CELL);
    cellOf[b] = cz * CELLS + cx;
    counts[cellOf[b]! + 1]!++;
  }
  for (let i = 0; i < CELLS * CELLS; i++) counts[i + 1]! += counts[i]!;
  const fill = counts.slice(0, CELLS * CELLS);
  const list = new Int32Array(boxCount);
  for (let b = 0; b < boxCount; b++) list[fill[cellOf[b]!]!++] = b;
  return { start: counts, list };
}

/** The largest sphere radius collide() handles: a sphere in one cell cannot reach a box in the next. */
export const MAX_COLLIDE_RADIUS = STREET.corridorHalf - 1;

export function heightAt(boxes: Float32Array, index: BoxIndex, x: number, z: number): number {
  const px = wrap(x, TILE), pz = wrap(z, TILE);
  const cell = Math.floor(pz / CELL) * CELLS + Math.floor(px / CELL);
  let top = 0;
  for (let k = index.start[cell]!; k < index.start[cell + 1]!; k++) {
    const o = index.list[k]! * BOX_STRIDE;
    const dx = px - boxes[o + BOX.cx]!, dz = pz - boxes[o + BOX.cz]!;
    const hx = boxes[o + BOX.sx]! / 2, hz = boxes[o + BOX.sz]! / 2;
    const inside = (boxes[o + BOX.flags]! & BOX_FLAG.round)
      ? dx * dx + dz * dz <= Math.min(hx, hz) * Math.min(hx, hz)
      : Math.abs(dx) <= hx && Math.abs(dz) <= hz;
    if (inside) top = Math.max(top, boxes[o + BOX.y0]! + boxes[o + BOX.sy]!);
  }
  return top;
}

/** True if the axis-aligned volume touches any box. Coordinates are tile metres; the volume must fit in one cell. */
export function volumeBlocked(
  boxes: Float32Array, index: BoxIndex, x: number, y: number, z: number, hx: number, hy: number, hz: number,
): boolean {
  const px = wrap(x, TILE), pz = wrap(z, TILE);
  // Check the volume's own cell and any neighbour it reaches into.
  const c0x = Math.floor((px - hx) / CELL), c1x = Math.floor((px + hx) / CELL);
  const c0z = Math.floor((pz - hz) / CELL), c1z = Math.floor((pz + hz) / CELL);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const cell = ((cz + CELLS) % CELLS) * CELLS + ((cx + CELLS) % CELLS);
      // Shift the query into that cell's copy of the tile.
      const qx = px - Math.floor(cx / CELLS) * TILE, qz = pz - Math.floor(cz / CELLS) * TILE;
      for (let k = index.start[cell]!; k < index.start[cell + 1]!; k++) {
        const o = index.list[k]! * BOX_STRIDE;
        if (Math.abs(qx - boxes[o + BOX.cx]!) > hx + boxes[o + BOX.sx]! / 2) continue;
        if (Math.abs(qz - boxes[o + BOX.cz]!) > hz + boxes[o + BOX.sz]! / 2) continue;
        const by = boxes[o + BOX.y0]! + boxes[o + BOX.sy]! / 2;
        if (Math.abs(y - by) > hy + boxes[o + BOX.sy]! / 2) continue;
        return true;
      }
    }
  }
  return false;
}

/** Push a sphere out of the boxes of its cell and above the road. Returns true if it moved. */
export function collide(boxes: Float32Array, index: BoxIndex, pos: MutableVec3, radius: number): boolean {
  const r = Math.min(radius, MAX_COLLIDE_RADIUS);
  let moved = false;
  if (pos.y < r) {
    pos.y = r;
    moved = true;
  }
  const px = wrap(pos.x, TILE), pz = wrap(pos.z, TILE);
  const cell = Math.floor(pz / CELL) * CELLS + Math.floor(px / CELL);
  let x = px, y = pos.y, z = pz;
  for (let k = index.start[cell]!; k < index.start[cell + 1]!; k++) {
    const o = index.list[k]! * BOX_STRIDE;
    const bx = boxes[o + BOX.cx]!, bz = boxes[o + BOX.cz]!;
    const hx = boxes[o + BOX.sx]! / 2, hz = boxes[o + BOX.sz]! / 2;
    const y0 = boxes[o + BOX.y0]!, y1 = y0 + boxes[o + BOX.sy]!;
    if (y - r >= y1 || y + r <= y0) continue;
    if (boxes[o + BOX.flags]! & BOX_FLAG.round) {
      // A vertical cylinder inscribed in the box.
      const rad = Math.min(hx, hz);
      const dx = x - bx, dz = z - bz;
      const d = Math.hypot(dx, dz);
      if (d >= rad + r) continue;
      if (y >= y1) {
        // Over the top face: only the cap can touch.
        if (d <= rad) { y = y1 + r; moved = true; }
        continue;
      }
      const overTop = y1 - y;
      const outSide = rad + r - d;
      if (y > y0 && overTop + r < outSide) {
        y = y1 + r;
      } else if (d > 1e-6) {
        x = bx + (dx / d) * (rad + r);
        z = bz + (dz / d) * (rad + r);
      } else {
        x = bx + rad + r;
      }
      moved = true;
      continue;
    }
    // Closest point on the box to the sphere centre.
    const qx = Math.max(bx - hx, Math.min(x, bx + hx));
    const qy = Math.max(y0, Math.min(y, y1));
    const qz = Math.max(bz - hz, Math.min(z, bz + hz));
    const dx = x - qx, dy = y - qy, dz = z - qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      x += dx * push;
      y += dy * push;
      z += dz * push;
    } else {
      // Centre is inside: leave through the nearest face (never downwards).
      const toXn = x - (bx - hx), toXp = bx + hx - x, toZn = z - (bz - hz), toZp = bz + hz - z, toTop = y1 - y;
      const m = Math.min(toXn, toXp, toZn, toZp, toTop);
      if (m === toTop) y = y1 + r;
      else if (m === toXn) x = bx - hx - r;
      else if (m === toXp) x = bx + hx + r;
      else if (m === toZn) z = bz - hz - r;
      else z = bz + hz + r;
    }
    moved = true;
  }
  if (moved) {
    pos.x += x - px;
    pos.y = y;
    pos.z += z - pz;
  }
  return moved;
}
