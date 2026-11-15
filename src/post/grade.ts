// The grade (plan T02, M2): exposure, tone curve, vignette, scanlines and grain in one effect.
import { Uniform } from 'three';
import { BlendFunction, Effect } from 'postprocessing';

// The effect composer looks for the identifier that marks a UV-transforming effect by text match,
// so this shader must define only mainImage and must not mention that identifier even in comments.
const FRAGMENT = /* glsl */ `
uniform float uExposure;
uniform float uCurve;
uniform float uHold;
uniform float uVignette;
uniform float uCrt;
uniform float uGrain;
uniform float uSeed;

vec3 gradeAces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Soft shoulder per channel, blended with a version that scales the whole colour by its luminance.
// The first lets hot cores burn to white; the second keeps saturated neon saturated.
vec3 gradeNeon(vec3 c) {
  vec3 perChannel = 1.0 - exp(-c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 held = c * ((1.0 - exp(-l)) / max(l, 1e-4));
  // A held colour can push one channel past 1: scale it back and let it drift towards white.
  float peak = max(held.r, max(held.g, held.b));
  if (peak > 1.0) held = mix(held / peak, vec3(1.0), clamp((peak - 1.0) * 0.25, 0.0, 0.6));
  return clamp(mix(perChannel, held, uHold), 0.0, 1.0);
}

float gradeHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0) * uExposure;

  // Vignette before the curve, so it darkens light rather than greying the result.
  vec2 q = uv - 0.5;
  float v = dot(q, q);
  c *= 1.0 - uVignette * smoothstep(0.08, 0.62, v);

  c = uCurve < 0.5 ? gradeNeon(c) : gradeAces(c);

  // A touch of contrast in the mids.
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);

  vec2 px = uv * resolution;
  if (uCrt > 0.0) {
    float line = 0.5 + 0.5 * cos(px.y * 3.14159265);
    c *= 1.0 - uCrt * 0.28 * line;
    c *= 1.0 + uCrt * 0.04 * cos(px.x * 2.0943951);
  }
  // Grain, scaled with brightness so it stays about as visible in the darks as in the mids once the
  // output is sRGB encoded. It also breaks up banding in the dark sky.
  float g = gradeHash(px + uSeed * 61.0) - 0.5;
  c += g * uGrain * (0.02 + dot(c, vec3(0.333)));

  outputColor = vec4(max(c, 0.0), 1.0);
}
`;

export interface GradeSettings {
  /** 0 neon curve, 1 ACES. */
  curve: number;
  /** How much of the hue-preserving curve to blend in, 0..1. */
  hold: number;
  vignette: number;
  /** Scanline strength, 0 is off. */
  crt: number;
  grain: number;
}

export class GradeEffect extends Effect {
  constructor(exposure: Uniform, settings: GradeSettings) {
    super('GradeEffect', FRAGMENT, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, Uniform>([
        ['uExposure', exposure],
        ['uCurve', new Uniform(settings.curve)],
        ['uHold', new Uniform(settings.hold)],
        ['uVignette', new Uniform(settings.vignette)],
        ['uCrt', new Uniform(settings.crt)],
        ['uGrain', new Uniform(settings.grain)],
        ['uSeed', new Uniform(0)],
      ]),
    });
  }

  set(name: 'uCurve' | 'uHold' | 'uVignette' | 'uCrt' | 'uGrain' | 'uSeed', value: number): void {
    this.uniforms.get(name)!.value = value;
  }
}
