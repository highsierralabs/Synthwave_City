// The shared GLSL (architecture.md section 8.3).
//
// Every vertex shader starts with  SC_COMMON + SC_VERTEX  and every fragment shader with  SC_COMMON.
// three's ShaderMaterial already declares projectionMatrix, viewMatrix and cameraPosition
// (vertex: all three; fragment: viewMatrix and cameraPosition), and compiles as GLSL ES 3.00.
//
// "Render space" below means: x and z relative to the camera (wrapped), y absolute. The camera sits
// at (0, cameraPosition.y, 0).
import {
  AVENUE, AVENUE_EVERY, CELL, CELLS, LOOP_SECONDS, STREET, TILE,
} from './constants';

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export const SC_COMMON = /* glsl */ `
#define SC_TILE ${f(TILE)}
#define SC_CELL ${f(CELL)}
#define SC_CELLS ${f(CELLS)}
#define SC_AVENUE_EVERY ${f(AVENUE_EVERY)}
#define SC_STREET_CORRIDOR ${f(STREET.corridorHalf)}
#define SC_STREET_ROAD ${f(STREET.roadHalf)}
#define SC_AVENUE_CORRIDOR ${f(AVENUE.corridorHalf)}
#define SC_AVENUE_ROAD ${f(AVENUE.roadHalf)}
#define SC_AVENUE_MEDIAN ${f(AVENUE.median)}
#define SC_LOOP_SECONDS ${f(LOOP_SECONDS)}
#define SC_PI 3.141592653589793
#define SC_TAU 6.283185307179586

uniform float uTime;
uniform float uLoop;
uniform vec4 uBeat;
uniform vec3 uCam;
uniform vec2 uFar;
uniform vec4 uFog;
uniform vec3 uFogWarm;
uniform vec3 uFogCool;
uniform vec3 uSunDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSunTop;
uniform vec3 uSunBottom;
uniform vec3 uAmbient;
uniform vec3 uPalette[8];
uniform float uGlow;
uniform float uStars;
uniform float uWet;
uniform float uMotion;
uniform vec2 uResolution;
uniform highp sampler2D uCellTex;
uniform sampler2D uReflTex;
uniform mat4 uReflMatrix;
uniform float uReflAmount;
uniform float uExposure;

// ---- hashes: integer based, identical on every GPU. Feed them small exact values (cell indices, seeds).
uint sc_bits(float v) { return floatBitsToUint(v == 0.0 ? 0.0 : v); }
uint sc_hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
float sc_unit(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }
float sc_hash11(float p) { return sc_unit(sc_hashu(sc_bits(p))); }
float sc_hash21(vec2 p) { return sc_unit(sc_hashu(sc_bits(p.x) ^ sc_hashu(sc_bits(p.y)))); }
float sc_hash31(vec3 p) { return sc_unit(sc_hashu(sc_bits(p.x) ^ sc_hashu(sc_bits(p.y) ^ sc_hashu(sc_bits(p.z))))); }
vec2 sc_hash22(vec2 p) {
  uint h = sc_hashu(sc_bits(p.x) ^ sc_hashu(sc_bits(p.y)));
  return vec2(sc_unit(h), sc_unit(sc_hashu(h)));
}
vec3 sc_hash33(vec3 p) {
  uint h = sc_hashu(sc_bits(p.x) ^ sc_hashu(sc_bits(p.y) ^ sc_hashu(sc_bits(p.z))));
  uint h2 = sc_hashu(h);
  return vec3(sc_unit(h), sc_unit(h2), sc_unit(sc_hashu(h2)));
}
// Smooth value noise, 0..1.
float sc_noise(vec2 p) {
  vec2 i = floor(p), u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(sc_hash21(i), sc_hash21(i + vec2(1.0, 0.0)), u.x),
             mix(sc_hash21(i + vec2(0.0, 1.0)), sc_hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sc_fbm(vec2 p) {
  return 0.5 * sc_noise(p) + 0.3 * sc_noise(p * 2.03 + 17.0) + 0.2 * sc_noise(p * 4.01 + 43.0);
}

// ---- palette
vec3 sc_neon(float index) { return uPalette[int(clamp(index, 0.0, 7.0) + 0.5)]; }
float sc_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// ---- the wrapped world
// Nearest copy of a tile position, relative to the camera: each component in -TILE/2 .. TILE/2.
vec2 sc_wrap(vec2 tileXZ) {
  vec2 d = tileXZ - uCam.xz;
  return d - SC_TILE * floor(d / SC_TILE + 0.5);
}
// Far-fade factor for a camera-relative offset: 1 near, 0 at and beyond uFar.y.
float sc_farFade(vec2 relXZ) { return 1.0 - smoothstep(uFar.x, uFar.y, length(relXZ)); }
// Place an object. anchor: its tile position (the wrap and the far fade are taken from it, so the
// object stays whole). local: this vertex's offset from the anchor. Returns render space.
// Beyond the far fade the object collapses to a point and draws nothing.
vec3 sc_place(vec3 anchor, vec3 local) {
  vec2 d = sc_wrap(anchor.xz);
  float k = sc_farFade(d);
  float alive = step(0.0005, k);
  return vec3(d.x + local.x * alive, (anchor.y + local.y) * k, d.y + local.z * alive);
}

// ---- fog
// Fog colour for a view direction: warm towards the sun, cool away from it.
vec3 sc_fogColor(vec3 dir) {
  vec2 h = dir.xz / max(length(dir.xz), 1e-4);
  vec2 s = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float t = 0.5 + 0.5 * dot(h, s);
  return mix(uFogCool, uFogWarm, t * t);
}
// Fog amount 0..1 between the camera and a render-space position.
float sc_fogAmount(vec3 p) {
  float yc = abs(cameraPosition.y);
  vec3 v = p - vec3(0.0, cameraPosition.y, 0.0);
  float dist = length(v);
  float dy = p.y - yc;
  float k = uFog.z;
  float a = exp(-k * yc);
  float b = exp(-k * max(p.y, 0.0));
  float mean = abs(dy) > 1.0 ? (a - b) / (k * dy) : a;
  float tau = dist * (uFog.x + uFog.y * mean);
  return min(1.0 - exp(-tau), uFog.w);
}
// Apply fog to a colour at a render-space position. Use on every surface, emissive or not.
vec3 sc_fog(vec3 color, vec3 p) {
  vec3 v = p - vec3(0.0, cameraPosition.y, 0.0);
  return mix(color, sc_fogColor(normalize(v)), sc_fogAmount(p));
}

// ---- the street grid (mirrors src/contracts/constants.ts)
float sc_isAvenue(float line) { return 1.0 - step(0.5, mod(line, SC_AVENUE_EVERY)); }
// For one tile coordinate: x = index of the nearest grid line (0..CELLS-1), y = signed distance
// to its centre line in metres, z = 1 if that line is an avenue.
vec3 sc_gridLine(float c) {
  float line = floor(c / SC_CELL + 0.5);
  float d = c - line * SC_CELL;
  line = mod(line, SC_CELLS);
  return vec3(line, d, sc_isAvenue(line));
}
float sc_corridorHalf(float avenue) { return mix(SC_STREET_CORRIDOR, SC_AVENUE_CORRIDOR, avenue); }
float sc_roadHalf(float avenue) { return mix(SC_STREET_ROAD, SC_AVENUE_ROAD, avenue); }
// Cell index (0..CELLS-1 on each axis) containing a tile position, and that cell's data texel:
// r district * 255, g palette index * 255, b height / CELL_HEIGHT_UNIT * 255, a seed.
ivec2 sc_cell(vec2 tileXZ) { return ivec2(mod(floor(tileXZ / SC_CELL), SC_CELLS)); }
vec4 sc_cellData(ivec2 cell) { return texelFetch(uCellTex, cell, 0) * 255.0; }

// ---- filtering (take fw = fwidth(coordinate) BEFORE any fract or branch)
// A line of half-width w centred on d = 0, antialiased; thinner than a pixel it dims instead of aliasing.
float sc_line(float d, float w, float fw) {
  fw = max(fw, 1e-5);
  float ww = max(w, fw);
  return (1.0 - smoothstep(ww - fw, ww + fw, abs(d))) * (w / ww);
}
// A repeating pulse of period 1 that is "on" for x in [0, duty), box-filtered over a footprint fw.
float sc_pulse(float x, float duty, float fw) {
  fw = max(fw, 1e-5);
  float a = x - 0.5 * fw, b = x + 0.5 * fw;
  float ia = floor(a) * duty + min(fract(a), duty);
  float ib = floor(b) * duty + min(fract(b), duty);
  return clamp((ib - ia) / fw, 0.0, 1.0);
}
// 1 where detail of size cellSize (same units as fw) is resolvable, 0 where it is under ~1.5 pixels.
// Mix a pattern towards its average with this.
float sc_detail(float cellSize, float fw) { return 1.0 - smoothstep(0.35, 0.7, fw / max(cellSize, 1e-5)); }
`;

/** Vertex-only helpers. Append after SC_COMMON in vertex shaders. */
export const SC_VERTEX = /* glsl */ `
vec4 sc_project(vec3 renderPos) { return projectionMatrix * viewMatrix * vec4(renderPos, 1.0); }

// Camera-facing sprite. centre: render space. corner: -1..1 on each axis. size: half-size in metres.
vec3 sc_sprite(vec3 centre, vec2 corner, float size) {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  return centre + (right * corner.x + up * corner.y) * size;
}
// Half-size in metres that covers at least minPixels pixels at this render-space position.
float sc_minSize(vec3 centre, float size, float minPixels) {
  float dist = length(centre - vec3(0.0, cameraPosition.y, 0.0));
  float metresPerPixel = 2.0 * dist / (uResolution.y * projectionMatrix[1][1]);
  return max(size, minPixels * metresPerPixel);
}
// A ribbon that turns about its own axis to face the camera (beams, trails).
// point: render-space position on the axis. axis: unit direction. side: -1..1 across. halfWidth: metres.
vec3 sc_axisBillboard(vec3 point, vec3 axis, float side, float halfWidth) {
  vec3 toCam = vec3(0.0, cameraPosition.y, 0.0) - point;
  vec3 right = cross(axis, toCam);
  float len = length(right);
  right = len > 1e-4 ? right / len : vec3(1.0, 0.0, 0.0);
  return point + right * side * halfWidth;
}
// 0 when the camera looks nearly along the axis (the ribbon is degenerate there), 1 side-on.
float sc_axisFacing(vec3 point, vec3 axis) {
  vec3 toCam = normalize(vec3(0.0, cameraPosition.y, 0.0) - point);
  return smoothstep(0.02, 0.25, length(cross(axis, toCam)));
}
`;
