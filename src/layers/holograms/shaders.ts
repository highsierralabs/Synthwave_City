// GLSL for the hologram layer (plan T09): panels with their projectors, wire solids, ticker rings.
// Everything here is light: additive, depth-tested, never depth-written (architecture.md 5.5).
//
// Fog: these surfaces are ADDED to what is behind them, so fog only dims them. Mixing towards the
// fog colour, as sc_fog does for opaque surfaces, would add the fog colour a second time and turn
// every distant panel into a pale rectangle.
import { SC_COMMON, SC_VERTEX } from '../../contracts/glsl';

/** Ink A, ink B and white-hot, as drawn into the atlas channels (see atlas.ts). */
const INKS = /* glsl */ `
vec3 holo_ink(vec3 t, vec3 inkA, vec3 inkB) {
  return inkA * t.r + inkB * t.g + vec3(0.86, 0.95, 1.0) * (t.b * 1.3);
}
`;

// ---------------------------------------------------------------------------------------------
// Panels. One instanced draw holds three quads per panel, told apart by position.z:
//   0 the image, 1 the fan of light from the projector up to the image, 2 the projector's lamp.

export const PANEL_VERT = SC_COMMON + SC_VERTEX + /* glsl */ `
attribute vec3 aPos;
attribute vec4 aSize;   // width, height, yaw, seed
attribute vec4 aLook;   // ink A, ink B, wipe cycles per loop, wipe style
attribute vec2 aFit;    // panel uv -> ad uv scale
attribute vec4 aRectA;
attribute vec4 aRectB;
varying vec2 vUv;
varying vec3 vP;
flat varying vec4 vRectA;
flat varying vec4 vRectB;
flat varying vec4 vLook;   // ink A, ink B, share of the panel showing the second ad, wipe style
flat varying vec4 vDim;    // width, height, quantised seed, part
flat varying vec4 vFit;    // fit x, fit y, brightness of this side, projector half-width
flat varying vec3 vNormal;

void main() {
  float part = position.z;
  float w = aSize.x, h = aSize.y;
  float ph = aSize.w;
  // Bob and sway: whole cycles per loop, so the motion closes exactly when time wraps.
  float bob = sin(SC_TAU * fract(uLoop * 585.0 + ph)) * (0.7 + 0.7 * fract(ph * 7.0)) * uMotion;
  float sway = 0.035 * sin(SC_TAU * fract(uLoop * 372.0 + ph * 3.0)) * uMotion;
  float lean = 0.022 * sin(SC_TAU * fract(uLoop * 455.0 + ph * 5.0)) * uMotion;
  float a = aSize.z + sway;
  vec3 n = vec3(-sin(a), 0.0, -cos(a));
  vec3 r = vec3(-cos(a), 0.0, sin(a));
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) + n * lean);
  // The image is flipped for a viewer behind the panel, so the ad reads from both sides.
  vec2 d = sc_wrap(aPos.xz);
  float side = dot(vec2(-d.x, -d.y), n.xz) >= 0.0 ? 1.0 : -1.0;

  float gap = clamp(h * 0.2, 3.0, 9.0);
  float lampHalf = 0.5 * clamp(w * 0.16, 2.5, 12.0);
  vec3 foot = vec3(0.0, -0.5 * h - gap, 0.0);
  vec3 local;
  if (part < 0.5) {
    local = r * (position.x * w) + up * (position.y * h) + vec3(0.0, bob, 0.0);
    vUv = vec2(0.5 + position.x * side, 0.5 + position.y);
  } else if (part < 1.5) {
    float t = position.y + 0.5;
    float across = position.x * 2.0 * mix(lampHalf, 0.5 * w, t);
    local = r * across + mix(foot, up * (-0.5 * h) + vec3(0.0, bob, 0.0), t);
    vUv = vec2(across, t);
  } else {
    local = r * (position.x * lampHalf * 3.2) + foot + vec3(0.0, position.y * 2.6, 0.0);
    vUv = position.xy * 2.0;
  }
  vec3 p = sc_place(aPos, local);
  vP = p;

  float k = 0.0;
  if (aLook.z > 0.5) {
    float cycle = fract(uLoop * aLook.z + ph);
    float wipe = 1.1 * aLook.z / SC_LOOP_SECONDS;
    k = cycle < 0.5 ? 1.0 - clamp(cycle / wipe, 0.0, 1.0) : clamp((cycle - 0.5) / wipe, 0.0, 1.0);
  }
  vRectA = aRectA;
  vRectB = aRectB;
  vLook = vec4(aLook.x, aLook.y, k, aLook.w);
  vDim = vec4(w, h, floor(ph * 4096.0), part);
  vFit = vec4(aFit, side > 0.0 ? 1.0 : 0.82, lampHalf);
  vNormal = n;
  gl_Position = sc_project(p);
}
`;

export const PANEL_FRAG = SC_COMMON + INKS + /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec3 vP;
flat varying vec4 vRectA;
flat varying vec4 vRectB;
flat varying vec4 vLook;
flat varying vec4 vDim;
flat varying vec4 vFit;
flat varying vec3 vNormal;

void main() {
  float part = vDim.w;
  float seed = vDim.z;
  vec3 view = vec3(0.0, cameraPosition.y, 0.0) - vP;
  float dist = length(view);
  vec3 inkA = sc_neon(vLook.x), inkB = sc_neon(vLook.y);

  // Every derivative is taken here, before anything branches.
  vec2 uv = vUv;
  vec2 m = uv * vDim.xy;
  vec2 fwm = max(fwidth(m), vec2(1e-5));
  vec2 cuv = (uv - 0.5) * vFit.xy + 0.5;
  vec2 gx = dFdx(cuv) * vRectA.zw, gy = dFdy(cuv) * vRectA.zw;

  float flick = 1.0 - uMotion * (0.07 * sc_noise(vec2(uTime * 9.0, seed))
    + 0.3 * step(0.972, sc_hash21(vec2(seed + 5.0, floor(uTime * 12.0)))));
  float graze = smoothstep(0.04, 0.32, abs(dot(view / max(dist, 1e-3), vNormal)));
  // Flying through a panel should be a wash of light, not a white-out.
  float near = mix(0.14, 1.0, smoothstep(3.0, 44.0, dist));

  vec3 col;
  if (part < 0.5) {
    // ---- glitch: now and then a band of the image slips sideways
    float tq = floor(uTime * 6.0);
    float glitch = step(0.94, sc_hash21(vec2(seed, tq))) * uMotion;
    float bandY = sc_hash21(vec2(seed + 11.0, tq));
    float bandH = 0.03 + 0.1 * sc_hash21(vec2(seed + 23.0, tq));
    float inBand = glitch * (1.0 - smoothstep(bandH * 0.8, bandH, abs(uv.y - bandY)));
    cuv.x += (sc_hash21(vec2(seed + 37.0, tq)) - 0.5) * 0.3 * inBand;

    // ---- wipe between the two ads
    float style = vLook.w;
    float wc = style < 0.5 ? uv.x : style < 1.5 ? 1.0 - uv.y : style < 2.5 ? 0.5 * (uv.x + uv.y) : abs(uv.x - 0.5) * 2.0;
    float kk = vLook.z * 1.3 - 0.15;
    float showB = step(wc, kk);
    float wipeEdge = exp(-abs(wc - kk) * 38.0);
    vec4 rect = mix(vRectA, vRectB, showB);
    cuv.x += wipeEdge * 0.06 * (sc_hash21(vec2(floor(uv.y * 48.0), tq)) - 0.5);

    // ---- the ad, sampled twice for a red/cyan fringe that grows towards the edges
    vec2 off = abs(uv - 0.5) * 2.0;
    float fr = 0.0012 + 0.003 * pow(max(off.x, off.y), 3.0) + 0.03 * inBand + 0.02 * wipeEdge;
    vec2 ua = cuv + vec2(fr, 0.0), ub = cuv - vec2(fr, 0.0);
    float ma = step(0.0, ua.x) * step(ua.x, 1.0) * step(0.0, ua.y) * step(ua.y, 1.0);
    float mb = step(0.0, ub.x) * step(ub.x, 1.0) * step(0.0, ub.y) * step(ub.y, 1.0);
    vec3 ta = textureGrad(uAtlas, rect.xy + clamp(ua, 0.0, 1.0) * rect.zw, gx, gy).rgb * ma;
    vec3 tb = textureGrad(uAtlas, rect.xy + clamp(ub, 0.0, 1.0) * rect.zw, gx, gy).rgb * mb;
    vec3 ca = holo_ink(ta, inkA, inkB), cb = holo_ink(tb, inkA, inkB);
    vec3 img = vec3(ca.r, 0.5 * (ca.g + cb.g), cb.b);

    // ---- raster lines in panel space, box-filtered so they melt into their average far away
    float period = vDim.y / clamp(floor(vDim.y / 0.42), 24.0, 110.0);
    float scan = sc_pulse((m.y + uTime * 0.35) / period, 0.62, fwm.y / period);
    // Gone by the time a line is two pixels: the box filter alone still beats against the pixel grid there.
    scan = mix(0.62, scan, 1.0 - smoothstep(0.22, 0.5, fwm.y / period));
    float scanK = mix(0.42, 1.2, scan);
    // ---- a soft bar of brightness rolling up the image
    float roll = fract(uv.y * 0.7 - uTime * 0.09 + seed * 0.37);
    float bar = smoothstep(0.0, 0.05, roll) * (1.0 - smoothstep(0.05, 0.3, roll));

    // ---- frame, corner brackets, and the fade to nothing at the quad's edge
    float ex = min(m.x, vDim.x - m.x), ey = min(m.y, vDim.y - m.y);
    float e = min(ex, ey);
    float fe = max(fwm.x, fwm.y);
    float inset = clamp(0.022 * min(vDim.x, vDim.y), 0.4, 1.2);
    float lw = inset * 0.15;
    float frame = sc_line(e - inset, lw, fe);
    float reach = 0.17 * min(vDim.x, vDim.y);
    float corner = 1.0 - smoothstep(reach, reach + fe, max(ex, ey));
    float bracket = sc_line(e - inset, lw * 3.2, fe) * corner;
    float inside = smoothstep(inset - fe, inset + fe, e);
    float halo = exp(-abs(e - inset) / (inset * 0.8)) * 0.1;
    float edgeFade = smoothstep(0.0, inset * 0.6, e);

    // Far away a panel is only a few pixels: lift it so it still reads as a card of coloured light.
    float far = smoothstep(150.0, 1500.0, dist);
    vec3 veil = inkA * (0.03 + 0.035 * uv.y) * (1.0 + 4.0 * far);
    vec3 body = (img * 3.1 * (1.0 + 0.45 * bar + 0.7 * far) + veil * (1.0 + 2.5 * bar)) * scanK;
    body += (inkA + inkB + 0.6) * wipeEdge * 0.9;
    vec3 trim = (inkA * (frame * 1.7 + bracket * 2.4 + halo) + bracket * 0.7) * (1.0 + 0.4 * uBeat.x);
    col = (body * inside + trim) * edgeFade * vFit.z;
  } else if (part < 1.5) {
    // ---- the fan of light from the projector: brightest at the lamp, gone at the image
    // Clamped: under MSAA a varying can be extrapolated past the quad, and pow of a negative is NaN.
    float t = clamp(uv.y, 0.0, 1.0);
    float halfW = mix(vFit.w, 0.5 * vDim.x, t);
    float ax = abs(uv.x) / halfW;
    float across = 1.0 - smoothstep(0.35, 1.0, ax);
    float streak = 0.55 + 0.45 * sc_noise(vec2(uv.x / halfW * 9.0 + seed, uTime * 0.7));
    float fall = (0.06 + 0.6 * pow(1.0 - t, 2.2)) * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.85, 1.0, t));
    col = inkA * (across * streak * fall * 0.55);
  } else {
    // ---- the lamp: a slim bar with a white-hot middle
    float bar = exp(-abs(uv.y) * 7.0) * (1.0 - smoothstep(0.5, 0.62, abs(uv.x)));
    float hot = exp(-length(uv * vec2(2.4, 5.0)) * 3.2);
    float glow = exp(-length(uv * vec2(1.0, 2.0)) * 3.0) * 0.35 * (1.0 - smoothstep(0.6, 1.0, length(uv)));
    col = inkA * (bar * 2.2 + glow) + vec3(0.9, 0.97, 1.0) * hot * 5.0 * (1.0 + 0.3 * uBeat.x);
    near = 1.0;
  }
  col *= flick * graze * near * uGlow * (1.0 - sc_fogAmount(vP));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Wire solids. One mesh for every object; see wire.ts for the attributes.

export const WIRE_VERT = SC_COMMON + SC_VERTEX + /* glsl */ `
attribute vec3 aBary;
attribute vec3 aAnchor;
attribute vec4 aSpin;   // spin laps, phase, tilt, precession laps
attribute vec4 aLook;   // palette index, brightness, kind, quantised seed
attribute vec4 aStyle;  // line half-width (m), face fill, radius, bob weight
varying vec3 vBary;
varying vec3 vP;
varying vec3 vLocal;
varying float vMpp;
flat varying vec4 vLook;
flat varying vec4 vStyle;

vec3 holo_rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, c * p.z - s * p.x); }
vec3 holo_rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }

void main() {
  float kind = aLook.z;
  float ph = aSpin.y;
  vec3 anchor = aAnchor;
  anchor.y += aStyle.w * 1.6 * sin(SC_TAU * fract(uLoop * 512.0 + ph)) * uMotion;
  vec3 p;
  if (kind > 0.5 && kind < 1.5) {
    vec3 centre = sc_place(anchor, vec3(0.0));
    p = sc_sprite(centre, position.xy, position.z * sc_farFade(sc_wrap(anchor.xz)));
    vLocal = vec3(position.xy, 0.0);
  } else {
    vec3 q = holo_rotY(position, SC_TAU * fract(uLoop * aSpin.x + ph));
    q = holo_rotX(q, aSpin.z);
    q = holo_rotY(q, SC_TAU * fract(uLoop * aSpin.w + ph * 1.7));
    vLocal = q;
    p = sc_place(anchor, q);
  }
  vP = p;
  vBary = aBary;
  vLook = aLook;
  vStyle = aStyle;
  gl_Position = sc_project(p);
  vMpp = 2.0 * max(gl_Position.w, 0.1) / (uResolution.y * projectionMatrix[1][1]);
}
`;

export const WIRE_FRAG = SC_COMMON + /* glsl */ `
varying vec3 vBary;
varying vec3 vP;
varying vec3 vLocal;
varying float vMpp;
flat varying vec4 vLook;
flat varying vec4 vStyle;

void main() {
  float kind = vLook.z;
  float seed = vLook.w;
  float radius = vStyle.z;
  vec3 ink = sc_neon(vLook.x);
  vec3 fwb = fwidth(vBary);
  float fwy = max(fwidth(vP.y), 1e-5);
  float flick = 1.0 - uMotion * 0.1 * sc_noise(vec2(uTime * 7.0, seed));
  vec3 col;
  if (kind < 0.5) {
    // Distance to the nearest drawn edge, in pixels.
    vec3 px = vBary / max(fwb, vec3(1e-6));
    float dpx = min(px.x, min(px.y, px.z));
    float wpx = vStyle.x / max(vMpp, 1e-4);
    float edge = sc_line(dpx, wpx, 1.0);
    float halo = exp(-dpx / (wpx * 2.5 + 2.0)) * 0.2;
    // A plane of light sweeping up through the solid.
    float sweepY = mix(-1.25, 1.25, fract(uTime * 0.11 + seed * 0.173)) * radius;
    float sweep = exp(-abs(vLocal.y - sweepY) / (0.06 * radius));
    // Faces carry a little light, cut by raster lines.
    float period = max(0.9, radius * 0.045);
    float raster = sc_pulse(vP.y / period, 0.5, fwy / period);
    float face = vStyle.y * (0.25 + 0.75 * raster) * 0.42;
    col = ink * (edge * 2.8 + halo + face) * (1.0 + 2.2 * sweep) + vec3(0.8, 0.93, 1.0) * edge * (0.6 + 2.0 * sweep);
    col *= vLook.y * (1.0 + 0.25 * uBeat.x);
  } else if (kind < 1.5) {
    float r = length(vLocal.xy);
    float g = max(1.0 - r, 0.0);
    col = ink * (g * g * 0.11 + pow(g, 6.0) * 0.25) * (0.8 + 0.4 * uBeat.x);
  } else {
    // The projector cone: x is 0 at the plaza floor and 1 at the solid, y runs round it.
    float t = clamp(vBary.x, 0.0, 1.0);
    float streak = 0.5 + 0.5 * sc_noise(vec2(vBary.y * 60.0 + seed, uTime * 0.6 - t * 3.0));
    col = ink * streak * (0.07 + 0.5 * pow(1.0 - t, 3.0)) * (1.0 - smoothstep(0.8, 1.0, t)) * 0.6;
  }
  col *= flick * uGlow * (1.0 - sc_fogAmount(vP));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Ticker rings. Four quads per megatower band; position = (side 0..3, along 0..1, up 0..1).
// The quad is twice the band's height: the band fills the middle half, and the rest carries only a
// soft halo, so a ring still reads as a line of light from a kilometre away.

export const TICKER_VERT = SC_COMMON + SC_VERTEX + /* glsl */ `
attribute vec3 aPos;
attribute vec4 aExt;    // half-extent x, half-extent z, band height, seed
attribute vec4 aLook;   // ink A, ink B, strip repeats round the ring, laps per loop
attribute vec4 aRect;
varying vec3 vP;
varying vec3 vBand;     // strip coordinate (in strips), metres round the ring, 0..1 up the band (-0.5..1.5 over the quad)
flat varying vec4 vRect;
flat varying vec4 vLook;   // ink A, ink B, quantised seed, band height
flat varying vec3 vNormal;

void main() {
  float side = position.x, t = position.y;
  float w = aExt.x, d = aExt.y, h = aExt.z;
  // Walk the ring so that the text runs left to right for a viewer outside it.
  vec2 xz;
  vec2 nrm;
  float s0;
  float len;
  if (side < 0.5) { xz = vec2(mix(w, -w, t), -d); nrm = vec2(0.0, -1.0); s0 = 0.0; len = 2.0 * w; }
  else if (side < 1.5) { xz = vec2(-w, mix(-d, d, t)); nrm = vec2(-1.0, 0.0); s0 = 2.0 * w; len = 2.0 * d; }
  else if (side < 2.5) { xz = vec2(mix(-w, w, t), d); nrm = vec2(0.0, 1.0); s0 = 2.0 * w + 2.0 * d; len = 2.0 * w; }
  else { xz = vec2(w, mix(d, -d, t)); nrm = vec2(1.0, 0.0); s0 = 4.0 * w + 2.0 * d; len = 2.0 * d; }
  float perimeter = 4.0 * (w + d);
  float metres = s0 + t * len;
  // Whole laps per loop: the scroll closes exactly when time wraps (architecture.md 4.3).
  float scroll = fract(uLoop * aLook.w + aExt.w);
  vec3 p = sc_place(aPos, vec3(xz.x, (position.z - 0.5) * 2.0 * h, xz.y));
  vP = p;
  vBand = vec3((metres / perimeter + scroll) * aLook.z, metres, position.z * 2.0 - 0.5);
  vRect = aRect;
  vLook = vec4(aLook.x, aLook.y, floor(aExt.w * 4096.0), h);
  vNormal = vec3(nrm.x, 0.0, nrm.y);
  gl_Position = sc_project(p);
}
`;

export const TICKER_FRAG = SC_COMMON + INKS + /* glsl */ `
uniform sampler2D uAtlas;
varying vec3 vP;
varying vec3 vBand;
flat varying vec4 vRect;
flat varying vec4 vLook;
flat varying vec3 vNormal;

void main() {
  float h = vLook.w;
  float seed = vLook.z;
  vec3 inkA = sc_neon(vLook.x), inkB = sc_neon(vLook.y);
  vec2 metres = vec2(vBand.y, vBand.z * h);
  vec2 fwm = max(fwidth(metres), vec2(1e-5));
  float fe = max(fwm.x, fwm.y);
  // The text fills the middle of the band; rules run along its top and bottom.
  float tv = (vBand.z - 0.14) / 0.72;
  vec2 tuv = vec2(vBand.x, tv * vRect.w);
  vec2 gx = dFdx(tuv), gy = dFdy(tuv);
  float inText = step(0.0, tv) * step(tv, 1.0);
  vec3 t = textureGrad(uAtlas, vec2(vBand.x, vRect.y + clamp(tv, 0.0, 1.0) * vRect.w), gx, gy).rgb * inText;
  // LED dots, fading to their average once they are too small to resolve.
  float pitch = h / 26.0;
  vec2 cellUv = fract(metres / pitch) - 0.5;
  float dotMask = 1.0 - smoothstep(0.2, 0.47, length(cellUv));
  float led = mix(1.0, dotMask * 2.3, sc_detail(pitch, fe));
  float ey = min(vBand.z, 1.0 - vBand.z) * h;   // metres inside the band; negative in the halo
  float rule = sc_line(ey - 0.07 * h, 0.012 * h, fwm.y);
  float edgeFade = smoothstep(0.0, 0.03 * h, ey);
  float halo = exp(min(ey, 0.0) / (0.2 * h)) * smoothstep(-0.5 * h, -0.25 * h, ey) * (1.0 - edgeFade);
  float flick = 1.0 - uMotion * 0.08 * sc_noise(vec2(uTime * 8.0, seed));
  vec3 view = vec3(0.0, cameraPosition.y, 0.0) - vP;
  float graze = smoothstep(0.03, 0.25, abs(dot(normalize(view), vNormal)));
  // The band sits in front of lit megatower facades, so its text is pushed towards white-hot.
  vec3 lit = holo_ink(t, inkA, inkB);
  lit = lit * 3.4 + sc_luma(lit) * vec3(1.6);
  vec3 col = (lit * led + inkA * (0.1 + rule * 2.6)) * edgeFade + inkA * halo * 0.45;
  col *= (0.85 + 0.35 * uBeat.x) * flick * graze * uGlow * (1.0 - sc_fogAmount(vP));
  gl_FragColor = vec4(col, 1.0);
}
`;
