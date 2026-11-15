import { describe, expect, it } from 'vitest';
import type { Site } from '../../../src/contracts/city';
import { WIRE_KIND, WIRE_SHAPES, buildWireMesh, shapeFor } from '../../../src/layers/holograms/wire';

function object(i: number): Site {
  return { kind: 'holoObject', x: 400 + i * 160, y: 60 + i * 4, z: 900, w: 20 + i * 1.5, h: 0, d: 0, yaw: 0, color: i % 4, seed: (i * 0.137 + 0.05) % 1 };
}
const objects = Array.from({ length: 12 }, (_, i) => object(i));
const mesh = buildWireMesh(objects);

/** Vertex ranges of each object, found from the anchor attribute. */
function ranges(): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let v = 1; v <= mesh.vertexCount; v++) {
    if (v === mesh.vertexCount || mesh.anchor[v * 3] !== mesh.anchor[start * 3]) {
      out.push([start, v]);
      start = v;
    }
  }
  return out;
}

describe('wire hologram mesh', () => {
  it('is whole triangles with every attribute the same length', () => {
    expect(mesh.vertexCount % 3).toBe(0);
    expect(mesh.vertexCount).toBeGreaterThan(0);
    expect(mesh.position.length).toBe(mesh.vertexCount * 3);
    expect(mesh.bary.length).toBe(mesh.vertexCount * 3);
    expect(mesh.anchor.length).toBe(mesh.vertexCount * 3);
    expect(mesh.spin.length).toBe(mesh.vertexCount * 4);
    expect(mesh.look.length).toBe(mesh.vertexCount * 4);
    expect(mesh.style.length).toBe(mesh.vertexCount * 4);
    for (const a of [mesh.position, mesh.bary, mesh.anchor, mesh.spin, mesh.look, mesh.style]) {
      for (let i = 0; i < a.length; i++) expect(Number.isFinite(a[i])).toBe(true);
    }
  });

  it('builds one solid per site, anchored at it, cycling through every shape', () => {
    const r = ranges();
    expect(r.length).toBe(objects.length);
    expect(mesh.shapes.length).toBe(objects.length);
    expect(new Set(mesh.shapes).size).toBe(WIRE_SHAPES.length);
    r.forEach(([a, b], i) => {
      const s = objects[i]!;
      expect(mesh.shapes[i]).toBe(shapeFor(i));
      for (let v = a; v < b; v++) {
        expect(mesh.anchor[v * 3]).toBeCloseTo(s.x, 3);
        expect(mesh.anchor[v * 3 + 1]).toBeCloseTo(s.y, 3);
        expect(mesh.anchor[v * 3 + 2]).toBeCloseTo(s.z, 3);
        expect(mesh.style[v * 4 + 2]).toBeCloseTo(s.w, 3);
      }
    });
  });

  it('keeps every turning part inside 1.3 radii of its site, whatever its rotation', () => {
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (mesh.look[v * 4 + 2] !== WIRE_KIND.edges || mesh.style[v * 4 + 3] === 0) continue;
      const r = Math.hypot(mesh.position[v * 3]!, mesh.position[v * 3 + 1]!, mesh.position[v * 3 + 2]!);
      expect(r).toBeLessThanOrEqual(mesh.style[v * 4 + 2]! * 1.3);
    }
  });

  it('keeps the projector cone and floor ring between the plaza floor and the solid', () => {
    let coneVerts = 0;
    for (let v = 0; v < mesh.vertexCount; v++) {
      const fixed = mesh.style[v * 4 + 3] === 0;
      if (!fixed) continue;
      const y = mesh.anchor[v * 3 + 1]! + mesh.position[v * 3 + 1]!;
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(mesh.anchor[v * 3 + 1]!);
      if (mesh.look[v * 4 + 2] === WIRE_KIND.cone) coneVerts++;
    }
    expect(coneVerts).toBe(objects.length * 24 * 6);
  });

  it('gives edge triangles barycentric coordinates, with hidden edges pushed to 1', () => {
    for (let t = 0; t < mesh.vertexCount; t += 3) {
      if (mesh.look[t * 4 + 2] !== WIRE_KIND.edges) continue;
      for (let c = 0; c < 3; c++) {
        const col = [mesh.bary[t * 3 + c]!, mesh.bary[(t + 1) * 3 + c]!, mesh.bary[(t + 2) * 3 + c]!];
        const hidden = col.every((x) => x === 1);
        // Otherwise it is 1 at its own vertex and 0 at the other two.
        const drawn = col[c] === 1 && col.filter((x) => x === 0).length === 2;
        expect(hidden || drawn).toBe(true);
      }
      // At least one edge of every triangle is drawn, or it would be dead weight.
      const any = [0, 1, 2].some((c) => mesh.bary[((t + ((c + 1) % 3)) * 3) + c] === 0);
      expect(any).toBe(true);
    }
  });

  it('never draws the diagonal of a quad', () => {
    // The torus is all quads except the eight faces of the small solid at its centre, so those
    // eight are the only triangles there with all three edges drawn.
    const i = mesh.shapes.indexOf('torus');
    const [a, b] = ranges()[i]!;
    let full = 0;
    for (let t = a; t < b; t += 3) {
      if (mesh.look[t * 4 + 2] !== WIRE_KIND.edges) continue;
      const drawn = [0, 1, 2].filter((c) => mesh.bary[((t + ((c + 1) % 3)) * 3) + c] === 0).length;
      if (drawn === 3) full++;
    }
    expect(full).toBe(8);
  });

  it('turns in whole laps per loop, so the motion closes when time wraps', () => {
    let turning = 0;
    for (let v = 0; v < mesh.vertexCount; v++) {
      const spin = mesh.spin[v * 4]!, precess = mesh.spin[v * 4 + 3]!;
      expect(Number.isInteger(spin)).toBe(true);
      expect(Number.isInteger(precess)).toBe(true);
      if (spin !== 0) turning++;
    }
    expect(turning).toBeGreaterThan(mesh.vertexCount / 2);
  });

  it('has one glow sprite per object and palette colours throughout', () => {
    let glow = 0;
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (mesh.look[v * 4 + 2] === WIRE_KIND.glow) glow++;
      const color = mesh.look[v * 4]!;
      expect(Number.isInteger(color)).toBe(true);
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(7);
      // The seed is quantised so the shader can hash it exactly.
      expect(Number.isInteger(mesh.look[v * 4 + 3]!)).toBe(true);
    }
    expect(glow).toBe(objects.length * 6);
  });

  it('is deterministic and empty for no sites', () => {
    expect(buildWireMesh(objects).position).toEqual(mesh.position);
    expect(buildWireMesh([]).vertexCount).toBe(0);
  });
});
