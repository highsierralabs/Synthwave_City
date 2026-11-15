// GLSL for the beams layer (plan T08): one ribbon shader for searchlights, pillars and lasers, and
// one sprite shader for the flare at each emitter. Both are additive.
//
// Light levels (architecture.md section 5.2): a ribbon is a large, see-through area and additive
// light stacks, so the body of a beam stays near L1 and only its thin core and the flares reach L2
// and L3. Fog only dims additive light (colour * (1 - fog amount)); adding the fog colour as sc_fog
// does would paint the whole quad, because the background already carries its own fog.
import { SC_COMMON, SC_VERTEX } from '../../contracts/glsl';
import { BEAM_KIND } from './pack';

/** Ribbon half-width of a pillar in units of its radius: the core plus a soft halo. */
export const PILLAR_HALO = 8;
/** Ribbon half-width of a laser in units of its radius. */
export const LASER_GLOW = 4;

const KINDS = /* glsl */ `
#define BM_SEARCHLIGHT ${BEAM_KIND.searchlight}.0
#define BM_PILLAR ${BEAM_KIND.pillar}.0
#define BM_LASER ${BEAM_KIND.laser}.0
#define BM_PILLAR_HALO ${PILLAR_HALO}.0
#define BM_LASER_GLOW ${LASER_GLOW}.0
`;

// Per-instance attributes (see BeamSet in ./pack.ts) and the direction of a beam. Mirrored on the
// CPU by beamDirection in ./pack.ts. Every rate is a whole number of cycles per loop, so the
// motion wraps seamlessly when uLoop does (architecture.md section 4.3).
const BEAM_DIR = /* glsl */ `
attribute vec3 aOrigin;
attribute vec4 aShape;
attribute vec4 aLook;
attribute vec4 aTilt;
attribute vec4 aAzim;
attribute vec4 aFan;
attribute vec4 aRoll;

float bm_wave(float cyclesPerLoop, float phase) {
  return sin(SC_TAU * fract(cyclesPerLoop * uLoop) + phase);
}
vec3 bm_dir() {
  float th = aTilt.x + aTilt.y * bm_wave(aTilt.z, aTilt.w);
  float ph = aAzim.x + SC_TAU * fract(aAzim.y * uLoop) + aAzim.z * bm_wave(aAzim.w, aRoll.z);
  float st = sin(th), ct = cos(th), sp = sin(ph), cp = cos(ph);
  vec3 c = vec3(st * cp, ct, st * sp);
  // Two unit vectors across c; neither degenerates when c is vertical.
  vec3 e1 = vec3(-sp, 0.0, cp);
  vec3 e2 = vec3(ct * cp, -st, ct * sp);
  float a = aLook.w * (aFan.x + aFan.y * bm_wave(aFan.z, aFan.w));
  float ro = aRoll.x + SC_TAU * fract(aRoll.y * uLoop);
  vec3 u = cos(ro) * e1 + sin(ro) * e2;
  return cos(a) * c + sin(a) * u;
}
`;

export const BEAM_VERT = SC_COMMON + SC_VERTEX + KINDS + BEAM_DIR + /* glsl */ `
// position.x: -1..1 across the ribbon. position.y: 0..1 along it.
varying vec3 vP;
varying vec4 vCoord;     // x across, y along, z thin-line compensation, w view gain
flat varying vec4 vShape;
flat varying vec4 vLook;

void main() {
  float kind = aShape.w;
  float t = position.y;
  vec3 dir = bm_dir();
  // The anchor is the emitter, so the whole beam wraps and sinks as one object.
  vec3 p0 = sc_place(aOrigin, vec3(0.0));
  vec3 p1 = sc_place(aOrigin, dir * aShape.x);
  vec3 d = p1 - p0;
  float dl = length(d);
  vec3 axis = dl > 1e-3 ? d / dl : vec3(0.0, 1.0, 0.0);
  vec3 pt = mix(p0, p1, t);

  float r = mix(aShape.y, aShape.z, t);
  float w = r * (kind == BM_PILLAR ? BM_PILLAR_HALO : kind == BM_LASER ? BM_LASER_GLOW : 1.0);
  // Never thinner than a pixel or so: widen the ribbon and dim it by the same factor instead.
  float wPix = sc_minSize(pt, w, kind == BM_LASER ? 1.3 : 1.25);
  vec3 p = sc_axisBillboard(pt, axis, position.x, wPix);

  // Seen nearly end-on the ribbon degenerates, so it fades there and the flare takes over. A
  // little before that, the longer path through the beam makes it brighter.
  vec3 toCam = normalize(vec3(0.0, cameraPosition.y, 0.0) - pt);
  float sinA = length(cross(axis, toCam));
  float gain = sc_axisFacing(pt, axis) * (1.0 + 0.5 * (1.0 - smoothstep(0.3, 0.95, sinA)));

  vP = p;
  vCoord = vec4(position.x, t, w / wPix, gain);
  vShape = aShape;
  vLook = aLook;
  gl_Position = sc_project(p);
}
`;

export const BEAM_FRAG = SC_COMMON + KINDS + /* glsl */ `
varying vec3 vP;
varying vec4 vCoord;
flat varying vec4 vShape;
flat varying vec4 vLook;

// Rare bright motes drifting along the beam: a few cells of a grid in beam space hold a twinkling
// dot. They fade out before a dot gets smaller than a couple of pixels, where they would only be
// grain.
float bm_motes(float s, float x, float seed, float cell, float lanes, float speed, float rarity, float fs) {
  vec2 g = vec2(s / cell - uTime * speed, (x * 0.5 + 0.5) * lanes);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec3 h = sc_hash33(vec3(id, seed));
  vec2 c = (h.yz - 0.5) * 0.5;
  float on = step(rarity, h.x);
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + 9.0 * h.y) + h.z * SC_TAU);
  vec2 q = f - c;
  return on * exp(-dot(q, q) * 70.0) * tw * tw * sc_detail(cell * 0.2, fs);
}

void main() {
  float len = vShape.x;
  float kind = vShape.w;
  // With multisampling a varying is extrapolated to sample points outside its triangle, and on a
  // ribbon seen nearly end-on that can be far outside: clamp, or r below goes negative and pow
  // returns NaN, which bloom then smears into a black block.
  float x = clamp(vCoord.x, -1.0, 1.0);
  float t = clamp(vCoord.y, 0.0, 1.0);
  float s = t * len;
  // Derivatives first, before anything branches on per-pixel data.
  float fs = fwidth(s);

  float seed = floor(vLook.y * 4096.0);
  vec3 tint = sc_neon(vLook.x);
  float edge = max(1.0 - x * x, 0.0);
  float r = mix(vShape.y, vShape.z, t);
  vec3 col;

  if (kind == BM_PILLAR) {
    // A column: a hot thread down the middle, a core about a radius wide, a glow a few radii wide
    // and a faint halo; bands of brightness rising slowly, a pulse climbing it once a bar, and a
    // swell on every beat. The thread keeps it reading as a shaft when the viewer is close.
    float u = x * BM_PILLAR_HALO;
    float core = exp(-u * u * 0.4);
    float hot = exp(-u * u * 6.0);
    float mid = exp(-u * u * 0.06);
    float halo = edge * edge * edge;
    float along = exp(-1.3 * t) * (1.0 - smoothstep(0.5, 1.0, t)) * smoothstep(0.0, 0.004, t);
    float bands = 0.74 + 0.26 * sin(SC_TAU * (s / 230.0 - uTime * 0.105));
    bands *= 0.86 + 0.14 * sin(SC_TAU * (s / 61.0 - uTime * 0.41 + fract(seed * 0.618)));
    bands = mix(0.74, bands, sc_detail(61.0, fs));
    // The second coordinate also creeps along the beam, so the lattice of the noise never lines up
    // with it and the haze does not read as evenly spaced beads.
    float haze = sc_fbm(vec2(s / 90.0 - uTime * 0.9, s / 370.0 + u * 0.3 + seed));
    float rays = sc_noise(vec2(u * 1.2 + seed * 0.61, uTime * 0.45 + s * 0.002));
    float shimmer = (0.45 + 1.1 * haze) * (0.75 + 0.5 * rays);
    float dPulse = (t - uBeat.y) * 14.0;
    float pulse = exp(-dPulse * dPulse) * 0.6 * uMotion;
    float beat = 1.0 + 0.3 * uBeat.x * uMotion;
    float motes = bm_motes(s, x, seed, 14.0, 9.0, 1.6, 0.95, fs) * edge;
    float body = (1.5 * hot + 1.5 * core + 0.6 * mid * edge + 0.1 * halo) * bands * shimmer * beat;
    body += (core + 0.3 * mid * edge) * pulse + motes * 2.2;
    col = mix(tint, vec3(1.0), 0.2 * core + 0.3 * hot) * body * along;
  } else if (kind == BM_LASER) {
    // A hair line: a narrow gaussian across the ribbon, nearly constant along it, with a faint
    // sparkle running outwards.
    float core = exp(-x * x * 5.5) * edge;
    float along = mix(1.0, 0.5, t) * (1.0 - smoothstep(0.6, 1.0, t)) * smoothstep(0.0, 0.002, t);
    float run = s / 3.0 - uTime * 26.0;
    float spark = sc_noise(vec2(run, seed));
    spark = spark * spark * spark * spark * 4.0 * sc_detail(3.0, fs);
    float flick = 1.0 - 0.18 * uMotion * sc_noise(vec2(uTime * 6.0, seed));
    float body = core * (1.5 + 1.6 * spark) * flick;
    col = mix(tint, vec3(1.0), 0.25 * core) * body * along;
  } else {
    // A searchlight: the chord through a soft cone, plus a tighter core. It thins out as it
    // widens. Long rays waver across it and haze drifts up it, which is the shimmer.
    float body = edge * sqrt(edge);
    float core = exp(-x * x * 9.0);
    float along = pow(vShape.y / r, 0.6) * exp(-1.9 * t) * (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(0.0, 0.003, t);
    float rays = 0.6 * sc_noise(vec2(x * 3.0 + seed, uTime * 0.35 + s * 0.0025))
               + 0.4 * sc_noise(vec2(x * 7.0 - seed, uTime * 0.8 - s * 0.006));
    float puffs = sc_fbm(vec2(s / 70.0 - uTime * 0.6, s / 290.0 + x * 0.9 + seed * 0.37));
    float shimmer = (0.35 + 1.3 * rays) * (0.15 + 1.7 * puffs);
    float motes = bm_motes(s, x, seed, 10.0, 4.0, 1.0, 0.9, fs) * edge;
    float light = (0.9 * body + 0.9 * core) * shimmer + motes * 6.0;
    col = mix(tint, vec3(1.0), 0.35 * core) * light * along;
  }

  // Close to the camera a ribbon is no longer a fair stand-in for a volume (and it twists hard to
  // keep facing the viewer), so a beam fades out as the viewer flies into it.
  float dist = length(vP - vec3(0.0, cameraPosition.y, 0.0));
  float nearFade = smoothstep(1.5 * r, 6.0 * r + 15.0, dist);

  col *= vLook.z * clamp(vCoord.z, 0.0, 1.0) * clamp(vCoord.w, 0.0, 1.5) * nearFade * uGlow;
  col *= 1.0 - sc_fogAmount(vP);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const FLARE_VERT = SC_COMMON + SC_VERTEX + KINDS + BEAM_DIR + /* glsl */ `
// position.xy: the corner of a camera-facing sprite, -1..1.
varying vec2 vCorner;
varying vec3 vP;
flat varying vec4 vLook;     // palette index, seed, intensity, kind
flat varying vec2 vGain;     // x: brightness, y: glint (the beam is pointing at the viewer)

void main() {
  float kind = aShape.w;
  vec3 dir = bm_dir();
  vec2 rel = sc_wrap(aOrigin.xz);
  float alive = sc_farFade(rel);
  vec3 centre = sc_place(aOrigin, vec3(0.0));
  vec3 toCam = vec3(0.0, cameraPosition.y, 0.0) - centre;
  float dist = max(length(toCam), 1e-3);
  toCam /= dist;

  // How squarely the beam points at the viewer: a searchlight glints as it sweeps past.
  float glint = kind == BM_PILLAR ? 0.0 : pow(max(dot(dir, toCam), 0.0), kind == BM_LASER ? 220.0 : 28.0);

  float size = kind == BM_PILLAR ? aShape.y * 13.0 : kind == BM_LASER ? 3.5 : 7.0 + 14.0 * glint;
  float sizePix = sc_minSize(centre, size, kind == BM_PILLAR ? 6.0 : 3.0);
  // Lift the sprite towards the viewer so the roof it stands on does not slice it in half.
  centre += toCam * min(min(sizePix, 8.0), dist * 0.5);
  vec3 p = sc_sprite(centre, position.xy, sizePix * alive);

  float thin = size / sizePix;
  vCorner = position.xy;
  vP = p;
  vLook = vec4(aLook.x, aLook.y, aLook.z, kind);
  vGain = vec2(thin * thin * alive * aRoll.w, glint);
  gl_Position = sc_project(p);
}
`;

export const FLARE_FRAG = SC_COMMON + KINDS + /* glsl */ `
varying vec2 vCorner;
varying vec3 vP;
flat varying vec4 vLook;
flat varying vec2 vGain;

void main() {
  float kind = vLook.w;
  float seed = floor(vLook.y * 4096.0);
  vec3 tint = sc_neon(vLook.x);
  float d = length(vCorner);
  float rim = max(1.0 - d, 0.0);
  float glow = rim * rim * rim;
  // A thin horizontal streak, the anamorphic flare of the era. Never thinner than a pixel.
  float sw = max(0.033, fwidth(vCorner.y));
  float sy = vCorner.y / sw;
  float streak = exp(-sy * sy) * (0.033 / sw) * rim * rim;
  float flick = 1.0 - 0.2 * uMotion * sc_noise(vec2(uTime * 5.0, seed));
  vec3 col;
  if (kind == BM_PILLAR) {
    float core = exp(-d * d * 150.0);
    float beat = 1.0 + 0.35 * uBeat.x * uMotion;
    col = mix(tint, vec3(1.0), 0.5) * core * 7.0 + tint * (glow * 0.34 + streak * 0.5) * beat;
  } else if (kind == BM_LASER) {
    float core = exp(-d * d * 30.0);
    col = mix(tint, vec3(1.0), 0.4) * core * (4.0 + 20.0 * vGain.y) + tint * glow * 0.5;
  } else {
    float core = exp(-d * d * 45.0);
    col = mix(tint, vec3(1.0), 0.5) * core * (4.5 + 5.0 * vGain.y) + tint * (glow * 0.35 + streak * (0.3 + 1.5 * vGain.y));
  }
  col *= vLook.z * vGain.x * flick * uGlow;
  col *= 1.0 - sc_fogAmount(vP);
  gl_FragColor = vec4(col, 1.0);
}
`;
