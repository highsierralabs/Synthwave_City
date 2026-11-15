// GLSL of the sky dome (plan T03), generated from ./params.ts.
//
// The dome is a camera-centred cube drawn at the far plane. The fragment shader works from the
// view direction only, so it is the same picture for the main camera and for the mirrored camera
// of the reflection pass. Everything periodic is filtered against `px`, the angle one pixel covers,
// which is taken from derivatives of the direction itself: it has no seam, unlike a derivative of
// an azimuth angle. All derivatives are taken at the top of main, so the rest may branch freely.
import { SC_COMMON, SC_VERTEX } from '../../contracts/glsl';
import { SKY, chord, type MountainRange } from './params';

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export const SKY_VERTEX = SC_COMMON + SC_VERTEX + /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation only: the dome is centred on whichever camera is drawing. z = w puts it on the far plane.
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;

const { gradient, haze, sun, stars, clouds, mountains, lights } = SKY;
const bandLength = Math.hypot(stars.bandNormal[0], stars.bandNormal[1], stars.bandNormal[2]);
const bandNormal = stars.bandNormal.map((v) => f(v / bandLength)).join(', ');
/** Above this tan(elevation) no range can reach, so the mountain code is skipped. */
const mountainTop = Math.max(...mountains.ranges.map((r) => r.amp)) + mountains.base + 0.01;

// One range of wireframe mountains, as a triangulated mesh seen side-on.
//
// Vertices sit on integer columns x and on `rows` rows up the slope. The top row is the ridge, whose
// heights come from sky_peak; the slope below is treated as a plane rising away from the viewer
// from distance r0 to r1 (rho = r0 / r1), which gives the rows true perspective spacing,
// u = s / (rho + s (1 - rho)), and each vertex is nudged off its row so the facets are irregular.
// Edges are straight between vertices: rows, columns and one diagonal per cell. Distances to them
// are converted to pixels with the screen gradients gt (of t) and gx (of x), so every line is
// filtered against the pixel grid.
function rangeFunction(r: MountainRange, index: number): string {
  return /* glsl */ `
vec4 sky_range${index}(float x, vec2 gx, float t, vec2 gt, float px, float amp, vec3 fill, vec3 line) {
  float i = floor(x);
  float fx = x - i;
  float ka = i - ${f(r.cols)} * floor((i + 0.5) / ${f(r.cols)});
  float kb = ka + 1.0;
  kb -= ${f(r.cols)} * floor((kb + 0.5) / ${f(r.cols)});
  float topA = SKY_BASE + amp * (sky_peak(ka, ${f(r.cols)}, ${f(r.massif)}, ${f(r.seed)}) - ${f(r.sink)});
  float topB = SKY_BASE + amp * (sky_peak(kb, ${f(r.cols)}, ${f(r.massif)}, ${f(r.seed)}) - ${f(r.sink)});
  float top = mix(topA, topB, fx);

  // Silhouette and ridge line, from the distance to the ridge in pixels.
  float ePx = (t - top) / max(length(gt - (topB - topA) * gx), 1e-7);
  float cover = 1.0 - smoothstep(-0.7, 0.7, ePx);
  float wRidge = ${f(mountains.ridgeWidth)} / px;
  float ridge = sky_linePx(ePx + max(wRidge, 1.0), wRidge);

  float spanA = topA - SKY_FOOT;
  float spanB = topB - SKY_FOOT;
  float edge = min(fx, 1.0 - fx) / max(length(gx), 1e-7);   // pixels to the nearest mesh edge; columns first
  float facet = 0.0;
  float lowA = SKY_FOOT;
  float above = step(SKY_FOOT, t);
  float uPrev = 0.0;
  for (int k = 1; k <= ${r.rows}; k++) {
    float s = float(k) / ${f(r.rows)};
    float uk = s / (${f(r.rho)} + s * (1.0 - ${f(r.rho)}));
    float wob = k < ${r.rows} ? ${f(r.jitter)} * (uk - uPrev) : 0.0;
    float hiA = SKY_FOOT + spanA * (uk + wob * (2.0 * sc_hash21(vec2(ka, ${f(r.seed)} + float(k))) - 1.0));
    float hiB = SKY_FOOT + spanB * (uk + wob * (2.0 * sc_hash21(vec2(kb, ${f(r.seed)} + float(k))) - 1.0));
    float er = t - mix(hiA, hiB, fx);
    float inRow = above * step(er, 0.0);
    edge = min(edge, abs(er) / max(length(gt - (hiB - hiA) * gx), 1e-7));
    float ed = t - mix(lowA, hiB, fx);
    edge = min(edge, mix(1e4, abs(ed) / max(length(gt - (hiB - lowA) * gx), 1e-7), inRow));
    facet = mix(facet, float(k) * 2.0 + step(0.0, ed), inRow);
    above = step(0.0, er);
    lowA = hiA;
    uPrev = uk;
  }

  // The mesh fades out where a cell is only a couple of pixels across.
  float cellPx = min(1.0 / max(length(gx), 1e-7), (top - SKY_FOOT) / (${f(r.rows)} * max(length(gt), 1e-7)));
  float mesh = sky_linePx(edge, ${f(mountains.gridWidth)} / px) * smoothstep(2.0, 5.0, cellPx);

  float u = clamp((t - SKY_FOOT) / max(top - SKY_FOOT, 1e-4), 0.0, 1.0);
  float shade = 0.6 + 0.8 * sc_hash21(vec2(ka * 32.0 + facet, ${f(r.seed)} + 0.25));
  vec3 c = fill * shade * (0.7 + 0.6 * u);
  c += line * uGlow * (ridge * ${f(r.ridgeGain)} + mesh * ${f(r.gridGain)} * (0.4 + 0.6 * u));
  return vec4(c, cover);
}
`;
}

function rangeCall(r: MountainRange, index: number): string {
  return /* glsl */ `
    {
      float env = mix(${f(r.awayScale)}, 1.0, flank) * (1.0 - ${f(r.notch)} * notch);
      vec4 m = sky_range${index}(az * ${f(r.cols)}, gaz * ${f(r.cols)}, tanEl, gt, px, ${f(r.amp)} * env,
        mix(fillNear, fillFar, ${f(r.aerial)}), sc_neon(${f(r.color)}));
      col = mix(col, m.rgb, m.a);
    }`;
}

export const SKY_FRAGMENT = SC_COMMON + /* glsl */ `
varying vec3 vDir;

#define SKY_SUN_R ${f(chord(sun.radiusDeg))}
#define SKY_BASE ${f(mountains.base)}
#define SKY_FOOT ${f(mountains.foot)}
#define SKY_MOUNTAIN_TOP ${f(mountainTop)}
#define SKY_LIGHT_COLS ${f(lights.cols)}
#define SKY_LIGHT_ROWS ${f(lights.rows)}
#define SKY_LIGHT_ROW_H ${f(lights.rowHeight)}

// Value noise on a 3D lattice, 0..1. Sampled on the direction, so it has no seam on the dome.
float sky_noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float n000 = sc_hash31(i);
  float n100 = sc_hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = sc_hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = sc_hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = sc_hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = sc_hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = sc_hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = sc_hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// A line at distance dPx (pixels) with half-width wPx (pixels), antialiased over one pixel;
// thinner than a pixel it dims instead of aliasing.
float sky_linePx(float dPx, float wPx) { return sc_line(dPx, wPx, 1.0); }

// The cube face a direction falls on. q: the direction in that face's frame (xy across the face,
// z out of it and positive). On the four side faces q.y is world up, so sparkle arms stand upright.
float sky_face(vec3 d, out vec3 q) {
  vec3 a = abs(d);
  float face;
  if (a.x >= a.y && a.x >= a.z) { q = vec3(d.z, d.y, a.x); face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { q = vec3(d.x, d.z, a.y); face = d.y > 0.0 ? 2.0 : 3.0; }
  else { q = vec3(d.x, d.y, a.z); face = d.z > 0.0 ? 4.0 : 5.0; }
  return face;
}

// One layer of stars: a grid of n x n cells on each cube face, at most one star per cell, kept
// clear of the cell edge so no star is cut. A star is a small Gaussian at least 0.8 pixel in
// radius, so it does not flicker as it crosses pixel centres when the camera turns.
// size: x smallest and y largest radius (radians), z brightest intensity.
vec3 sky_starLayer(vec3 q, vec2 w, float face, float n, float seed, float px, float density, float sparkleShare, vec3 size) {
  vec2 cell = floor(clamp((w * 0.5 + 0.5) * n, 0.0, n - 0.001));
  float key = face * 8.0 + seed;
  vec3 r = sc_hash33(vec3(cell, key));
  vec3 r2 = sc_hash33(vec3(cell, key + 0.5));
  vec2 cw = (cell + 0.16 + 0.68 * r2.xy) / n * 2.0 - 1.0;
  vec3 o = q - normalize(vec3(tan(cw * (SC_PI * 0.25)), 1.0));

  float sparkle = step(r2.z, sparkleShare);
  float b = r.y * r.y;
  b = mix(b * b, 0.85, sparkle);
  float rad = mix(size.x, size.y, b);
  float used = max(rad, 0.8 * px);
  float point = mix(0.07, 1.0, b) * size.z * (rad / used) * exp(-dot(o, o) / (used * used));
  float twinkle = 1.0 + (0.28 + 0.3 * sparkle) * uMotion * sin(uTime * (0.8 + 3.5 * r.z) + r.z * 97.0);

  // Four-point arms, for the few sparkles.
  float len = 0.021 * (0.55 + 0.45 * r.z);
  float aw = max(0.0003, 0.7 * px);
  vec2 ao = abs(o.xy);
  float ax = max(1.0 - ao.x / len, 0.0);
  float ay = max(1.0 - ao.y / len, 0.0);
  float arms = exp(-(ao.y * ao.y) / (aw * aw)) * ax * ax * ax + exp(-(ao.x * ao.x) / (aw * aw)) * ay * ay * ay;
  arms *= 1.5 * (0.0003 / aw + 0.35);

  vec3 tint = sc_neon(7.0);
  tint = mix(tint, sc_neon(1.0), 0.55 * smoothstep(0.72, 0.9, r.z));
  tint = mix(tint, sc_neon(4.0), 0.5 * (1.0 - smoothstep(0.08, 0.2, r.z)));

  float present = max(step(r.x, density), sparkle);
  // Fade the whole layer out where a cell is only a few pixels across (a small reflection target).
  float resolved = 1.0 - smoothstep(0.14, 0.28, px * n / 1.5708);
  return tint * (present * resolved * twinkle * (point + sparkle * arms));
}

// Height of ridge vertex k (an integer in 0..cols-1), periodic over cols: a slow swell per massif
// times a per-vertex factor, so peaks are jagged. The caller subtracts the range's sink, which puts
// the low stretches under the horizon. The +0.5 keeps the divisions away from whole numbers, so an inexact
// GPU divide cannot move a vertex to the wrong cell.
float sky_peak(float k, float cols, float massif, float seed) {
  float j = floor((k + 0.5) / massif);
  float g = (k - j * massif) / massif;
  float groups = cols / massif;
  float j1 = j + 1.0;
  j1 -= groups * floor((j1 + 0.5) / groups);
  float m = mix(sc_hash21(vec2(j, seed)), sc_hash21(vec2(j1, seed)), g * g * (3.0 - 2.0 * g));
  float r = sc_hash21(vec2(k, seed + 0.5));
  return (0.12 + 0.88 * m * m) * (0.5 + 0.5 * r);
}
${mountains.ranges.map(rangeFunction).join('')}
void main() {
  vec3 d = normalize(vDir);
  // Derivatives first, before anything branches on the direction (Agents.md, "Custom GLSL").
  vec3 ddx = dFdx(d);
  vec3 ddy = dFdy(d);
  float px = max(max(length(ddx), length(ddy)), 1e-6);
  float lenXZ = max(length(d.xz), 1e-4);
  float tanEl = d.y / lenXZ;
  vec2 gt = vec2(dFdx(tanEl), dFdy(tanEl));

  float hp = max(d.y, 0.0);
  vec2 sunXZ = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float cs = dot(d.xz, sunXZ) / lenXZ;
  float sunward = 0.5 + 0.5 * cs;
  float warm = sunward * sunward;
  vec3 fogCol = sc_fogColor(d);

  // ---- gradient: indigo overhead, through the mid colour, to a hot horizon that is hottest sunward.
  vec3 horizon = mix(uSkyHorizon * ${f(gradient.horizonAway)} + uSkyMid * 0.9, uSkyHorizon, warm);
  float kH = mix(${f(gradient.horizonRateAway)}, ${f(gradient.horizonRateSun)}, warm);
  vec3 col = uSkyTop + (uSkyMid - uSkyTop) * exp(-hp * ${f(gradient.midRate)}) + (horizon - uSkyMid) * exp(-hp * kH);

  // ---- the sun's frame: right, up, and the offset of this direction from the sun.
  vec3 sunRight = normalize(vec3(-uSunDir.z, 0.0, uSunDir.x) + vec3(1e-6, 0.0, 0.0));
  vec3 sunUp = cross(sunRight, uSunDir);
  vec3 off = d - uSunDir;
  float rd = length(off);
  float outside = max(rd - SKY_SUN_R, 0.0) / SKY_SUN_R;

  // ---- stars: two layers on a cube grid, plus a faint dense band.
  float starMask = smoothstep(0.02, 0.3, d.y) * smoothstep(1.15, 3.2, rd / SKY_SUN_R);
  if (starMask > 0.0) {
    float amount = clamp(uStars, 0.0, 2.5);
    float bandD = dot(d, vec3(${bandNormal})) / ${f(stars.bandWidth)};
    float band = exp(-bandD * bandD);
    vec3 q;
    float face = sky_face(d, q);
    vec2 w = atan(q.xy / q.z) * (4.0 / SC_PI);
    // Patchy density, so the fine layer clusters and thins instead of showing its grid.
    float clump = sky_noise3(d * 5.5 + 9.0);
    vec3 starCol = sky_starLayer(q, w, face, ${f(stars.fineCells)}, 1.0, px,
      min(${f(stars.fineDensity)} * amount * (0.25 + 1.5 * clump * clump + 1.2 * band), 0.6), 0.0, vec3(0.00045, 0.0012, 1.5));
    starCol += sky_starLayer(q, w, face, ${f(stars.brightCells)}, 3.0, px,
      min(${f(stars.brightDensity)} * amount, 0.96), ${f(stars.sparkleShare)} * min(amount, 1.5), vec3(0.0009, 0.0021, 5.0));
#if SKY_DETAIL > 0
    float bandGlow = band * (0.3 + 0.7 * sky_noise3(d * 7.0 + 3.0)) * (0.5 + clump);
#else
    float bandGlow = band * 0.6;
#endif
    float brightness = 0.35 + 0.65 * min(amount, 1.4);
    col += starMask * (starCol * brightness + mix(uSkyMid, sc_neon(2.0), 0.5) * bandGlow * 0.07 * amount);
  }

  // ---- thin cloud streaks low in the sky, drifting round the vertical axis.
  float streakMask = smoothstep(0.012, 0.07, d.y) * (1.0 - smoothstep(0.12, 0.34, d.y));
  if (streakMask > 0.0) {
    float drift = uLoop * SC_TAU * ${f(clouds.driftLaps)};
    vec2 rot = vec2(cos(drift), sin(drift));
    vec3 pc = vec3(d.x * rot.x - d.z * rot.y, d.y * ${f(clouds.stretch)}, d.x * rot.y + d.z * rot.x) * ${f(clouds.scale)};
#if SKY_DETAIL > 0
    float cloud = 0.62 * sky_noise3(pc) + 0.38 * sky_noise3(pc * 2.07 + 11.3);
#else
    float cloud = sky_noise3(pc);
#endif
    float streak = smoothstep(0.52, 0.8, cloud) * streakMask;
    col += mix(uSkyHorizon, uSunBottom * 0.22, 0.45) * mix(0.3, 1.0, warm) * streak * ${f(clouds.gain)};
  }

  // ---- the sun: halo, then the disc with its scrolling cut-outs, through which the sky shows.
  vec3 behind = col;
  col += mix(uSunBottom, uSunTop, 0.12) * (${f(sun.haloNear)} * exp(-outside * ${f(sun.haloNearRate)}) + ${f(sun.haloWide)} * exp(-outside * ${f(sun.haloWideRate)}));
  float disc = 1.0 - smoothstep(-0.75, 0.75, (rd - SKY_SUN_R) / px);
  float v = dot(off, sunUp) / SKY_SUN_R;                      // 1 at the top of the disc, -1 at the bottom
  float vHorizon = clamp(-uSunDir.y / SKY_SUN_R, -1.0, 0.1);  // where the horizon crosses the disc
  float depth = clamp((${f(sun.stripeStart)} - v) / (${f(sun.stripeStart)} - vHorizon), 0.0, 1.0);
  float stripeX = v / ${f(sun.stripePeriod)} + fract(uLoop * ${f(sun.stripeLaps)});
  float gap = sc_pulse(stripeX, ${f(sun.stripeDutyMax)} * sqrt(depth), px / (SKY_SUN_R * ${f(sun.stripePeriod)}));
  float gv = clamp((v - vHorizon) / (1.0 - vHorizon), 0.0, 1.0);
  vec3 sunCol = mix(uSunBottom * ${f(sun.bottomGain)}, uSunTop * ${f(sun.topGain)}, pow(gv, ${f(sun.gradientPower)}));
  col = mix(col, mix(sunCol, behind * 0.75, gap), disc);

  // ---- wireframe mountains, far range first.
  float az = atan(d.x, -d.z + 1e-9) / SC_TAU;
  if (tanEl > SKY_FOOT - 0.01 && tanEl < SKY_MOUNTAIN_TOP) {
    vec2 gaz = vec2(d.x * ddx.z - d.z * ddx.x, d.x * ddy.z - d.z * ddy.x) / (lenXZ * lenXZ * SC_TAU);
    float flank = smoothstep(-0.4, 0.85, cs);
    float notch = exp(-(1.0 - cs) / 0.014);
    vec3 fillNear = uAmbient * 0.25 + uSkyTop * 0.35;
    vec3 fillFar = mix(fillNear, fogCol, 0.4);
${mountains.ranges.map(rangeCall).join('\n')}
  }

  // ---- haze: the sky rises out of the fog colour in a thin band at the horizon, and is fog below it.
  col = mix(fogCol, col, exp(-${f(haze.depth)} / max(hp, 1e-5)));

  // ---- distant city lights: soft dots in a few rows along the horizon line.
  vec2 lg = vec2(az * SKY_LIGHT_COLS, (tanEl + 0.0015) / SKY_LIGHT_ROW_H);
  if (lg.y >= 0.0 && lg.y < SKY_LIGHT_ROWS) {
    vec2 lcell = floor(lg);
    vec2 lf = lg - lcell - 0.5;
    float lk = lcell.x - SKY_LIGHT_COLS * floor((lcell.x + 0.5) / SKY_LIGHT_COLS);
    vec3 l1 = sc_hash33(vec3(lk, lcell.y, 91.0));
    vec3 l2 = sc_hash33(vec3(lk, lcell.y, 92.0));
    float rowShare = 1.0 - 0.7 * lcell.y / SKY_LIGHT_ROWS;
    vec2 lo = (lf - (l2.xy - 0.5) * 0.5) * vec2(SC_TAU / SKY_LIGHT_COLS, SKY_LIGHT_ROW_H);
    float lrad = max(0.0006, 0.8 * px);
    vec2 lw = 1.0 - 4.0 * lf * lf;
    float spot = exp(-dot(lo, lo) / (lrad * lrad)) * lw.x * lw.x * lw.y * lw.y;
    float lb = l1.y * l1.y;
    lb = 0.3 + 2.4 * lb * lb;
    float lt = 0.72 + 0.28 * uMotion * sin(uTime * (1.5 + 4.0 * l1.z) + l1.z * 61.0);
    vec3 lightCol = mix(sc_neon(3.0), sc_neon(4.0), 0.5);
    lightCol = mix(lightCol, sc_neon(0.0), step(0.45, l2.z));
    lightCol = mix(lightCol, sc_neon(1.0), step(0.66, l2.z));
    lightCol = mix(lightCol, sc_neon(7.0), step(0.86, l2.z));
    float lres = smoothstep(1.2, 2.4, SKY_LIGHT_ROW_H / px);
    float lit = step(l1.x, ${f(lights.density)} * rowShare) * spot * lb * lt;
    col += lightCol * (uGlow * ${f(lights.gain)} * mix(0.06 * rowShare, lit, lres));
  }

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;
