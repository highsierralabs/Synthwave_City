import { describe, expect, it } from 'vitest';
import { SC_COMMON, SC_VERTEX } from '../../../src/contracts/glsl';
import { SKY, chord, skyParamProblems, type MountainRange, type SkyParams } from '../../../src/layers/sky/params';
import { SKY_FRAGMENT, SKY_VERTEX } from '../../../src/layers/sky/shaders';

/** A copy of the parameters with one mountain range changed. */
function withRange(index: number, change: Partial<MountainRange>): SkyParams {
  const ranges = SKY.mountains.ranges.map((r, i) => (i === index ? { ...r, ...change } : r));
  return { ...SKY, mountains: { ...SKY.mountains, ranges } };
}

describe('sky parameters', () => {
  it('are sound as shipped', () => {
    expect(skyParamProblems()).toEqual([]);
  });

  it('reject a stripe scroll that would jump when the loop wraps', () => {
    const broken: SkyParams = { ...SKY, sun: { ...SKY.sun, stripeLaps: 384.5 } };
    expect(skyParamProblems(broken).join('\n')).toMatch(/stripeLaps/);
  });

  it('reject a cloud drift that would jump when the loop wraps', () => {
    const broken: SkyParams = { ...SKY, clouds: { ...SKY.clouds, driftLaps: 0.5 } };
    expect(skyParamProblems(broken).join('\n')).toMatch(/driftLaps/);
  });

  it('reject a ridge that would not close round the horizon', () => {
    expect(skyParamProblems(withRange(0, { cols: 150.5 })).join('\n')).toMatch(/cols must be a positive integer/);
    expect(skyParamProblems(withRange(1, { cols: 181 })).join('\n')).toMatch(/multiple of massif/);
  });

  it('reject mesh rows that could cross', () => {
    expect(skyParamProblems(withRange(2, { jitter: 0.5 })).join('\n')).toMatch(/jitter/);
  });

  it('reject two ranges sharing a seed', () => {
    const seed = SKY.mountains.ranges[0]!.seed;
    expect(skyParamProblems(withRange(1, { seed })).join('\n')).toMatch(/seed repeats/);
  });

  it('keep the ridge under the centre of the sun directly in front of it', () => {
    // On the sun's own azimuth a ridge reaches at most amp * (1 - notch) * (1 - sink). Keep that under
    // the centre of the lowest sun any mood has, so the notch always leaves stripes in view.
    const lowestSunCentre = 0.075;
    for (const r of SKY.mountains.ranges) {
      expect(r.amp * (1 - r.notch) * (1 - r.sink) + SKY.mountains.base).toBeLessThan(lowestSunCentre);
    }
  });

  it('measures the sun disc as a chord', () => {
    expect(chord(0)).toBe(0);
    expect(chord(180)).toBeCloseTo(2, 12);
    expect(chord(SKY.sun.radiusDeg)).toBeCloseTo(0.15692, 4);
  });
});

/** Words GLSL ES 3.00 reserves; using one as a name is a compile error on the GPU, not in tsc. */
const RESERVED = new Set([
  'attribute', 'varying', 'coherent', 'volatile', 'restrict', 'readonly', 'writeonly', 'resource', 'atomic_uint',
  'noperspective', 'patch', 'sample', 'subroutine', 'common', 'partition', 'active', 'asm', 'class', 'union', 'enum',
  'typedef', 'template', 'this', 'goto', 'inline', 'noinline', 'public', 'static', 'extern', 'external', 'interface',
  'long', 'short', 'double', 'half', 'fixed', 'unsigned', 'superp', 'input', 'output', 'filter', 'sizeof', 'cast',
  'namespace', 'using', 'flat', 'smooth', 'layout', 'centroid', 'invariant', 'precision', 'lowp', 'mediump', 'highp',
  'switch', 'case', 'default', 'struct', 'discard', 'uniform', 'const', 'in', 'out', 'inout',
]);

function declaredNames(glsl: string): string[] {
  const names: string[] = [];
  const re = /\b(?:float|int|uint|bool|vec[234]|ivec[234]|mat[234])\s+([A-Za-z_]\w*)/g;
  for (let m = re.exec(glsl); m; m = re.exec(glsl)) names.push(m[1]!);
  return names;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('sky shaders', () => {
  const vertexBody = SKY_VERTEX.slice((SC_COMMON + SC_VERTEX).length);
  const fragmentBody = SKY_FRAGMENT.slice(SC_COMMON.length);

  it('start with the shared chunk and declare no uniform of their own', () => {
    expect(SKY_VERTEX.startsWith(SC_COMMON + SC_VERTEX)).toBe(true);
    expect(SKY_FRAGMENT.startsWith(SC_COMMON)).toBe(true);
    expect(vertexBody).not.toMatch(/\buniform\b/);
    expect(fragmentBody).not.toMatch(/\buniform\b/);
  });

  it('place the dome by rotation only, on the far plane', () => {
    expect(vertexBody).toContain('mat3(viewMatrix)');
    expect(vertexBody).toContain('p.xyww');
    expect(SKY_VERTEX.slice(SC_COMMON.length + SC_VERTEX.length)).not.toMatch(/modelMatrix|modelViewMatrix/);
  });

  it('have no template leftovers and balanced brackets', () => {
    for (const body of [vertexBody, fragmentBody]) {
      expect(body).not.toMatch(/undefined|NaN|\[object|\$\{/);
      expect(count(body, '{')).toBe(count(body, '}'));
      expect(count(body, '(')).toBe(count(body, ')'));
    }
  });

  it('use no reserved word as a name', () => {
    const names = [...declaredNames(vertexBody), ...declaredNames(fragmentBody)];
    expect(names.length).toBeGreaterThan(50);
    expect(names.filter((n) => RESERVED.has(n))).toEqual([]);
  });

  it('give every literal smoothstep its edges in order', () => {
    const re = /smoothstep\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*,/g;
    let seen = 0;
    for (let m = re.exec(fragmentBody); m; m = re.exec(fragmentBody)) {
      seen++;
      expect(Number(m[1]), m[0]).toBeLessThan(Number(m[2]));
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('take every derivative before the first branch of main, and none in a helper', () => {
    const mainAt = fragmentBody.indexOf('void main()');
    expect(mainAt).toBeGreaterThan(0);
    const helpers = fragmentBody.slice(0, mainAt);
    const main = fragmentBody.slice(mainAt);
    expect(helpers).not.toMatch(/\b(dFdx|dFdy|fwidth)\s*\(/);
    const firstBranch = main.search(/\bif\s*\(/);
    const lastDerivative = Math.max(main.lastIndexOf('dFdx('), main.lastIndexOf('dFdy('), main.lastIndexOf('fwidth('));
    expect(lastDerivative).toBeGreaterThan(0);
    expect(firstBranch).toBeGreaterThan(lastDerivative);
  });

  it('build one mountain function per range and call each once', () => {
    SKY.mountains.ranges.forEach((_, i) => {
      expect(count(fragmentBody, `vec4 sky_range${i}(`)).toBe(1);
      expect(count(fragmentBody, `= sky_range${i}(`)).toBe(1);
    });
  });
});
