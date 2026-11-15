// Air traffic shaders (plan T07). Every craft is placed in the vertex shader from the loop phase;
// pack.ts holds the same formulas in TypeScript for the tests.
//
// Light levels (architecture.md 5.2): hulls L0 with thin L2 accent lines, trails L2 at the head,
// engine and lamp cores small L3. Translucent light is additive with depth write off, and fog
// only dims it (colour * (1 - fog amount)): mixing towards the fog colour would add fog-coloured
// rectangles to the frame.
import { SC_COMMON, SC_VERTEX } from '../../contracts/glsl';
import { CRAFT_LIGHTS } from './shapes';

/** Hulls further than this from the camera are smaller than a few pixels and are not drawn. */
export const HULL_DRAW_DISTANCE = 2000;

// ---------------------------------------------------------------------------------------------
// Shared vertex code
// ---------------------------------------------------------------------------------------------

const MOTION = /* glsl */ `
// fract(n * loop) for a whole number n, keeping the low bits of loop that n * loop would round away.
float at_laps(float n, float loop) {
  float hi = floor(loop * 4096.0) / 4096.0;
  return fract(n * hi) + n * (loop - hi);
}
`;

const CRAFT_MOTION = MOTION + /* glsl */ `
attribute vec4 aLane;   // fixed coordinate, altitude, axis (0 along x, 1 along z), direction (+1 / -1)
attribute vec4 aMove;   // laps, phase, weave amplitude, weave cycles per loop
attribute vec4 aBob;    // bob amplitude, bob cycles per loop, trail length, scale
attribute vec4 aLook;   // seed, shape, engine palette index, accent palette index

struct AtCraft {
  vec3 anchor;   // tile coordinates of the craft's centre
  vec3 right;
  vec3 up;
  vec3 fwd;
  float speed;   // metres per second along the lane
  float fade;    // far fade of the anchor
};

// Sideways and vertical sway at a loop phase. Whole cycles per loop, so the loop seam is seamless.
vec2 at_sway(float loop) {
  return vec2(
    aMove.z * sin(SC_TAU * (at_laps(aMove.w, loop) + aLook.x)),
    aBob.x * sin(SC_TAU * (at_laps(aBob.y, loop) + aLook.x * 7.0)));
}

AtCraft at_craft() {
  AtCraft c;
  float alongZ = aLane.z;
  vec3 lane = vec3(1.0 - alongZ, 0.0, alongZ);
  vec3 crs = vec3(alongZ, 0.0, 1.0 - alongZ);
  float s = fract(aLane.w * at_laps(aMove.x, uLoop) + aMove.y) * SC_TILE;
  vec2 sway = at_sway(uLoop);
  c.anchor = lane * s + crs * (aLane.x + sway.x) + vec3(0.0, aLane.y + sway.y, 0.0);
  c.speed = aMove.x * (SC_TILE / SC_LOOP_SECONDS);

  // Heading follows the velocity; the craft banks into its weave.
  float wRate = SC_TAU * aMove.w / SC_LOOP_SECONDS;
  float wPhase = SC_TAU * (at_laps(aMove.w, uLoop) + aLook.x);
  float latVel = aMove.z * wRate * cos(wPhase);
  float latAcc = -aMove.z * wRate * wRate * sin(wPhase);
  float bRate = SC_TAU * aBob.y / SC_LOOP_SECONDS;
  float vertVel = aBob.x * bRate * cos(SC_TAU * (at_laps(aBob.y, uLoop) + aLook.x * 7.0));
  vec3 f = normalize(lane * (aLane.w * c.speed) + crs * latVel + vec3(0.0, vertVel, 0.0));
  vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
  vec3 u = cross(r, f);
  float roll = clamp(dot(crs, r) * latAcc * 0.4, -0.5, 0.5);
  float cr = cos(roll), sr = sin(roll);
  c.right = r * cr - u * sr;
  c.up = u * cr + r * sr;
  c.fwd = f;
  c.fade = sc_farFade(sc_wrap(c.anchor.xz));
  return c;
}

// Hull-local (x right, y up, z back) to an offset from the anchor.
vec3 at_world(AtCraft c, vec3 local) { return c.right * local.x + c.up * local.y - c.fwd * local.z; }
`;

const HERO_MOTION = MOTION + /* glsl */ `
attribute vec4 aRoute;  // fixed coordinate, altitude, axis, direction
attribute vec4 aRun;    // laps, phase, seed, type
uniform vec2 uHeroBob[3];   // per type: vertical drift amplitude, whole cycles per loop

struct AtHero {
  vec3 anchor;
  vec3 right;
  vec3 fwd;
  float fade;
};

AtHero at_hero() {
  AtHero h;
  float alongZ = aRoute.z;
  vec3 lane = vec3(1.0 - alongZ, 0.0, alongZ);
  vec3 crs = vec3(alongZ, 0.0, 1.0 - alongZ);
  float s = fract(aRoute.w * at_laps(aRun.x, uLoop) + aRun.y) * SC_TILE;
  vec2 bob = uHeroBob[int(aRun.w + 0.5)];
  float y = aRoute.y + bob.x * sin(SC_TAU * (at_laps(bob.y, uLoop) + aRun.z));
  h.anchor = lane * s + crs * aRoute.x + vec3(0.0, y, 0.0);
  h.fwd = lane * aRoute.w;
  h.right = cross(h.fwd, vec3(0.0, 1.0, 0.0));
  h.fade = sc_farFade(sc_wrap(h.anchor.xz));
  return h;
}
vec3 at_world(AtHero h, vec3 local) { return h.right * local.x + vec3(0.0, local.y, 0.0) - h.fwd * local.z; }

// The patrol craft's searchlight: a slow swing ahead and astern, a smaller one side to side.
vec3 at_searchDir(AtHero h, float seed) {
  float a = 0.2 + 0.36 * sin(SC_TAU * (at_laps(372.0, uLoop) + seed));
  float b = 0.035 * sin(SC_TAU * (at_laps(585.0, uLoop) + seed * 3.0));
  return normalize(vec3(0.0, -1.0, 0.0) + h.fwd * a + h.right * b);
}
`;

const VERTEX_UTIL = /* glsl */ `
const vec4 AT_NOWHERE = vec4(0.0, 0.0, 2.0, 1.0);   // outside the clip volume: the primitive is dropped
float at_metresPerPixel(vec3 p) {
  float dist = length(p - vec3(0.0, cameraPosition.y, 0.0));
  return 2.0 * dist / (uResolution.y * projectionMatrix[1][1]);
}
// Palette colour for an index that may be fractional: 1.6 is a blue between cyan and violet.
vec3 at_palette(float index) {
  float i = floor(index);
  return mix(sc_neon(i), sc_neon(i + 1.0), index - i);
}
`;

// ---------------------------------------------------------------------------------------------
// Shared fragment code
// ---------------------------------------------------------------------------------------------

const FRAGMENT_UTIL = /* glsl */ `
// Antialiased box: 1 inside |p - c| < h.
float at_box(vec2 p, vec2 c, vec2 h, float fw) {
  vec2 d = abs(p - c) - h;
  float sd = max(d.x, d.y);
  fw = max(fw, 1e-4);
  return 1.0 - smoothstep(-fw, fw, sd);
}
// A grid of windows, each lit or dark by hash; fades to its average when a cell is under two pixels.
float at_windows(vec2 uv, vec2 cell, vec2 fill, float seed, float litPart, vec2 fw) {
  vec2 g = uv / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 e = max(fw / cell, vec2(1e-4));
  vec2 lo = 0.5 * (1.0 - fill);
  vec2 m = smoothstep(lo - e, lo + e, f) * (1.0 - smoothstep(1.0 - lo - e, 1.0 - lo + e, f));
  float lit = step(1.0 - litPart, sc_hash21(id + seed));
  float detail = sc_detail(min(cell.x, cell.y), max(fw.x, fw.y));
  return mix(litPart * fill.x * fill.y, lit * m.x * m.y, detail);
}
vec3 at_palette(float index) {
  float i = floor(index);
  return mix(sc_neon(i), sc_neon(i + 1.0), index - i);
}
// Two quick flashes at the start of a cycle of phase 0..1.
float at_flash(float ph) {
  return step(ph, 0.07) + step(0.15, ph) * step(ph, 0.22);
}
// Face normal from the screen-space derivatives of the position, turned towards the viewer. Never
// NaN: a NaN written by an opaque surface is spread into a black block by the bloom.
vec3 at_normal(vec3 dx, vec3 dy, vec3 view) {
  vec3 n = cross(dx, dy);
  n /= max(length(n), 1e-20);
  return dot(n, view) > 0.0 ? -n : n;
}
float at_fresnel(vec3 n, vec3 view) {
  float f = clamp(1.0 - abs(dot(n, view)), 0.0, 1.0);
  return f * f * f;
}
// Unlit hull: deep indigo, a little sky from above, a little city glow from below, a fog-coloured rim.
vec3 at_hullBase(vec3 n, vec3 view) {
  float skyAmt = smoothstep(-0.5, 0.7, n.y);
  vec3 amb = mix(uFogWarm * 0.6 + uAmbient * 0.6, uSkyMid * 0.7 + uAmbient, skyAmt);
  float fres = at_fresnel(n, view);
  vec3 col = vec3(0.007, 0.006, 0.018) + amb * 0.16 + fres * sc_fogColor(view) * 0.22;
  col += pow(max(dot(n, uSunDir), 0.0), 2.0) * uSunBottom * 0.012;
  return col;
}
`;

// ---------------------------------------------------------------------------------------------
// Craft hulls
// ---------------------------------------------------------------------------------------------

export const HULL_VERT = SC_COMMON + SC_VERTEX + CRAFT_MOTION + VERTEX_UTIL + /* glsl */ `
attribute float aPart;
uniform float uHullFar;
varying vec3 vP;
varying vec3 vLocal;
flat varying float vPart;
flat varying vec4 vLook;
flat varying vec3 vRight;
flat varying vec3 vUp;
flat varying vec3 vFwd;
void main() {
  AtCraft c = at_craft();
  vec3 p = sc_place(c.anchor, at_world(c, position * aBob.w));
  vP = p;
  vLocal = position;
  vPart = aPart;
  vLook = aLook;
  vRight = c.right;
  vUp = c.up;
  vFwd = c.fwd;
  vec2 d = sc_wrap(c.anchor.xz);
  float dist = length(vec3(d.x, c.anchor.y - cameraPosition.y, d.y));
  gl_Position = dist < uHullFar && c.fade > 0.0005 ? sc_project(p) : AT_NOWHERE;
}
`;

export const HULL_FRAG = SC_COMMON + FRAGMENT_UTIL + /* glsl */ `
varying vec3 vP;
varying vec3 vLocal;
flat varying float vPart;
flat varying vec4 vLook;
flat varying vec3 vRight;
flat varying vec3 vUp;
flat varying vec3 vFwd;
void main() {
  // Derivatives first, before anything branches.
  vec3 dx = dFdx(vP), dy = dFdy(vP);
  vec3 fl = fwidth(vLocal);
  vec3 L = vLocal;
  vec2 rq = vec2((abs(L.x) - 1.1) / 0.6, (L.z - 0.05) / 0.8);
  float rotor = length(rq);
  float fwRotor = fwidth(rotor);
  float fwm = max(fl.x, max(fl.y, fl.z));

  vec3 view = normalize(vP - vec3(0.0, cameraPosition.y, 0.0));
  vec3 n = at_normal(dx, dy, view);
  vec3 nl = vec3(dot(n, vRight), dot(n, vUp), -dot(n, vFwd));

  float shape = vLook.y;
  vec3 engine = sc_neon(vLook.z);
  vec3 accent = sc_neon(vLook.w);
  vec3 white = sc_neon(7.0);
  float side = smoothstep(0.3, 0.65, abs(nl.x));
  float top = smoothstep(0.5, 0.8, nl.y);
  float under = smoothstep(0.45, 0.75, -nl.y);
  float rear = smoothstep(0.6, 0.9, nl.z);
  float front = smoothstep(0.25, 0.6, -nl.z);

  vec3 col = at_hullBase(n, view);
  vec3 em = vec3(0.0);
  float fres = at_fresnel(n, view);

  if (shape < 0.5) {
    // ---- wedge car
    if (vPart < 0.5) {
      float belt = mix(-0.27, -0.12, smoothstep(-4.0, 3.3, L.z));
      em += accent * 2.4 * sc_line(L.y - belt, 0.04, fl.y) * side * smoothstep(-3.9, -3.2, L.z);
      float pads = at_box(vec2(abs(L.x), L.z), vec2(0.62, 0.7), vec2(0.2, 1.7), fwm);
      em += accent * (0.7 + 1.3 * sc_pulse(L.z / 0.55 + uTime * 2.2, 0.5, fl.z / 0.55)) * pads * under;
      em += (engine * 4.5 + white * 1.2) * at_box(vec2(abs(L.x), L.y), vec2(0.8, 0.0), vec2(0.42, 0.15), fwm) * rear;
      em += accent * 1.3 * sc_line(L.x, 0.025, fl.x) * top * (1.0 - smoothstep(-2.2, -1.9, L.z));
    } else if (vPart < 1.5) {
      // Canopy: dark glass with a glow inside, a bright roof rail and a centre spar.
      col = vec3(0.004, 0.006, 0.016) + fres * uSkyHorizon * 0.4;
      float spar = sc_line(L.x, 0.045, fl.x);
      em += mix(accent, white, 0.2) * (0.05 + 0.2 * smoothstep(-1.9, 1.1, L.z)) * (1.0 - spar);
      em += accent * 1.8 * sc_line(L.z - 1.02, 0.05, fl.z) * (1.0 - rear);
    } else {
      // Fins: a lit trailing edge.
      em += engine * 1.6 * smoothstep(3.5, 3.58, L.z);
    }
  } else if (shape < 1.5) {
    // ---- hauler
    if (vPart < 0.5) {
      vec3 glass = mix(white, sc_neon(4.0), 0.35);
      float pane = 0.2 + 0.5 * (1.0 - smoothstep(0.4, 1.3, L.y));
      em += glass * pane * at_box(L.xy, vec2(0.0, 0.85), vec2(1.45, 0.42), fwm) * front * step(L.z, -6.6)
        * (1.0 - 0.8 * sc_line(L.x, 0.05, fl.x));
      em += glass * pane * at_box(L.zy, vec2(-5.7, 0.85), vec2(0.7, 0.4), fwm) * side;
      em += accent * 2.2 * sc_line(L.y + 0.95, 0.05, fl.y) * side;
      em += accent * 1.5 * at_box(vec2(abs(L.x), L.z), vec2(1.0, -6.6), vec2(0.35, 1.5), fwm) * under;
    } else if (vPart > 2.5) {
      float ribs = sc_pulse(L.z / 1.31, 0.1, fl.z / 1.31);
      col *= 1.0 - 0.55 * ribs * side;
      col += accent * 0.02;
      // A lit band of colour down each flank, broken into panels.
      float band = at_box(vec2(L.y, 0.0), vec2(0.45, 0.0), vec2(0.3, 1.0), fl.y);
      float slats = 0.55 + 0.45 * sc_pulse(L.z / 0.36, 0.6, fl.z / 0.36);
      em += accent * 0.7 * slats * band * side * sc_pulse(L.z / 4.36 + 0.08, 0.86, fl.z / 4.36);
      // Marker lights along the top and bottom rails.
      vec2 mc = vec2((fract(L.z / 2.18) - 0.5) * 2.18, abs(L.y - 0.2) - 1.72);
      float dots = 1.0 - smoothstep(0.08, 0.08 + max(fwm, 0.01), length(mc));
      float rail = sc_line(abs(L.y - 0.2) - 1.72, 0.05, fl.y) * 0.3;
      em += sc_neon(4.0) * 3.2 * mix(rail, dots, sc_detail(2.18, fl.z)) * side;
      em += accent * 1.3 * sc_line(abs(L.x) - 1.7, 0.07, fl.x) * top;
      em += sc_neon(6.0) * 4.0 * at_box(vec2(abs(L.x), L.y), vec2(1.85, -1.3), vec2(0.28, 0.16), fwm) * rear;
      em += accent * 1.6 * sc_line(L.y - 1.85, 0.06, fl.y) * rear;
      float pads = at_box(vec2(abs(L.x), L.z), vec2(1.2, 1.8), vec2(0.45, 5.2), fwm);
      em += accent * (0.6 + 1.2 * sc_pulse(L.z / 0.9 + uTime * 1.6, 0.5, fl.z / 0.9)) * pads * under;
    } else {
      em += (engine * 5.0 + white * 1.5) * at_box(vec2(abs(L.x), L.y), vec2(2.95, 0.0), vec2(0.42, 0.52), fwm) * rear;
      em += engine * 2.0 * sc_line(L.z - 8.5, 0.07, fl.z) * (1.0 - rear);
    }
  } else {
    // ---- drone
    if (vPart < 0.5) {
      em += accent * 2.4 * (1.0 - smoothstep(-1.45, -1.0, L.z));
      em += engine * 1.6 * sc_line(L.z - 0.3, 0.05, fl.z);
    } else {
      float flat_ = smoothstep(0.4, 0.7, abs(nl.y));
      em += accent * 2.4 * sc_line(rotor - 0.6, 0.1, fwRotor) * flat_;
      em += engine * 0.5 * (1.0 - smoothstep(0.0, 0.6, rotor)) * flat_;
    }
  }
  col += em * uGlow;
  gl_FragColor = vec4(sc_fog(col, vP), 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Lights: glow sprites, trails, the searchlight cone and its pool (one fragment shader)
// ---------------------------------------------------------------------------------------------

/** vKind values. */
const KIND = /* glsl */ `
#define AT_SPRITE 0.0
#define AT_RIBBON 1.0
#define AT_CONE 2.0
#define AT_POOL 3.0
`;

// How a sprite is sized and filtered, shared by craft and hero lights.
// size: half-size in metres. Returns the half-size to draw; writes the filter terms.
const SPRITE_VERT = /* glsl */ `
float at_spriteSize(vec3 centre, float size, float minPixels, out float coreRadius, out float gain) {
  float mpp = at_metresPerPixel(centre);
  float drawn = max(size, minPixels * mpp);
  float pixels = drawn / mpp;
  // The hot core is 0.16 of the sprite, but never under about a pixel; widening it dims it, and a
  // sprite held at its minimum size dims with the square root of how much it was enlarged, so far
  // craft stay visible as points without the far field turning into a wall of light.
  coreRadius = max(0.16, 0.85 / pixels);
  gain = (0.16 / coreRadius) * (0.16 / coreRadius) * sqrt(size / drawn);
  return drawn;
}
`;

export const LIGHT_FRAG = SC_COMMON + KIND + /* glsl */ `
// centroid: on a multisampled target a plain varying is evaluated at the pixel centre even when
// that lies outside the triangle. A trail seen end-on is a sliver, the extrapolated 'along' ran
// to minus thousands, exp() of it overflowed, and infinity times a zero fade is NaN, which the
// bloom then spreads into a black block. Centroid sampling keeps every value inside the triangle;
// the clamps below are the second lock on the same door.
centroid varying vec2 vUv;
centroid varying vec3 vColor;    // colour times intensity, fog and far fade already applied
centroid varying vec4 vShape;
flat varying float vKind;
void main() {
  vec3 col;
  vec2 uv = clamp(vUv, vec2(-1.0), vec2(1.0));
  if (vKind < 0.5) {
    // Sprite. vShape: core radius, streak strength, quad aspect, core gain.
    vec2 q = uv * vec2(vShape.z, 1.0);
    float r = length(q);
    float rc = max(vShape.x, 0.05);
    float core = exp(-(r * r) / (rc * rc)) * vShape.w;
    float halo = pow(max(1.0 - r, 0.0), 3.0);
    // The anamorphic streak of an 80s lens, across the whole quad.
    float streak = vShape.y * exp(-abs(uv.y) / (rc * 0.3)) * pow(max(1.0 - abs(uv.x), 0.0), 2.0) * min(vShape.w * 2.0, 1.0);
    col = vColor * (core * 6.0 + halo * 0.45 + streak * 1.2) + vec3(1.5) * core * core * sc_luma(vColor);
  } else if (vKind < 1.5) {
    // Trail or plume. vUv: across -1..1, along 0..1. vShape: line offset, line width (both in
    // units of the half-width), seed, length in metres.
    float a = clamp(uv.y, 0.0, 1.0);
    float sigma = max(vShape.y, 0.02);
    float d1 = (uv.x - vShape.x) / sigma;
    float d2 = (uv.x + vShape.x) / sigma;
    // Two hot exhaust lines inside a soft glow as wide as the ribbon.
    float glow = 1.0 - uv.x * uv.x;
    float prof = exp(-d1 * d1) + exp(-d2 * d2) + 0.16 * glow * glow;
    float fade = pow(max(1.0 - a, 0.0), 1.6) * smoothstep(0.0, 0.03, a);
    float flick = 0.8 + 0.2 * sc_noise(vec2(a * vShape.w * 0.3 - uTime * 7.0, floor(vShape.z * 4096.0 + 0.5)));
    col = vColor * prof * fade * flick * (1.0 + 0.4 * exp(-a * 30.0));
  } else if (vKind < 2.5) {
    // Searchlight cone. vShape.z: seed, vShape.w: length in metres.
    float a = clamp(uv.y, 0.0, 1.0);
    float across = 1.0 - uv.x * uv.x;
    float shimmer = 0.75 + 0.25 * sc_noise(vec2(a * vShape.w * 0.08 - uTime * 0.7, uv.x * 1.5 + vShape.z * 40.0));
    float along = mix(1.0, 0.16, smoothstep(0.0, 1.0, a)) * smoothstep(0.0, 0.01, a) * (1.0 - smoothstep(0.985, 1.0, a));
    col = vColor * across * across * along * shimmer;
  } else {
    // Pool of light on the road.
    float r = length(uv);
    float disc = 1.0 - smoothstep(0.5, 1.0, r);
    col = vColor * (disc * 0.8 + 0.6 * exp(-r * r * 9.0));
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export const CRAFT_LIGHT_VERT = SC_COMMON + SC_VERTEX + CRAFT_MOTION + VERTEX_UTIL + KIND + SPRITE_VERT + /* glsl */ `
attribute vec3 aVert;   // sprite: corner x, corner y, light index. trail: side, along, ${CRAFT_LIGHTS}.
uniform vec4 uLights[${3 * CRAFT_LIGHTS}];   // per shape and light: hull-local position, half-size
uniform vec4 uTrail[3];                      // per shape: y, z, half separation, line half-width
centroid varying vec2 vUv;
centroid varying vec3 vColor;
centroid varying vec4 vShape;
flat varying float vKind;
void main() {
  AtCraft c = at_craft();
  vec3 cam = vec3(0.0, cameraPosition.y, 0.0);
  int shape = int(aLook.y + 0.5);
  float scale = aBob.w;
  float seed = aLook.x;
  vec3 engine = sc_neon(aLook.z);
  vUv = aVert.xy;
  if (c.fade <= 0.0005) {
    vKind = AT_SPRITE; vColor = vec3(0.0); vShape = vec4(1.0);
    gl_Position = AT_NOWHERE;
    return;
  }
  if (aVert.z < ${CRAFT_LIGHTS}.0 - 0.5) {
    int k = int(aVert.z + 0.5);
    vec4 light = uLights[shape * ${CRAFT_LIGHTS} + k];
    vec3 centre = sc_place(c.anchor, at_world(c, light.xyz * scale));
    float ahead = dot(normalize(cam - centre), c.fwd);   // 1 seen from dead ahead, -1 from behind
    vec3 tint;
    float level;
    float streak = 0.0;
    float aspect = 1.0;
    if (k < 2) {
      tint = engine;
      level = mix(0.1, 1.0, smoothstep(-0.25, 0.5, -ahead));
      level *= 0.88 + 0.12 * sin(uTime * 37.0 + seed * 420.0 + float(k) * 2.0);
      streak = 0.35;
    } else if (k == 2) {
      tint = mix(sc_neon(7.0), sc_neon(fract(seed * 13.0) < 0.5 ? 4.0 : 1.0), 0.45 * step(0.4, fract(seed * 29.0)));
      level = mix(0.05, 0.6, smoothstep(-0.1, 0.6, ahead)) + 0.4 * pow(max(ahead, 0.0), 14.0);
      streak = 1.0;
      aspect = 2.4;
    } else if (k == 3) {
      tint = sc_neon(7.0);
      float ph = fract(uTime * (0.7 + 0.5 * fract(seed * 5.0)) + seed * 31.0);
      float flash = step(ph, 0.06) + step(0.14, ph) * step(ph, 0.2);
      level = mix(0.3, 0.05 + 1.5 * flash, uMotion);
      streak = 0.6;
    } else {
      tint = sc_neon(6.0);
      level = 0.25 + 0.6 * (0.5 + 0.5 * sin(SC_TAU * (uTime * 0.55 + seed * 17.0)));
    }
    float size = light.w * scale;
    float coreRadius, gain;
    float drawn = at_spriteSize(centre, size, 2.2, coreRadius, gain);
    vec3 p = sc_sprite(centre, aVert.xy * vec2(aspect, 1.0), drawn);
    vKind = AT_SPRITE;
    vShape = vec4(coreRadius, streak, aspect, gain);
    vColor = tint * (level * c.fade * (1.0 - sc_fogAmount(centre)) * uGlow * mix(sqrt(size / drawn), 1.0, 0.5));
    gl_Position = light.w > 0.0 ? sc_project(p) : AT_NOWHERE;
  } else {
    // Trail: where the craft was, drawn back along the lane; it follows the weave and the bob.
    vec4 trail = uTrail[shape];
    float along = aVert.y;
    float len = aBob.z;
    float alongZ = aLane.z;
    vec3 lane = vec3(1.0 - alongZ, 0.0, alongZ);
    vec3 crs = vec3(alongZ, 0.0, 1.0 - alongZ);
    vec2 past = at_sway(uLoop - along * len / (c.speed * SC_LOOP_SECONDS)) - at_sway(uLoop);
    vec3 local = at_world(c, vec3(0.0, trail.x, trail.y) * scale)
      + crs * past.x + vec3(0.0, past.y, 0.0) - lane * (aLane.w * along * len);
    vec3 pt = sc_place(c.anchor, local);
    vec3 axis = lane * aLane.w;
    // The two exhaust lines spread apart only as far as the engines are seen side by side.
    vec3 across = cross(axis, cam - pt);
    float spread = abs(dot(across / max(length(across), 1e-4), c.right));
    float sep = trail.z * scale * spread;
    float lineW = trail.w * scale;
    float taper = mix(1.0, 0.45, along);
    float halfW = (sep + lineW * 2.6) * taper;
    float mpp = at_metresPerPixel(pt);
    float drawn = max(halfW, 1.8 * mpp);
    float sigma = max(lineW * taper / drawn, 0.42 * step(halfW, 1.8 * mpp));
    vec3 p = sc_axisBillboard(pt, axis, aVert.x, drawn);
    vKind = AT_RIBBON;
    vShape = vec4(sep * taper / drawn, sigma, seed, len);
    // Wider on screen than it really is: dim it by the same factor.
    float energy = min(max(lineW * taper / (sigma * drawn), sqrt(halfW / drawn)), 1.0);
    // A thin line far away reads dimmer than the same light close by: lift it a little with distance.
    energy *= 1.0 + 0.6 * smoothstep(250.0, 1100.0, length(pt - cam));
    vColor = engine * (2.2 * energy * c.fade * sc_axisFacing(pt, axis) * (1.0 - sc_fogAmount(pt)) * uGlow);
    gl_Position = sc_project(p);
  }
}
`;

// ---------------------------------------------------------------------------------------------
// Hero ships
// ---------------------------------------------------------------------------------------------

export const HERO_VERT = SC_COMMON + SC_VERTEX + HERO_MOTION + VERTEX_UTIL + /* glsl */ `
attribute float aPart;
attribute float aType;
varying vec3 vP;
varying vec3 vLocal;
flat varying float vPart;
flat varying vec4 vRun;
flat varying vec3 vRight;
flat varying vec3 vFwd;
void main() {
  AtHero h = at_hero();
  vec3 p = sc_place(h.anchor, at_world(h, position));
  vP = p;
  vLocal = position;
  vPart = aPart;
  vRun = aRun;
  vRight = h.right;
  vFwd = h.fwd;
  gl_Position = abs(aType - aRun.w) < 0.5 && h.fade > 0.0005 ? sc_project(p) : AT_NOWHERE;
}
`;

export const HERO_FRAG = SC_COMMON + FRAGMENT_UTIL + /* glsl */ `
varying vec3 vP;
varying vec3 vLocal;
flat varying float vPart;
flat varying vec4 vRun;
flat varying vec3 vRight;
flat varying vec3 vFwd;

// The airship's flank screen: a striped sun over a neon grid, and an equaliser driven by the beat.
// p: metres on the panel, x -50..50 (reading direction), y -8.5..12.5.
vec3 at_screen(vec2 p, float seed) {
  float v = (p.y + 8.5) / 21.0;
  vec3 colr = mix(sc_neon(0.0), sc_neon(2.0), smoothstep(0.25, 1.0, v)) * mix(0.42, 0.1, v);
  // Sun.
  vec2 sp = p - vec2(-24.0, 1.5);
  float sr = length(sp);
  float sun = 1.0 - smoothstep(8.4, 9.0, sr);
  float cut = step(sp.y, 1.0) * step(fract((sp.y - uTime * 0.7) / 2.4), 0.36 - 0.03 * sp.y);
  vec3 sunCol = mix(sc_neon(0.0), sc_neon(4.0), smoothstep(-8.0, 7.0, sp.y)) * 2.1;
  colr = mix(colr, sunCol, sun * (1.0 - cut));
  // Grid floor under the horizon.
  float below = step(p.y, -3.6);
  float depth = 1.0 / max((-3.6 - p.y) / 4.9 + 0.04, 0.04);
  float rows = step(fract(depth * 0.9 - uTime * 0.5), 0.3);
  float cols = step(abs(fract((p.x + 24.0) * depth * 0.035 + 0.5) - 0.5), 0.07 + 0.02 * depth);
  colr = mix(colr, sc_neon(1.0) * 1.7, below * max(rows, cols) * step(p.x, -2.0));
  colr *= 1.0 - 0.75 * below * step(-2.0, p.x) * step(p.x, 0.0);
  // Equaliser.
  float eq = step(2.0, p.x) * step(p.x, 47.0);
  float bar = floor((p.x - 2.0) / 3.0);
  float beat = floor(uBeat.z);
  float h0 = sc_hash21(vec2(bar, beat + seed * 64.0));
  float h1 = sc_hash21(vec2(bar, beat + 1.0 + seed * 64.0));
  float level = mix(h1, h0, uBeat.x) * (0.45 + 0.55 * uBeat.w) * 0.85 + 0.12;
  float gap = step(0.2, fract((p.x - 2.0) / 3.0));
  float on = eq * gap * step(v, level);
  vec3 barCol = mix(sc_neon(1.0), sc_neon(0.0), smoothstep(0.2, 0.8, v)) * 1.9;
  colr = mix(colr, barCol, on);
  colr = mix(colr, sc_neon(7.0) * 2.4, eq * gap * step(abs(v - level - 0.035), 0.022));
  return colr;
}

void main() {
  // Derivatives first, before anything branches.
  vec3 dx = dFdx(vP), dy = dFdy(vP);
  vec3 fl = fwidth(vLocal);
  vec3 L = vLocal;
  float fwm = max(fl.x, max(fl.y, fl.z));

  vec3 view = normalize(vP - vec3(0.0, cameraPosition.y, 0.0));
  vec3 n = at_normal(dx, dy, view);
  vec3 nl = vec3(dot(n, vRight), n.y, -dot(n, vFwd));

  float type = vRun.w;
  float seed = floor(vRun.z * 4096.0);
  vec3 white = sc_neon(7.0);
  vec3 warm = mix(sc_neon(3.0), sc_neon(4.0), 0.55);
  float side = smoothstep(0.45, 0.75, abs(nl.x));
  float top = smoothstep(0.5, 0.8, nl.y);
  float under = smoothstep(0.3, 0.65, -nl.y);
  float rear = smoothstep(0.6, 0.9, nl.z);
  float front = smoothstep(0.6, 0.9, -nl.z);
  float upright = 1.0 - smoothstep(0.3, 0.6, abs(nl.y));
  float fres = at_fresnel(n, view);

  vec3 col = at_hullBase(n, view);
  vec3 em = vec3(0.0);

  if (type < 0.5) {
    // ================= freighter
    if (vPart < 0.5) {
      // Rows of portholes along the hull, a neon gunwale, running strips under the keel.
      float zone = at_box(L.zy, vec2(6.0, -5.2), vec2(84.0, 5.4), fwm) * step(L.y, -3.0);
      float lit = at_windows(vec2(L.z, L.y + 11.0), vec2(3.4, 3.6), vec2(0.5, 0.3), seed, 0.6, fl.zy);
      vec3 pane = mix(warm, sc_neon(1.0), step(0.85, sc_hash11(floor(L.z / 3.4) + seed)));
      em += pane * 1.25 * lit * zone * side;
      em += sc_neon(0.0) * 2.6 * sc_line(L.y - 3.6, 0.28, fl.y) * upright * (1.0 - front) * (1.0 - rear);
      em += sc_neon(1.0) * 1.2 * sc_line(L.y + 2.0, 0.14, fl.y) * side;
      float dash = sc_pulse(L.z / 9.0 - uTime * 0.3, 0.55, fl.z / 9.0);
      em += sc_neon(1.0) * 2.0 * sc_line(abs(L.x) - 7.5, 0.4, fl.x) * dash * under;
      em += sc_neon(2.0) * 0.22 * under;
      em += sc_neon(4.0) * 1.2 * sc_line(abs(L.x) - 16.6, 0.22, fl.x) * top;
      em += sc_neon(4.0) * 0.8 * sc_pulse(L.z / 17.5 + 0.02, 0.05, fl.z / 17.5) * top * step(abs(L.x), 16.6);
    } else if (vPart > 2.5 && vPart < 3.5) {
      // Containers: each stack its own colour, with lit bands, ribs and corner posts.
      float zi = (L.z + 64.0) / 17.5;
      float block = floor(zi);
      float zb = (zi - block) * 17.5;
      vec3 tint = sc_neon(floor(sc_hash11(block * 7.0 + seed) * 6.0));
      vec3 tint2 = sc_neon(floor(sc_hash11(block * 7.0 + seed + 3.0) * 6.0));
      float ribs = sc_pulse(zb / 2.0, 0.12, fl.z / 2.0);
      col = col * (1.0 - 0.5 * ribs * side) + tint * 0.035;
      float posts = sc_line(min(zb, 16.0 - zb) - 0.35, 0.2, fl.z);
      em += tint * 1.9 * posts * upright;
      em += tint * 0.8 * at_box(vec2(L.y, 0.0), vec2(9.2, 0.0), vec2(1.3, 1.0), fl.y) * side * (1.0 - ribs);
      em += tint2 * 1.6 * sc_line(L.y - 6.2, 0.16, fl.y) * upright;
      em += tint * 1.5 * sc_line(abs(L.x) - 12.5, 0.25, fl.x) * top;
      em += tint2 * 1.2 * sc_line(abs(zb - 8.0) - 6.6, 0.25, fl.z) * top * step(abs(L.x), 12.5);
    } else if (vPart > 0.5 && vPart < 1.5) {
      // Superstructure: a wall of lit windows, and the bridge's strip of glass on top.
      float bridge = step(22.0, L.y);
      vec2 uv = vec2(mix(L.x, L.z, side), L.y);
      vec2 fw2 = vec2(mix(fl.x, fl.z, side), fl.y);
      float lit = at_windows(uv + vec2(0.0, -5.4), vec2(2.4, 2.75), vec2(0.6, 0.45), seed + 11.0, 0.72, fw2);
      em += mix(warm, white, 0.3) * 1.4 * lit * upright * (1.0 - bridge);
      float glass = at_box(vec2(L.y, 0.0), vec2(24.9, 0.0), vec2(1.25, 1.0), fl.y) * sc_pulse(uv.x / 2.2, 0.9, fw2.x / 2.2);
      em += sc_neon(1.0) * 2.6 * glass * upright * bridge;
      em += sc_neon(0.0) * 2.0 * sc_line(L.y - 27.2, 0.14, fl.y) * upright * bridge;
      em += sc_neon(1.0) * 1.2 * sc_line(length(L.xz - vec2(0.0, 53.5)) - 5.0, 0.3, fwm) * top * bridge;
    } else if (vPart > 1.5 && vPart < 2.5) {
      vec2 q = vec2(abs(L.x) - 23.0, L.y + 5.0) / 3.6;
      float g = 1.0 - smoothstep(0.25, 1.0, length(q));
      em += (sc_neon(3.0) * 6.5 + white * 2.5 * g) * g * rear;
      em += sc_neon(3.0) * 1.8 * sc_pulse(L.z / 7.0, 0.12, fl.z / 7.0) * (1.0 - rear);
    } else {
      em += sc_neon(6.0) * 2.0 * sc_pulse(L.y / 4.0, 0.2, fl.y / 4.0) * step(20.0, L.y);
      em += sc_neon(1.0) * 1.6 * under * step(L.y, -10.0);
    }
  } else if (type < 1.5) {
    // ================= airship
    if (vPart < 0.5) {
      float sgn = L.x < 0.0 ? -1.0 : 1.0;
      vec2 pp = vec2(L.z * sgn, L.y);
      float inPanel = at_box(pp, vec2(0.0, 2.0), vec2(50.0, 10.5), fwm) * side;
      // LED cells: the picture is sampled at cell centres, and each cell is a round dot up close.
      float cell = 0.75;
      vec2 id = floor(pp / cell);
      vec2 cf = fract(pp / cell) - 0.5;
      float dotMask = 1.0 - smoothstep(0.3, 0.46, length(cf));
      float detail = sc_detail(cell, fwm);
      vec3 picture = at_screen((id + 0.5) * cell, vRun.z);
      em += picture * mix(0.55, dotMask * 1.25, detail) * inPanel;
      em += sc_neon(1.0) * 2.4 * sc_line(max(abs(pp.x) - 50.6, abs(pp.y - 2.0) - 11.1), 0.22, fwm) * side;
      // Envelope: station rings, a glowing nose, and the belly.
      float ringLine = sc_line(abs(L.z) - 66.0, 0.3, fl.z) + sc_line(abs(L.z) - 80.0, 0.25, fl.z);
      em += sc_neon(2.0) * 1.8 * ringLine;
      em += sc_neon(1.0) * 1.5 * (1.0 - smoothstep(-90.0, -84.5, L.z));
      em += sc_neon(0.0) * 1.6 * sc_line(L.y - 16.5, 0.22, fl.y) * step(abs(L.z), 62.0) * (1.0 - top);
      float belly = under * (1.0 - smoothstep(48.0, 64.0, abs(L.z + 4.0)));
      vec3 bellyCol = mix(sc_neon(0.0), sc_neon(1.0), 0.5 + 0.5 * sin(L.z * 0.045 + uTime * 0.4));
      float chase = sc_pulse(L.z / 7.0 - uTime * 0.22, 0.5, fl.z / 7.0);
      em += bellyCol * (0.5 + 0.35 * uBeat.x + 0.9 * chase * sc_line(abs(L.x) - 9.0, 1.1, fl.x)) * belly;
    } else if (vPart > 0.5 && vPart < 1.5) {
      vec2 uv = vec2(mix(L.x, L.z, side), L.y);
      vec2 fw2 = vec2(mix(fl.x, fl.z, side), fl.y);
      float glass = at_box(vec2(L.y, 0.0), vec2(-27.2, 0.0), vec2(1.7, 1.0), fl.y) * sc_pulse(uv.x / 2.4, 0.84, fw2.x / 2.4);
      em += mix(warm, white, 0.25) * 1.5 * glass * upright;
      // Underside: a lit landing grid rather than a slab of light.
      float grid = max(sc_line(abs(L.x) - 3.2, 0.25, fl.x), sc_pulse((L.z + 28.0) / 6.0, 0.1, fl.z / 6.0));
      em += sc_neon(4.0) * (0.12 + 1.5 * grid) * under;
    } else if (vPart > 1.5 && vPart < 2.5) {
      vec2 q = vec2(abs(L.x) - 28.25, L.y + 9.0) / 2.9;
      float g = 1.0 - smoothstep(0.25, 1.0, length(q));
      em += (sc_neon(2.0) * 6.0 + white * 2.0 * g) * g * rear;
      em += sc_neon(2.0) * 1.6 * sc_line(L.z - 24.0, 0.25, fl.z) * (1.0 - rear);
    } else {
      // Fins: chevron stripes and a lit trailing edge.
      float stripes = sc_pulse((L.z - abs(L.x + L.y) * 0.5) / 6.0, 0.3, (fl.z + 0.5 * (fl.x + fl.y)) / 6.0);
      em += sc_neon(0.0) * 0.9 * stripes * step(64.0, L.z);
      em += sc_neon(6.0) * 2.6 * smoothstep(89.0, 89.8, L.z);
    }
  } else {
    // ================= patrol craft
    float ph = fract(uTime * 1.5 + vRun.z);
    float flashA = mix(0.5, 0.06 + at_flash(ph), uMotion);
    float flashB = mix(0.5, 0.06 + at_flash(fract(ph + 0.5)), uMotion);
    vec3 blue = at_palette(1.62);
    if (vPart < 0.5) {
      // Livery: a chequered band along each flank, hood lines, hover pads.
      float band = at_box(vec2(L.y, 0.0), vec2(-1.05, 0.0), vec2(0.55, 1.0), fl.y) * step(-24.0, L.z);
      float chk = sc_pulse(L.z / 5.0, 0.5, fl.z / 5.0);
      em += mix(blue * 0.9, white * 0.75, chk) * band * side;
      em += blue * 2.2 * sc_line(L.y + 0.28, 0.07, fl.y) * side;
      em += sc_neon(1.0) * 1.6 * sc_line(abs(L.x) - 1.5, 0.1, fl.x) * top * step(-3.0, L.z);
      em += blue * 1.9 * at_box(vec2(abs(L.x), L.z), vec2(3.3, 9.0), vec2(1.0, 11.0), fwm) * under;
      em += white * 0.6 * at_box(L.xz, vec2(0.0, -20.0), vec2(1.0, 4.0), fwm) * under;
    } else if (vPart < 1.5) {
      col = vec3(0.005, 0.008, 0.02) + fres * uSkyHorizon * 0.25;
      em += sc_neon(1.0) * (0.2 + 0.5 * smoothstep(1.5, 3.6, L.y));
    } else if (vPart < 2.5) {
      vec2 q = vec2(abs(L.x) - 3.5, L.y) / vec2(1.3, 1.2);
      float g = 1.0 - smoothstep(0.3, 1.0, length(q));
      em += (sc_neon(1.0) * 6.0 + white * 2.0 * g) * g * rear;
    } else if (vPart < 4.5) {
      // Wings: a lit leading strip near the tip; fins: one red, one blue.
      float fin = step(1.0, L.y);
      em += sc_neon(1.0) * 1.8 * sc_line(abs(L.x) - 11.9, 0.14, fl.x) * (1.0 - fin) * (1.0 - smoothstep(0.3, 0.6, abs(nl.x)));
      vec3 finCol = L.x < 0.0 ? sc_neon(6.0) * flashA : blue * flashB;
      em += finCol * 1.8 * smoothstep(6.6, 7.2, L.y) * fin;
      em += white * 0.5 * sc_line(L.y - 5.0, 0.12, fl.y) * fin;
    } else if (vPart < 5.5) {
      em += (L.x < 0.0 ? sc_neon(6.0) * flashA : blue * flashB) * 4.5;
    } else {
      em += white * 5.0 * under + sc_neon(1.0) * 0.8;
    }
  }
  col += em * uGlow;
  gl_FragColor = vec4(sc_fog(col, vP), 1.0);
}
`;

export const HERO_LIGHT_VERT = SC_COMMON + SC_VERTEX + HERO_MOTION + VERTEX_UTIL + KIND + SPRITE_VERT + /* glsl */ `
attribute vec3 aLocal;  // hull-local position
attribute vec4 aSpec;   // half-size (or plume length), palette index, mode, phase
attribute vec3 aQuad;   // corner x, corner y, type
centroid varying vec2 vUv;
centroid varying vec3 vColor;
centroid varying vec4 vShape;
flat varying float vKind;
float at_flash2(float ph) { return step(ph, 0.07) + step(0.15, ph) * step(ph, 0.22); }
void main() {
  AtHero h = at_hero();
  vec3 cam = vec3(0.0, cameraPosition.y, 0.0);
  float seed = aRun.z;
  float mode = aSpec.z;
  vec3 tint = at_palette(aSpec.y);
  vUv = aQuad.xy;
  vKind = AT_SPRITE;
  vShape = vec4(1.0);
  vColor = vec3(0.0);
  if (abs(aQuad.z - aRun.w) > 0.5 || h.fade <= 0.0005) {
    gl_Position = AT_NOWHERE;
    return;
  }
  vec3 origin = at_world(h, aLocal);
  if (mode < 9.5) {
    vec3 centre = sc_place(h.anchor, origin);
    float ahead = dot(normalize(cam - centre), h.fwd);
    float level = 3.0;
    float streak = 0.5;
    float aspect = 1.0;
    if (mode < 0.5) {
      level = 2.6;
    } else if (mode < 1.5) {
      float ph = fract(uTime * 0.8 + aSpec.w + seed);
      level = mix(1.5, 0.1 + 8.0 * at_flash2(ph), uMotion);
      streak = 1.0; aspect = 2.0;
    } else if (mode < 2.5) {
      level = 0.5 + 3.2 * pow(max(0.5 + 0.5 * sin(SC_TAU * (uTime * 0.45 - aSpec.w + seed)), 0.0), 2.0);
    } else if (mode < 4.5) {
      float ph = fract(uTime * 1.5 + seed + (mode > 3.5 ? 0.5 : 0.0));
      level = mix(2.0, 0.15 + 9.0 * at_flash2(ph), uMotion);
      streak = 1.0; aspect = 2.2;
    } else if (mode < 5.5) {
      level = 6.0 * mix(0.12, 1.0, smoothstep(-0.25, 0.5, -ahead));
      level *= 0.9 + 0.1 * sin(uTime * 23.0 + seed * 90.0 + aLocal.x);
    } else if (mode < 6.5) {
      vec3 dir = at_searchDir(h, seed);
      float into = max(dot(normalize(cam - centre), dir), 0.0);
      level = 3.0 + 9.0 * pow(into, 6.0);
      streak = 1.0; aspect = 2.4;
    } else {
      level = 4.0 * (mix(0.08, 0.8, smoothstep(-0.1, 0.6, ahead)) + 0.8 * pow(max(ahead, 0.0), 14.0));
      streak = 1.0; aspect = 2.4;
    }
    float coreRadius, gain;
    float drawn = at_spriteSize(centre, aSpec.x, 2.4, coreRadius, gain);
    vec3 p = sc_sprite(centre, aQuad.xy * vec2(aspect, 1.0), drawn);
    vShape = vec4(coreRadius, streak, aspect, gain);
    vColor = tint * (level / 6.0 * h.fade * (1.0 - sc_fogAmount(centre)) * uGlow);
    gl_Position = sc_project(p);
  } else if (mode < 11.5) {
    // Searchlight: the cone from the lamp to the road, and the pool where it lands.
    vec3 dir = at_searchDir(h, seed);
    float reach = (h.anchor.y + origin.y) / max(-dir.y, 0.2);
    if (mode < 10.5) {
      float along = aQuad.y;
      vec3 pt = sc_place(h.anchor, origin + dir * (reach * along));
      float halfW = mix(1.1, 10.0, along);
      vec3 p = sc_axisBillboard(pt, dir, aQuad.x, halfW);
      vKind = AT_CONE;
      vShape = vec4(0.0, 0.0, seed, reach);
      vColor = mix(tint, sc_neon(1.0), 0.25) * (1.5 * h.fade * (1.0 - sc_fogAmount(pt)) * uGlow);
      gl_Position = sc_project(p);
    } else {
      vec3 ground = h.anchor + origin + dir * reach;
      vec3 p = sc_place(vec3(ground.x, 0.0, ground.z), vec3(aQuad.x * 11.0, 0.5, aQuad.y * 11.0));
      vKind = AT_POOL;
      vColor = mix(tint, sc_neon(1.0), 0.25) * (1.3 * h.fade * (1.0 - sc_fogAmount(p)) * uGlow);
      gl_Position = sc_project(p);
    }
  } else {
    // Exhaust plume, straight astern.
    float along = aQuad.y;
    float len = aSpec.x;
    vec3 pt = sc_place(h.anchor, origin - h.fwd * (len * along));
    float halfW = len * mix(0.07, 0.025, along);
    vec3 p = sc_axisBillboard(pt, h.fwd, aQuad.x, halfW);
    vKind = AT_RIBBON;
    vShape = vec4(0.0, 0.5, seed + aLocal.x * 0.01, len);
    vColor = tint * (1.1 * h.fade * sc_axisFacing(pt, h.fwd) * (1.0 - sc_fogAmount(pt)) * uGlow);
    gl_Position = sc_project(p);
  }
}
`;
