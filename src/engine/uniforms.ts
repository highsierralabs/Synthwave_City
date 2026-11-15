// The shared uniforms (architecture.md section 8.2) and the mood easing that drives most of them.
import {
  DataTexture, Matrix4, NearestFilter, NoColorSpace, RGBAFormat, UnsignedByteType, Vector2, Vector3, Vector4,
} from 'three';
import { CELLS } from '../contracts/constants';
import type { CityPlan } from '../contracts/city';
import type { SharedUniforms } from '../contracts/layer';
import { MOODS, type Mood, type MoodId } from '../contracts/moods';
import { PALETTE, PALETTE_SIZE, type RGB } from '../contracts/palette';
import type { QualitySettings } from '../contracts/quality';
import { damp } from '../core/math';

function vec3(c: RGB): Vector3 {
  return new Vector3(c[0], c[1], c[2]);
}

export function createCellTexture(plan: CityPlan): DataTexture {
  const tex = new DataTexture(plan.cells, CELLS, CELLS, RGBAFormat, UnsignedByteType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.colorSpace = NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createBlackTexture(): DataTexture {
  const tex = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createSharedUniforms(plan: CityPlan, quality: QualitySettings, mood: Mood): SharedUniforms {
  const palette: Vector3[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const c = PALETTE[i]!;
    palette.push(new Vector3(c[0] * mood.tint[0], c[1] * mood.tint[1], c[2] * mood.tint[2]));
  }
  return {
    uTime: { value: 0 },
    uLoop: { value: 0 },
    uBeat: { value: new Vector4(0, 0, 0, 1) },
    uCam: { value: new Vector3(0, 100, 0) },
    uFar: { value: new Vector2(quality.fadeStart, quality.fadeEnd) },
    uFog: { value: new Vector4(mood.fog[0], mood.fog[1], mood.fog[2], mood.fog[3]) },
    uFogWarm: { value: vec3(mood.fogWarm) },
    uFogCool: { value: vec3(mood.fogCool) },
    uSunDir: { value: vec3(mood.sunDir) },
    uSkyTop: { value: vec3(mood.skyTop) },
    uSkyMid: { value: vec3(mood.skyMid) },
    uSkyHorizon: { value: vec3(mood.skyHorizon) },
    uSunTop: { value: vec3(mood.sunTop) },
    uSunBottom: { value: vec3(mood.sunBottom) },
    uAmbient: { value: vec3(mood.ambient) },
    uPalette: { value: palette },
    uGlow: { value: mood.glow },
    uStars: { value: mood.stars },
    uWet: { value: 1 },
    uMotion: { value: 1 },
    uResolution: { value: new Vector2(1, 1) },
    uCellTex: { value: createCellTexture(plan) },
    uReflTex: { value: createBlackTexture() },
    uReflMatrix: { value: new Matrix4() },
    uReflAmount: { value: 0 },
    uExposure: { value: mood.exposure },
    uCrt: { value: 0 },
  };
}

function ease3(v: Vector3, target: RGB, k: number): void {
  v.x += (target[0] - v.x) * k;
  v.y += (target[1] - v.y) * k;
  v.z += (target[2] - v.z) * k;
}

/** Eases every mood-driven uniform towards a target mood. Allocation-free. */
export class MoodDriver {
  target: Mood;

  constructor(private readonly uniforms: SharedUniforms, initial: MoodId) {
    this.target = MOODS[initial];
  }

  set(id: MoodId, immediate: boolean): void {
    this.target = MOODS[id];
    if (immediate) this.update(1e6);
  }

  update(dt: number): void {
    const u = this.uniforms;
    const m = this.target;
    const k = dt >= 1e5 ? 1 : damp(1.2, dt);
    if (k <= 0) return;
    ease3(u.uFogWarm.value, m.fogWarm, k);
    ease3(u.uFogCool.value, m.fogCool, k);
    ease3(u.uSkyTop.value, m.skyTop, k);
    ease3(u.uSkyMid.value, m.skyMid, k);
    ease3(u.uSkyHorizon.value, m.skyHorizon, k);
    ease3(u.uSunTop.value, m.sunTop, k);
    ease3(u.uSunBottom.value, m.sunBottom, k);
    ease3(u.uAmbient.value, m.ambient, k);
    ease3(u.uSunDir.value, m.sunDir, k);
    u.uSunDir.value.normalize();
    const fog = u.uFog.value;
    fog.x += (m.fog[0] - fog.x) * k;
    fog.y += (m.fog[1] - fog.y) * k;
    fog.z += (m.fog[2] - fog.z) * k;
    fog.w += (m.fog[3] - fog.w) * k;
    u.uGlow.value += (m.glow - u.uGlow.value) * k;
    u.uStars.value += (m.stars - u.uStars.value) * k;
    u.uExposure.value += (m.exposure - u.uExposure.value) * k;
    const palette = u.uPalette.value;
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const c = PALETTE[i]!;
      const p = palette[i]!;
      p.x += (c[0] * m.tint[0] - p.x) * k;
      p.y += (c[1] * m.tint[1] - p.y) * k;
      p.z += (c[2] * m.tint[2] - p.z) * k;
    }
  }
}
