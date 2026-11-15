// GLSL for the ground layer (plan T04). Every shader starts with SC_COMMON; the G_ defines below are
// generated from ./layout.ts, so the shader and the TypeScript classifier share one set of numbers.
//
// Conventions used throughout the ground fragment shader:
//  - `tile` is the fragment in tile coordinates (it may lie outside 0..TILE; every pattern is periodic).
//  - `fw` is the footprint of one pixel along world x and z, metres. Each pattern is filtered against
//    the footprint of the axis it varies along, because at street level a pixel is centimetres wide
//    and tens of metres long.
//  - Nothing branches on per-pixel data; masks are multiplied in.
//  - Lattice indices are wrapped with integer arithmetic, so every hash repeats exactly with the tile.
import { CELLS } from '../../contracts/constants';
import { SC_COMMON, SC_VERTEX } from '../../contracts/glsl';
import { GROUND, LAMP_PATTERN } from './layout';

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** Light levels on the shared scale of architecture.md section 5.2. The art pass may retune them. */
export const LIGHT = {
  /** Neon curb line, L2. */
  curb: 2.6,
  /** Lane dashes and edge lines, low L2. */
  paint: 1.5,
  /** Double centre line on streets, L2. */
  centre: 1.9,
  /** The tube of light down an avenue median, and the edges of the median, L2. */
  tube: 2.8,
  medianEdge: 1.3,
  /** Zebra crossings are wide, so they stay in L1. */
  zebra: 0.62,
  /** Stop bars, L2. */
  stop: 2.1,
  /** Plaza grid and rings, L2. */
  plazaGrid: 2,
  plazaRing: 2.6,
  /** Far-field sparkle, L2 points. */
  spark: 2.6,
  /** Lamp head, L3, and the glow sprite: halo, core, and the core once the sprite is a few pixels. */
  head: 7,
  halo: 0.55,
  core: 6,
  coreFar: 1.6,
  /** Peak of the pool of light under a lamp, as a fraction of the lamp colour: road, sidewalk, block floor. */
  poolRoad: 0.04,
  poolWalk: 0.2,
  poolFloor: 0.12,
  /** How slowly a line dims once it is thinner than a pixel: 0 conserves energy, 1 never dims. */
  keep: 0.3,
} as const;

const DEFINES = /* glsl */ `
#define G_CELLS_I ${CELLS}
#define G_CURB_R ${f(GROUND.curbRadius)}
#define G_STOP_GAP ${f(GROUND.stopGap)}
#define G_DASH_PERIOD ${f(GROUND.dashPeriod)}
#define G_DASH_DUTY ${f(GROUND.dashDuty)}
#define G_ZEBRA ${f(GROUND.zebraPeriod)}
#define G_SLAB ${f(GROUND.slab)}
#define G_FLOOR_GRID ${f(GROUND.floorGrid)}
#define G_PLAZA_GRID ${f(GROUND.plazaGrid)}
#define G_PLAZA_RING ${f(GROUND.plazaRing)}
#define G_LAMP_HEAD_IN ${f(GROUND.lampArm - GROUND.lampSetback)}
#define G_LAMP_H0 ${f(GROUND.lampModelHeight)}
#define G_LAMP_SPLIT ${f(GROUND.lampSplit)}
#define G_POOL_SIGMA ${f(GROUND.poolSigma)}
#define G_LAMP_COL_EVEN ${f(GROUND.lampColorEven)}
#define G_LAMP_COL_ODD ${f(GROUND.lampColorOdd)}
#define G_PATTERN ${f(LAMP_PATTERN)}
#define G_SPRITE ${f(GROUND.spriteSize)}
#define G_SPRITE_MINPX ${f(GROUND.spriteMinPixels)}
#define G_POST_MINPX ${f(GROUND.postMinPixels)}
#define G_KEEP ${f(LIGHT.keep)}
`;

export const GROUND_VERT = SC_COMMON + SC_VERTEX + /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = sc_project(position);
}
`;

export const GROUND_FRAG = SC_COMMON + DEFINES + /* glsl */ `
uniform float uLampSp;
varying vec3 vP;

// Signed distance to a box of half-size h with corner radius r; negative inside.
float g_rbox(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// Share of a footprint fw centred on x that lies inside [a, b]: a box-filtered band.
float g_band(float x, float a, float b, float fw) {
  fw = max(fw, 1e-4);
  return clamp((min(b, x + 0.5 * fw) - max(a, x - 0.5 * fw)) / fw, 0.0, 1.0);
}
// sc_line, but a line thinner than a pixel dims more slowly than its coverage, so the street grid
// still reads from the air. It is as wide as a pixel by then, so this cannot alias.
float g_line(float d, float w, float fw) {
  return sc_line(d, w, fw) * pow(max(fw, w) / w, G_KEEP);
}
// Lines of half-width w every period metres along c, fading to their average under two pixels.
float g_grid(float c, float period, float w, float fw) {
  float d = (fract(c / period + 0.5) - 0.5) * period;
  return mix(2.0 * w / period, sc_line(d, w, fw), sc_detail(period, fw));
}
// Value noise 0..1 that repeats every period lattice cells. Choose the frequency so that
// TILE * frequency == period, and the pattern wraps with the tile.
float g_noise(vec2 p, int period) {
  vec2 i = floor(p), u = p - i;
  u = u * u * (3.0 - 2.0 * u);
  ivec2 a = (ivec2(i) + period * 16384) % period;
  ivec2 b = (a + 1) % period;
  return mix(mix(sc_hash21(vec2(a)), sc_hash21(vec2(b.x, a.y)), u.x),
             mix(sc_hash21(vec2(a.x, b.y)), sc_hash21(vec2(b)), u.x), u.y);
}
// Cell data for an unwrapped cell index (see sc_cellData).
vec4 g_cellData(vec2 cell) {
  ivec2 c = (ivec2(cell) + G_CELLS_I * 1024) % G_CELLS_I;
  return texelFetch(uCellTex, c, 0) * 255.0;
}
float g_isPlaza(vec4 d) { return 1.0 - step(0.5, abs(d.r - 3.0)); }
vec3 g_lampColor(float line) { return mix(sc_neon(G_LAMP_COL_EVEN), sc_neon(G_LAMP_COL_ODD), mod(line, 2.0)); }

// Everything painted on one road, as emission before uGlow.
//  lat, fl      signed offset from the centre line, and the pixel footprint across the road
//  along, fa    tile coordinate along the road, and the footprint along it
//  line, av     index of the road's grid line, and 1 if it is an avenue
//  crossD       signed distance along the road to the nearest crossing line; crossAv: 1 if that is an avenue
//  flip         +1 for a road along z, -1 for a road along x (which side drives towards the crossing)
vec3 g_marks(float lat, float fl, float along, float fa, float line, float av, float crossD, float crossAv, float flip) {
  float a = abs(lat);
  float rh = sc_roadHalf(av);
  float cK = sc_corridorHalf(crossAv), cR = sc_roadHalf(crossAv);
  float ad = abs(crossD);
  // 1 outside the junction, beyond the stop line.
  float open = 1.0 - g_band(ad, -1.0e4, cK + G_STOP_GAP, fa);

  // Lane dividers sit between the lanes of constants.ts: 4 m on a street, 6 and 10 m on an avenue.
  float divider = g_line(a - mix(4.0, 6.0, av), 0.07, fl) + av * g_line(a - 10.0, 0.07, fl);
  float dash = sc_pulse(along / G_DASH_PERIOD + 0.5 * G_DASH_DUTY, G_DASH_DUTY, fa / G_DASH_PERIOD);
  float edge = g_line(a - (rh - 0.55), 0.06, fl);
  vec3 ice = sc_neon(7.0);
  vec3 e = ice * ((divider * dash + 0.55 * edge) * open * ${f(LIGHT.paint)});

  // Centre: a double line on a street; on an avenue a median with lit edges and a tube of light.
  float dbl = g_line(a - 0.24, 0.06, fl);
  float medEdge = g_line(a - SC_AVENUE_MEDIAN, 0.08, fl);
  float tube = g_line(lat, 0.17, fl);
  float flow = sc_pulse(along / 20.0 - uTime * 0.5, 0.5, fa / 20.0);
  float tubeLevel = (0.6 + 0.4 * mix(0.5, flow, uMotion)) * (1.0 + 0.35 * uBeat.x * uMotion);
  vec3 tubeCol = mix(sc_neon(1.0), sc_neon(0.0), mod(floor(line / SC_AVENUE_EVERY + 0.5), 2.0));
  vec3 street = sc_neon(4.0) * (dbl * ${f(LIGHT.centre)});
  vec3 avenue = sc_neon(2.0) * (medEdge * ${f(LIGHT.medianEdge)}) + tubeCol * (tube * tubeLevel * ${f(LIGHT.tube)});
  e += mix(street, avenue, av) * open;

  // Zebra crossing over the carriageway, in the band of the cross road's sidewalk.
  float across = g_band(a, av * (SC_AVENUE_MEDIAN + 0.5), rh - 0.6, fl);
  float stripes = sc_pulse(lat / G_ZEBRA + 0.25, 0.5, fl / G_ZEBRA);
  e += ice * (g_band(ad, cR + 0.8, cK - 0.5, fa) * stripes * across * ${f(LIGHT.zebra)});

  // Stop bar across the lanes that drive towards the crossing (traffic keeps right).
  float approach = step(0.0, lat * crossD * flip);
  float bar = g_band(ad, cK + 0.7, cK + 1.25, fa) * g_band(a, mix(0.5, SC_AVENUE_MEDIAN + 0.5, av), rh - 0.6, fl) * approach;
  e += sc_neon(6.0) * (bar * ${f(LIGHT.stop)});
  return e;
}

// Light on the ground from the two rows of lamps along one road; arguments as in g_marks.
float g_pool(float lat, float fl, float along, float fa, float av) {
  float dl = abs(lat) - (sc_roadHalf(av) - G_LAMP_HEAD_IN);
  float da = (fract(along / uLampSp) - 0.5) * uLampSp;
  float s = G_POOL_SIGMA;
  // A gaussian convolved with the pixel footprint is a wider, dimmer gaussian.
  float sl = sqrt(s * s + 0.25 * fl * fl), sa = sqrt(s * s + 0.25 * fa * fa);
  float lateral = (s / sl) * exp(-dl * dl / (2.0 * sl * sl));
  float beside = (s / sa) * exp(-da * da / (2.0 * sa * sa));
  float average = s * 2.5066 / uLampSp;
  return lateral * mix(average, beside, sc_detail(uLampSp, fa));
}

// One octave of far-field lights: at most one per s-metre cell, drawn as a pixel-sized gaussian.
// level is the integer octave (hashed, so octaves differ); s must divide the tile. x: intensity, y: a hash.
vec2 g_dots(vec2 p, float s, float level, vec2 fw) {
  vec2 c = floor(p / s);
  int n = int(SC_TILE / s + 0.5);
  ivec2 ci = (ivec2(c) + n * 64) % n;
  vec3 h = sc_hash33(vec3(vec2(ci), level + 8.0));
  vec2 centre = (c + 0.3 + 0.4 * h.xy) * s;
  vec2 d = (p - centre) / fw;
  return vec2(step(0.7, h.z) * exp(-0.9 * dot(d, d)), fract(h.z * 61.0));
}

void main() {
  vec2 tile = uCam.xz + vP.xz;
  vec2 fw = max(fwidth(vP.xz), vec2(1e-4));
  float fmax = max(fw.x, fw.y);
  float viewDist = max(length(vec3(vP.x, cameraPosition.y, vP.z)), 1e-3);
  float cosT = clamp(abs(cameraPosition.y) / viewDist, 0.0, 1.0);

  // ---- the cell that owns this fragment, and its curb and building lines
  vec2 cellF = floor(tile / SC_CELL);
  vec2 u = tile - cellF * SC_CELL;
  vec2 avLo = vec2(sc_isAvenue(cellF.x), sc_isAvenue(cellF.y));
  vec2 avHi = vec2(sc_isAvenue(cellF.x + 1.0), sc_isAvenue(cellF.y + 1.0));
  vec2 rLo = mix(vec2(SC_STREET_ROAD), vec2(SC_AVENUE_ROAD), avLo);
  vec2 rHi = mix(vec2(SC_STREET_ROAD), vec2(SC_AVENUE_ROAD), avHi);
  vec2 kLo = mix(vec2(SC_STREET_CORRIDOR), vec2(SC_AVENUE_CORRIDOR), avLo);
  vec2 kHi = mix(vec2(SC_STREET_CORRIDOR), vec2(SC_AVENUE_CORRIDOR), avHi);
  vec2 blockCentre = 0.5 * (kLo + SC_CELL - kHi);
  float sdCurb = g_rbox(u - 0.5 * (rLo + SC_CELL - rHi), 0.5 * (SC_CELL - rHi - rLo), G_CURB_R);
  float sdBlock = g_rbox(u - blockCentre, 0.5 * (SC_CELL - kHi - kLo), 0.0);
  float fwCurb = max(fwidth(sdCurb), 1e-4);
  float fwBlock = max(fwidth(sdBlock), 1e-4);
  float road = clamp(sdCurb / fwCurb + 0.5, 0.0, 1.0);
  float inBlock = clamp(0.5 - sdBlock / fwBlock, 0.0, 1.0);
  float walk = clamp(1.0 - road - inBlock, 0.0, 1.0);

  // ---- cell data, box-filtered: exact near the camera, blended once a cell nears a pixel
  vec2 g = tile / SC_CELL - 0.5;
  vec2 gi = floor(g);
  vec2 kf = clamp(fw / SC_CELL, vec2(0.004), vec2(0.5));
  vec2 w = smoothstep(vec2(0.5) - kf, vec2(0.5) + kf, g - gi);
  vec4 d00 = g_cellData(gi), d10 = g_cellData(gi + vec2(1.0, 0.0));
  vec4 d01 = g_cellData(gi + vec2(0.0, 1.0)), d11 = g_cellData(gi + vec2(1.0, 1.0));
  vec3 cellCol = mix(mix(sc_neon(d00.g), sc_neon(d10.g), w.x), mix(sc_neon(d01.g), sc_neon(d11.g), w.x), w.y);
  float plaza = mix(mix(g_isPlaza(d00), g_isPlaza(d10), w.x), mix(g_isPlaza(d01), g_isPlaza(d11), w.x), w.y);
  float tall = mix(mix(d00.b, d10.b, w.x), mix(d01.b, d11.b, w.x), w.y) / 255.0;
  vec3 avgCol = (sc_neon(0.0) + sc_neon(1.0) + sc_neon(2.0)) / 3.0;
  cellCol = mix(avgCol, cellCol, sc_detail(SC_CELL * 2.0, fmax));

  // ---- the nearest road on each axis
  vec2 lineF = floor(tile / SC_CELL + 0.5);
  vec2 ld = tile - lineF * SC_CELL;
  vec2 lav = vec2(sc_isAvenue(lineF.x), sc_isAvenue(lineF.y));
  vec3 marks = g_marks(ld.x, fw.x, tile.y, fw.y, lineF.x, lav.x, ld.y, lav.y, 1.0)
             + g_marks(ld.y, fw.y, tile.x, fw.x, lineF.y, lav.y, ld.x, lav.x, -1.0);
  vec3 pool = g_lampColor(lineF.x) * g_pool(ld.x, fw.x, tile.y, fw.y, lav.x)
            + g_lampColor(lineF.y) * g_pool(ld.y, fw.y, tile.x, fw.x, lav.y);

  // ---- surface noise: damp patches, puddles, grain
  float dBig = sc_detail(40.0, fmax), dMid = sc_detail(8.0, fmax), dFine = sc_detail(2.0, fmax);
  float nBig = g_noise(tile * 0.025, 160);
  float nMid = g_noise(tile * 0.125 + 7.0, 800);
  float nFine = g_noise(tile * 0.5 + 3.0, 3200);
  float damp = 0.5 + (nBig - 0.5) * 0.9 * dBig + (nMid - 0.5) * 0.7 * dMid + (nFine - 0.5) * 0.3 * dFine;
  float gutter = exp(-max(sdCurb, 0.0) / 1.3);
  float puddle = smoothstep(0.585, 0.665, damp + 0.09 * gutter) * road * dMid;
  float grain = (g_noise(tile * 5.0, 32000) - 0.5) * sc_detail(0.2, fmax);

  vec3 asphalt = (vec3(0.0075, 0.0068, 0.0185) + uAmbient * 0.3) * (0.82 + 0.7 * (damp - 0.5) + 0.5 * grain);
  asphalt *= 1.0 - 0.5 * puddle;

  // ---- sidewalk: slabs with dark joints
  vec2 sj = (fract(tile / G_SLAB + 0.5) - 0.5) * G_SLAB;
  float joint = max(sc_line(sj.x, 0.03, fw.x) * sc_detail(G_SLAB, fw.x), sc_line(sj.y, 0.03, fw.y) * sc_detail(G_SLAB, fw.y));
  ivec2 slab = (ivec2(floor(tile / G_SLAB)) + 3200 * 1024) % 3200;
  float slabTone = (sc_hash21(vec2(slab)) - 0.5) * sc_detail(G_SLAB * 1.5, fmax);
  vec3 walkCol = (vec3(0.021, 0.017, 0.043) + uAmbient * 0.5) * (1.0 + 0.4 * slabTone + 0.25 * grain) * (1.0 - 0.6 * joint);

  // ---- block floor: a faint grid in the cell colour, seen between buildings
  vec2 bl = u - blockCentre;
  float floorGrid = max(g_grid(bl.x, G_FLOOR_GRID, 0.05, fw.x), g_grid(bl.y, G_FLOOR_GRID, 0.05, fw.y));
  vec3 floorCol = vec3(0.011, 0.0085, 0.027) + uAmbient * 0.4 + cellCol * (0.008 + 0.16 * floorGrid);

  // ---- plaza: polished floor, a bright grid, rings that pulse outwards on the beat
  float pr = length(bl);
  float fr = max(dot(abs(bl), fw) / max(pr, 1e-3), 1e-4);
  float plazaGrid = max(g_grid(bl.x, G_PLAZA_GRID, 0.08, fw.x), g_grid(bl.y, G_PLAZA_GRID, 0.08, fw.y));
  float ringZone = smoothstep(6.0, 8.0, pr) * (1.0 - smoothstep(50.0, 54.0, pr));
  float rings = g_grid(pr, G_PLAZA_RING, 0.14, fr) * ringZone;
  float beatT = fract(uBeat.y * 4.0);
  float wave = exp(-abs(pr - beatT * 62.0) / 7.0) * (1.0 - 0.7 * beatT) * uMotion;
  float hub = 1.0 - smoothstep(4.0 - fr, 4.0 + fr, pr);
  // The rings rest in the cell colour and flash towards white as the wave of each beat passes.
  vec3 ringCol = mix(cellCol, sc_neon(7.0), clamp(0.18 + 0.8 * wave, 0.0, 1.0));
  vec3 plazaGlow = cellCol * (plazaGrid * (1.0 - 0.6 * ringZone) * (1.0 + 0.9 * wave) * ${f(LIGHT.plazaGrid)})
                 + ringCol * (rings * (0.42 + 1.0 * wave) * ${f(LIGHT.plazaRing)})
                 + ringCol * (hub * (0.3 + 0.5 * uBeat.x * uMotion));
  vec3 plazaCol = vec3(0.007, 0.0055, 0.019) + uAmbient * 0.3 + cellCol * 0.006;

  // ---- beyond the far fade the buildings have sunk: scatter small lights so the plain still reads as city
  float farField = 1.0 - sc_farFade(vP.xz);
  float sLod = clamp(log2(fmax * 6.0 / 25.0), -3.0, 6.0);
  float sLevel = floor(sLod);
  float s0 = floor(25.0 * exp2(sLevel) * 8.0 + 0.5) / 8.0;
  vec2 dotA = g_dots(tile, s0, sLevel, fw);
  vec2 dotB = g_dots(tile, s0 * 2.0, sLevel + 1.0, fw);
  vec3 warm = vec3(1.0, 0.7, 0.4);
  vec3 spark = mix(mix(warm, cellCol, step(0.6, dotA.y)) * dotA.x * (0.7 + 0.3 * sin(uTime * 1.7 + dotA.y * 60.0)),
                   mix(warm, cellCol, step(0.6, dotB.y)) * dotB.x * (0.7 + 0.3 * sin(uTime * 1.7 + dotB.y * 60.0)), sLod - sLevel);
  spark *= farField * inBlock * (1.0 - plaza) * (1.0 - smoothstep(120.0, 260.0, fmax)) * ${f(LIGHT.spark)};

  // ---- wet reflection
  // Surface weights: asphalt, puddle, sidewalk, block floor, plaza.
  float wA = road - puddle, wP = puddle, wW = walk, wB = inBlock * (1.0 - plaza), wZ = inBlock * plaza;
  float gloss = wA * (0.5 + 0.5 * (damp - 0.5)) + wP * 0.95 + wW * 0.24 + wB * 0.16 + wZ * 0.75;
  float fres = pow(1.0 - cosT, 4.0);
  float mirror = mix(0.07, 1.0, fres) * gloss * uWet;
#ifdef G_REFLECT
  float spread = wA * 0.075 + wP * 0.006 + wW * 0.075 + wB * 0.085 + wZ * 0.012;
  float rippleAmp = wA * 0.026 + wP * 0.004 + wW * 0.012 + wB * 0.012 + wZ * 0.003;
#endif

  // Without a reflection pass: the sky the mirror would show, dimmed where towers would block it, a
  // glint towards the sun, and the neon of the block beside the road smeared into streaks. Vertical
  // lights reflect as streaks that point at the viewer, so the streaks are noise over the bearing.
  vec3 rdir = vec3(vP.x, abs(cameraPosition.y), vP.z) / viewDist;
  vec3 skyR = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.3, rdir.y));
  skyR = mix(skyR, uSkyTop, smoothstep(0.3, 0.9, rdir.y));
  vec2 rh = rdir.xz / max(length(rdir.xz), 1e-4);
  vec2 sh = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float sunEl = (rdir.y - uSunDir.y) / 0.1;
  float glint = pow(max(dot(rh, sh), 0.0), 900.0) * exp(-sunEl * sunEl);
  float canyon = clamp(tall * 4.0, 0.0, 1.0);
  float bearing = atan(vP.x, abs(vP.z) < 1e-4 ? 1e-4 : vP.z) / SC_TAU;
  float streakA = g_noise(vec2(bearing * 512.0, 0.5), 512);
  float streakB = g_noise(vec2(bearing * 128.0 + 31.0, 7.5), 128);
  float beside = exp(-max(sdCurb, 0.0) / 6.0);
  vec3 neonR = mix(cellCol, mix(sc_neon(0.0), sc_neon(1.0), streakB), 0.4);
  vec3 refl = skyR * mix(0.45, 0.07, canyon) + uSunBottom * (glint * 0.4)
            + neonR * ((0.03 + 0.5 * canyon) * (0.25 + 0.75 * beside) * (0.3 + 1.4 * streakA * streakA));

#ifdef G_REFLECT
  // Where this fragment lands in the mirrored image, and which way "up the reflected wall" runs there.
  vec4 rp = uReflMatrix * vec4(vP.x, 0.0, vP.z, 1.0);
  vec4 rq = uReflMatrix * vec4(vP.x, 0.04 * viewDist, vP.z, 1.0);
  vec2 ruv = rp.xy / rp.w;
  vec2 rup = rq.xy / rq.w - ruv;
  rup /= max(length(rup), 1e-5);
  // Ripples tilt the film of water: the image slides along the streak direction, a little sideways.
  float ripA = (g_noise(tile * 1.25 + uTime * vec2(0.11, 0.07), 8000) - 0.5) * sc_detail(0.8, fmax);
  float ripB = (g_noise(tile * 0.25 + uTime * vec2(-0.03, 0.02), 1600) - 0.5) * sc_detail(4.0, fmax);
  vec2 slide = rup * ((0.8 * ripA + 0.55 * ripB) * rippleAmp) + vec2(-rup.y, rup.x) * ((ripA - 0.4 * ripB) * rippleAmp * 0.22);
  // Roughness: five taps along the streak, at a mip level that makes them overlap.
  float lod = log2(max(spread * float(textureSize(uReflTex, 0).y) * 0.55, 1.0));
  vec2 c0 = ruv + slide;
  vec3 mirrored = textureLod(uReflTex, c0, lod).rgb * 0.3
                + (textureLod(uReflTex, c0 + rup * spread * 0.5, lod).rgb + textureLod(uReflTex, c0 - rup * spread * 0.5, lod).rgb) * 0.22
                + (textureLod(uReflTex, c0 + rup * spread, lod).rgb + textureLod(uReflTex, c0 - rup * spread, lod).rgb) * 0.13;
  refl = mix(refl, mirrored, uReflAmount);
#endif

  // ---- compose
  vec3 base = asphalt * road + walkCol * walk + mix(floorCol, plazaCol, plaza) * inBlock;
  base *= mix(1.5, 1.0, uWet);
  // The curb line spills a little of its colour onto the wet ground on both sides.
  float spillLen = max(2.4, fwCurb);
  float spill = exp(-abs(sdCurb) / spillLen) * (2.4 / spillLen);
  vec3 lit = pool * (road * ${f(LIGHT.poolRoad)} + walk * ${f(LIGHT.poolWalk)} + inBlock * ${f(LIGHT.poolFloor)}) + cellCol * (spill * 0.06);
  float curb = g_line(sdCurb + 0.14, 0.14, fwCurb);
  vec3 glow = cellCol * (curb * ${f(LIGHT.curb)}) + marks + plazaGlow * (plaza * inBlock) + spark;
  vec3 col = base + lit + refl * mirror + glow * uGlow;
  gl_FragColor = vec4(sc_fog(col, vP), 1.0);
}
`;

export const POST_VERT = SC_COMMON + SC_VERTEX + DEFINES + /* glsl */ `
// Base of the pole in lamp-pattern coordinates (plus the lattice offset), and the unit direction to the road.
attribute vec4 aLamp;
// Head height, palette index.
attribute vec2 aInfo;
attribute float aPart;
// The point on the centre line of the pole that this vertex surrounds.
attribute vec3 aAxis;
uniform vec2 uPostFade;
varying vec3 vP;
varying float vPart;
varying float vUp;
flat varying float vCol;
void main() {
  // The layout repeats every G_PATTERN metres, so a small lattice of posts that follows the camera in
  // whole pattern steps is indistinguishable from a post at every lamp; the fade hides its edge.
  vec2 snap = floor(uCam.xz / G_PATTERN + 0.5) * G_PATTERN;
  vec3 anchor = vec3(snap.x + aLamp.x, 0.0, snap.y + aLamp.y);
  vec2 rel = sc_wrap(anchor.xz);
  float shown = 1.0 - smoothstep(uPostFade.x, uPostFade.y, length(rel));
  // The mesh is modelled at one height; everything above the split rides up to this lamp's height.
  vec3 lift = vec3(0.0, (aInfo.x - G_LAMP_H0) * step(G_LAMP_SPLIT, aAxis.y), 0.0);
  vec3 axis = aAxis + lift;
  vec3 radial = position - aAxis;
  // Keep the pole at least G_POST_MINPX pixels thick: a thinner one breaks up into crawling dots.
  float metresPerPixel = 2.0 * length(vec3(rel.x, cameraPosition.y - axis.y, rel.y)) / (uResolution.y * projectionMatrix[1][1]);
  float thicken = max(1.0, 0.5 * G_POST_MINPX * metresPerPixel / max(length(radial), 1e-4));
  vec3 l = axis + radial * thicken;
  vUp = l.y / aInfo.x;
  l = vec3(l.x * aLamp.z - l.z * aLamp.w, l.y, l.x * aLamp.w + l.z * aLamp.z) * shown;
  vec3 p = sc_place(anchor, l);
  vP = p;
  vPart = aPart;
  vCol = aInfo.y;
  gl_Position = sc_project(p);
}
`;

export const POST_FRAG = SC_COMMON + /* glsl */ `
varying vec3 vP;
varying float vPart;
varying float vUp;
flat varying float vCol;
void main() {
  vec3 lamp = sc_neon(vCol);
  // The pole is unlit metal that catches a little of its own lamp near the top.
  vec3 pole = vec3(0.016, 0.013, 0.034) + uAmbient * 0.4 + lamp * (0.1 * smoothstep(0.55, 1.0, vUp));
  vec3 head = mix(lamp, sc_neon(7.0), 0.5) * (${f(LIGHT.head)} * uGlow);
  gl_FragColor = vec4(sc_fog(mix(pole, head, step(0.5, vPart)), vP), 1.0);
}
`;

export const SPRITE_VERT = SC_COMMON + SC_VERTEX + DEFINES + /* glsl */ `
// Lamp head: tile x, height, tile z.
attribute vec3 aHead;
attribute float aCol;
varying vec2 vUv;
flat varying float vCol;
flat varying float vGain;
flat varying float vFar;
void main() {
  vec3 centre = sc_place(aHead, vec3(0.0));
  float k = sc_farFade(sc_wrap(aHead.xz));
  float size = sc_minSize(centre, G_SPRITE, G_SPRITE_MINPX);
  float ratio = G_SPRITE / size;
  // Held at a few pixels, a distant glow dims, but more slowly than its true size would have it.
  vGain = k * pow(ratio, 1.35) * (1.0 - sc_fogAmount(centre));
  vFar = 1.0 - ratio;
  vCol = aCol;
  vUv = position.xy;
  gl_Position = sc_project(sc_sprite(centre, position.xy, size * step(0.001, k)));
}
`;

export const SPRITE_FRAG = SC_COMMON + /* glsl */ `
varying vec2 vUv;
flat varying float vCol;
flat varying float vGain;
flat varying float vFar;
void main() {
  float r2 = dot(vUv, vUv);
  // A sprite held at its minimum size gets a broader profile, so a pixel grid can sample it without twinkling.
  float halo = exp(-r2 * mix(5.5, 2.3, vFar)) * (1.0 - smoothstep(0.55, 1.0, sqrt(r2)));
  float core = exp(-r2 * 110.0);
  vec3 lamp = sc_neon(vCol);
  // Up close: a soft halo round a small hot core. Far away the core would be under a pixel, so its
  // light is spread over the halo instead.
  vec3 col = lamp * (halo * ${f(LIGHT.halo)})
           + mix(lamp, sc_neon(7.0), 0.6) * mix(core * ${f(LIGHT.core)}, halo * ${f(LIGHT.coreFar)}, vFar);
  gl_FragColor = vec4(col * (vGain * uGlow), 1.0);
}
`;
