// The grade (plan T02, M2): exposure, tone curve, vignette, scanlines and grain in one effect.
import { Uniform } from 'three';
import { BlendFunction, Effect } from 'postprocessing';

// The effect composer looks for the identifier that marks a UV-transforming effect by text match,
// so this shader must define only mainImage and must not mention that identifier even in comments.
const FRAGMENT = /* glsl */ `
#define CRT_SCAN 0.6
#define CRT_MASK 0.3
#define CRT_CORNER 0.35
uniform float uExposure;
uniform float uCurve;
uniform float uHold;
uniform float uVignette;
uniform float uCrt;
uniform float uCrtPitch;
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
    // Scanlines and an aperture grille, uCrtPitch device pixels per line and per RGB triad, so they
    // keep the same size on screen at any pixel ratio or render scale.
    float k = 6.2831853 / uCrtPitch;
    float lum = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    float line = 0.5 + 0.5 * cos(px.y * k);
    // A bright beam spreads into the gap, so the lines show most in the mids and darks.
    float scan = 1.0 - uCrt * CRT_SCAN * (1.0 - 0.45 * lum) * (1.0 - line);
    float phase = px.x * k;
    vec3 grille = 0.5 + 0.5 * cos(vec3(phase, phase - 2.0943951, phase + 2.0943951));
    vec3 mask = mix(vec3(1.0), grille, uCrt * CRT_MASK);
    // Give back most of the average light the lines and the grille take away.
    float kept = (1.0 - 0.5 * uCrt * CRT_SCAN) * (1.0 - 0.5 * uCrt * CRT_MASK);
    c *= scan * mask * mix(1.0, 1.0 / kept, 0.8);
    // The corners of a curved tube fall off faster.
    c *= 1.0 - uCrt * CRT_CORNER * smoothstep(0.18, 0.5, v);
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
  grain: number;
}

/** CSS pixels per scanline (and per RGB triad of the grille). */
export const CRT_PITCH_CSS = 3;

/**
 * Device pixels per scanline for a drawing buffer at this many device pixels per CSS pixel. Never
 * under 3, the least that draws a line, a gap and the grille's three colours without aliasing.
 */
export function crtPitch(devicePerCss: number): number {
  return Math.max(3, CRT_PITCH_CSS * devicePerCss);
}

export class GradeEffect extends Effect {
  constructor(exposure: Uniform, crt: Uniform, settings: GradeSettings) {
    super('GradeEffect', FRAGMENT, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, Uniform>([
        ['uExposure', exposure],
        ['uCurve', new Uniform(settings.curve)],
        ['uHold', new Uniform(settings.hold)],
        ['uVignette', new Uniform(settings.vignette)],
        ['uCrt', crt],
        ['uCrtPitch', new Uniform(crtPitch(1))],
        ['uGrain', new Uniform(settings.grain)],
        ['uSeed', new Uniform(0)],
      ]),
    });
  }

  set(name: 'uCurve' | 'uHold' | 'uVignette' | 'uGrain' | 'uSeed' | 'uCrtPitch', value: number): void {
    this.uniforms.get(name)!.value = value;
  }
}
