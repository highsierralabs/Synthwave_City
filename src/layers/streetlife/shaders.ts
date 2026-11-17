// GLSL for street life (plan T06). Every shader starts with SC_COMMON.
//
// Car frame: x forward, y up, z to the driver's right. "Along" is the coordinate a lane runs in,
// "across" the one that is fixed. The lane arithmetic mirrors ./pack.ts line for line.
import { AVENUE, LOOP_SECONDS, STREET } from '../../contracts/constants';
import { SC_COMMON, SC_VERTEX } from '../../contracts/glsl';
import { BIKE_AXLES, BIKE_DIMS, BIKE_FLOOR, BUS_SCALE, CAR_AXLES, CAR_DIMS, CAR_FLOOR, VAN_AXLES, VAN_DIMS, VAN_FLOOR } from './mesh';
import {
  ALLEY_STAND_MARGIN, ALLEY_STANDING, ALLEY_TEXELS, ALLEY_WALK_MARGIN, BIKE_CHANCE, BLOCK_HASH_BASE, BUS_CHANCE,
  CROWD_BY_DISTRICT, CROWD_END_MARGIN, CROWD_MARGIN, EMERGENCY_CHANCE, JITTER_MAX, MIN_GAP, PLAZA_CROSS_CENTRE,
  PLAZA_CROSS_EDGE, PLAZA_RING_MAX, PLAZA_RING_MIN, PLAZA_RING_SHARE, PLAZA_STAND_SHARE, SKIP_CHANCE, STANDING_CHANCE,
  TAXI_CHANCE, VAN_CHANCE,
} from './pack';

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const v3 = (v: readonly [number, number, number]): string => `vec3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;

/** Height of the additive ground quads above the road, metres. Polygon offset does the rest. */
export const GROUND_LIFT = 0.04;
/** Length and half width of the headlight pool, metres. */
const POOL_LENGTH = 20;
const POOL_HALF = 2.9;
/** Quad that holds one pedestrian: half width and height, metres. */
export const WALKER_HALF = 0.58;
export const WALKER_TALL = 2.6;

// ---- lanes and cars: shared by the vertex shaders of the near cars and the fragment shader of the far dashes

const SL_COLORS = /* glsl */ `
// The blue half of an emergency strobe; the palette has no pure blue.
const vec3 SL_BLUE = vec3(0.03, 0.16, 1.0);
`;

const SL_LANES = SL_COLORS + /* glsl */ `
uniform highp sampler2D uLaneTex;
uniform vec2 uHandover;

// x mod y for whole numbers held in floats, safe where division is not correctly rounded.
float sl_imod(float x, float y) { return x - y * floor((x + 0.5) / y); }
// One lane: x signed offset from the road's centre line, y dir * laps, z car slots (0: no lane), w phase.
vec4 sl_lane(float line, float row) { return texelFetch(uLaneTex, ivec2(int(line + 0.5), int(row + 0.5)), 0); }
// A tile coordinate along the lane, in car slots measured from slot 0.
float sl_q(vec4 lane, float coord) { return (coord / SC_TILE - fract(lane.y * uLoop + lane.w)) * lane.z; }

struct SlCar {
  float offset;  // metres from the queried coordinate to the car's centre, along the lane's axis
  float show;    // 1 if the slot holds a vehicle
  float klass;   // 0 car, 1 van, 2 bus, 3 motorcycle
  float kind;    // 0 plain, 1 taxi, 2 emergency
  float idx;     // car index in its lane
  vec3 r1;       // x jitter, y presence, z tints
  vec3 r2;       // x class, y kind, z accent
};

// Car number idxF (any whole number; it wraps) of a lane. q is sl_q of the coordinate being asked about.
SlCar sl_car(vec4 lane, float laneId, float row, float q, float idxF) {
  SlCar c;
  float n = max(lane.z, 1.0);
  float spacing = SC_TILE / n;
  c.idx = sl_imod(idxF, n);
  c.r1 = sc_hash33(vec3(laneId, c.idx, 1.0));
  c.r2 = sc_hash33(vec3(laneId, c.idx, 2.0));
  float jitter = clamp(1.0 - ${f(MIN_GAP)} / spacing, 0.0, ${f(JITTER_MAX)});
  c.offset = (idxF - q + (c.r1.x - 0.5) * jitter) * spacing;
  c.show = step(0.5, lane.z) * step(${f(SKIP_CHANCE)}, c.r1.y);
  // Buses keep out of the fast inner lane.
  float inner = 1.0 - step(0.5, sl_imod(row, 3.0));
  c.klass = c.r2.x < ${f(BUS_CHANCE)} ? 2.0 - inner : c.r2.x < ${f(BUS_CHANCE + VAN_CHANCE)} ? 1.0
    : c.r2.x < ${f(BUS_CHANCE + VAN_CHANCE + BIKE_CHANCE)} ? 3.0 : 0.0;
  c.kind = c.r2.y < ${f(EMERGENCY_CHANCE)} ? 2.0 : (c.r2.y < ${f(EMERGENCY_CHANCE + TAXI_CHANCE)} ? 1.0 : 0.0);
  if (c.kind > 0.5) c.klass = 0.0;
  return c;
}

// Half length, height, half width, metres.
vec3 sl_dims(SlCar c) {
  if (c.klass > 2.5) return ${v3(BIKE_DIMS)};
  if (c.klass > 1.5) return ${v3(VAN_DIMS)} * ${v3(BUS_SCALE)};
  if (c.klass > 0.5) return ${v3(VAN_DIMS)};
  return vec3(${f(CAR_DIMS[0])} * (0.94 + 0.12 * fract(c.r1.z * 17.0)), ${f(CAR_DIMS[1])}, ${f(CAR_DIMS[2])});
}
// Headlights: ice white to gold.
vec3 sl_headColor(SlCar c) { return mix(sc_neon(7.0), sc_neon(4.0), 0.1 + 0.45 * fract(c.r1.z * 5.0)); }
// Tail lights: signal red, a few leaning magenta.
vec3 sl_tailColor(SlCar c) { return mix(sc_neon(6.0), sc_neon(0.0), 0.6 * step(0.78, fract(c.r1.z * 9.0))); }
vec3 sl_accent(SlCar c) {
  float a = c.r2.z;
  return sc_neon(a < 0.30 ? 0.0 : a < 0.58 ? 1.0 : a < 0.76 ? 2.0 : a < 0.88 ? 3.0 : a < 0.95 ? 5.0 : 4.0);
}
// Underglow strength: every car carries a little, a few are over-bright.
float sl_underglow(SlCar c) {
  float g = fract(c.r2.z * 13.0);
  float over = step(0.93, fract(c.r2.x * 29.0));
  return (0.3 + 0.9 * g * g) * (1.0 + 2.4 * over) * (c.klass > 0.5 && c.klass < 2.5 ? 0.55 : 1.0);
}
// How much of a lamp shows from where the camera is. facing: 1 looking straight into the lamp, -1 from
// behind it. lift: sine of the camera's elevation above the road, seen from the car. From above, the
// glare of both ends of a car shows; from the street, only the end that points at you.
float sl_headShow(float facing, float lift) {
  return smoothstep(-0.05, 0.3, facing) * (0.3 + 0.7 * facing * facing) + 0.2 * smoothstep(0.15, 0.6, lift);
}
float sl_tailShow(float facing, float lift) {
  return smoothstep(-0.05, 0.3, -facing) * (0.45 - 0.55 * min(facing, 0.0)) + 0.24 * smoothstep(0.15, 0.6, lift);
}
// Wet asphalt throws light forward, not up: the pools are faint from the street and plain from the air.
float sl_poolShow(float lift) { return mix(0.45, 1.0, smoothstep(0.08, 0.5, lift)); }
// Emergency strobe in double flashes: x the red side, y the blue side.
vec2 sl_strobe(SlCar c) {
  float ph = fract(uTime * 1.9 + c.r1.z * 7.0);
  float blink = step(0.5, fract(ph * 6.0));
  return mix(vec2(0.3), vec2(1.0 - step(0.5, ph), step(0.5, ph)) * blink, uMotion);
}
`;

// ---- near cars: which car an instance is, and where

const SL_PLACED = /* glsl */ `
attribute vec4 aSlot;   // axis, road offset from the nearest road, lane row within the axis, car offset from the nearest car

struct SlPlaced {
  SlCar car;
  vec3 anchor;     // tile position of the car's centre, on the road
  vec2 fwd;        // unit direction of travel in xz
  vec3 dims;
  float dist;      // from the camera, metres
  float fadeNear;  // 1 where real cars are drawn, 0 where the far dashes have taken over
  float along;     // tile coordinate along the lane
  float laneId;
};

SlPlaced sl_placed() {
  SlPlaced p;
  float axis = aSlot.x;
  float camAlong = axis < 0.5 ? uCam.x : uCam.z;
  float camAcross = axis < 0.5 ? uCam.z : uCam.x;
  float lineF = floor(camAcross / SC_CELL + 0.5) + aSlot.y;
  float line = sl_imod(lineF, SC_CELLS);
  float row = axis * 6.0 + aSlot.z;
  vec4 lane = sl_lane(line, row);
  p.laneId = line + row * 64.0;
  float q = sl_q(lane, camAlong);
  p.car = sl_car(lane, p.laneId, row, q, floor(q + 0.5) + aSlot.w);
  p.along = camAlong + p.car.offset;
  float across = lineF * SC_CELL + lane.x;
  p.anchor = axis < 0.5 ? vec3(p.along, 0.0, across) : vec3(across, 0.0, p.along);
  float dir = lane.y < 0.0 ? -1.0 : 1.0;
  p.fwd = axis < 0.5 ? vec2(dir, 0.0) : vec2(0.0, dir);
  p.dims = sl_dims(p.car);
  p.dist = length(vec3(sc_wrap(p.anchor.xz), uCam.y));
  p.fadeNear = 1.0 - smoothstep(uHandover.x, uHandover.y, p.dist);
  return p;
}
// A car-frame offset turned to the direction of travel.
vec3 sl_turn(vec2 fwd, vec3 v) { return vec3(fwd.x * v.x - fwd.y * v.z, v.y, fwd.y * v.x + fwd.x * v.z); }
`;

// ---- car bodies

export const CAR_VERT = SC_COMMON + SC_VERTEX + SL_LANES + SL_PLACED + /* glsl */ `
attribute vec3 aAlt;
attribute vec3 aBike;
attribute float aPart;
varying vec3 vP;
varying vec3 vLocal;
flat varying vec4 vInfo;    // class, kind, part, tile coordinate along the lane
flat varying vec3 vDims;
flat varying vec4 vRand;    // paint, lamp style, trim, interior
flat varying vec3 vAccent;
flat varying vec3 vTint;    // the block's neon, mirrored in the paint
flat varying vec4 vTail;    // rgb tail colour, a underglow strength
flat varying vec3 vHead;
flat varying vec2 vStrobe;
void main() {
  SlPlaced c = sl_placed();
  vec3 shape = c.car.klass > 2.5 ? aBike : c.car.klass < 0.5
    ? position * vec3(c.dims.x / ${f(CAR_DIMS[0])}, 1.0, 1.0)
    : aAlt * (c.car.klass > 1.5 ? ${v3(BUS_SCALE)} : vec3(1.0));
  vec3 p = sc_place(c.anchor, sl_turn(c.fwd, shape));
  vP = p;
  vLocal = shape;
  vInfo = vec4(c.car.klass, c.car.kind, aPart, c.along);
  vDims = c.dims;
  vec3 r3 = sc_hash33(vec3(c.laneId, c.car.idx, 3.0));
  vRand = vec4(r3, fract(c.car.r1.z * 3.0));
  vAccent = sl_accent(c.car);
  vTint = sc_neon(sc_cellData(sc_cell(c.anchor.xz)).g);
  vTail = vec4(sl_tailColor(c.car), sl_underglow(c.car));
  vHead = sl_headColor(c.car);
  vStrobe = sl_strobe(c.car);
  // Bodies are dark; past the handover the far dashes carry the lights and the body is not drawn.
  gl_Position = c.car.show > 0.5 && c.dist < uHandover.y ? sc_project(p) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const CAR_FRAG = SC_COMMON + SL_COLORS + /* glsl */ `
varying vec3 vP;
varying vec3 vLocal;
flat varying vec4 vInfo;
flat varying vec3 vDims;
flat varying vec4 vRand;
flat varying vec3 vAccent;
flat varying vec3 vTint;
flat varying vec4 vTail;
flat varying vec3 vHead;
flat varying vec2 vStrobe;

// A filled rectangle, antialiased; it dims rather than aliases when it is thinner than a pixel.
float sl_rect(vec2 p, vec2 centre, vec2 halfSize, vec2 fw) {
  return sc_line(p.x - centre.x, halfSize.x, fw.x) * sc_line(p.y - centre.y, halfSize.y, fw.y);
}

void main() {
  // Flat shading from derivatives, taken before any branch.
  vec3 ddx = dFdx(vLocal), ddy = dFdy(vLocal);
  vec3 fw = abs(ddx) + abs(ddy);
  vec3 n = cross(ddx, ddy);
  float nl = length(n);
  vec3 an = nl > 1e-12 ? abs(n) / nl : vec3(0.0, 1.0, 0.0);

  float klass = vInfo.x, kind = vInfo.y, part = vInfo.z;
  float halfL = vDims.x, tall = vDims.y, halfW = vDims.z;
  float bike = step(2.5, klass);
  float boxy = step(0.5, klass) - bike, bus = step(1.5, klass) - bike;
  vec3 q = vLocal;
  vec2 zy = vec2(q.z, q.y), fzy = vec2(fw.z, fw.y);
  vec2 zyN = vec2(q.z / halfW, q.y / tall), fzyN = vec2(fw.z / halfW, fw.y / tall);
  float floorY = bike > 0.5 ? ${f(BIKE_FLOOR)} : klass < 0.5 ? ${f(CAR_FLOOR)} : ${f(VAN_FLOOR)} * (bus > 0.5 ? ${f(BUS_SCALE[1])} : 1.0);

  float pr = vRand.x;
  vec3 paint = pr < 0.30 ? vec3(0.012, 0.010, 0.030) : pr < 0.48 ? vec3(0.085, 0.008, 0.020)
    : pr < 0.62 ? vec3(0.008, 0.045, 0.060) : pr < 0.76 ? vec3(0.045, 0.010, 0.085)
    : pr < 0.88 ? vec3(0.110, 0.110, 0.130) : vec3(0.120, 0.045, 0.008);
  if (kind > 1.5) paint = vec3(0.11, 0.11, 0.13);
  else if (kind > 0.5) paint = vec3(0.14, 0.095, 0.006);
  if (bus > 0.5) paint = vec3(0.02, 0.016, 0.04) + vTint * 0.035;

  // The street's neon slides over the flanks and the glass as the car passes it.
  float streak = smoothstep(0.5, 0.85, sc_noise(vec2((vInfo.w + q.x) * 0.07, q.y * 1.7 + pr * 31.0)));
  float up = an.y;
  vec3 col = paint * (0.3 + 0.7 * up) + uSkyMid * 0.05 * up + vTint * streak * 0.16 * (1.0 - up);
  vec3 glow = vec3(0.0);
  bool cut = false;

  if (part < 0.5) {
    if (an.x > 0.9) {
      if (q.x < 0.0) {
        // Tail lights.
        float m;
        if (bike > 0.5) {
          m = sl_rect(zy, vec2(0.0, 0.8), vec2(0.075, 0.05), fzy);
        } else if (klass < 0.5) {
          float bar = sl_rect(zy, vec2(0.0, 0.66), vec2(0.84, 0.07), fzy);
          float blocks = sl_rect(vec2(abs(q.z), q.y), vec2(0.6, 0.66), vec2(0.25, 0.08), fzy);
          m = vRand.y < 0.4 ? bar : vRand.y < 0.7 ? blocks : bar * (0.25 + 0.75 * sc_pulse(q.z / 0.21 + 0.5, 0.7, fw.z / 0.21));
        } else {
          m = sl_rect(vec2(abs(zyN.x), zyN.y), vec2(0.8, 0.36), vec2(0.11, 0.07), fzyN);
          m += bus * sl_rect(zyN, vec2(0.0, 0.52), vec2(0.5, 0.012), fzyN);
        }
        glow += vTail.rgb * m * 5.5;
      } else {
        // Headlights.
        float m;
        if (bike > 0.5) {
          m = sl_rect(zy, vec2(0.0, 0.8), vec2(0.09, 0.07), fzy);
        } else if (klass < 0.5) {
          float lamps = sl_rect(vec2(abs(q.z), q.y), vec2(0.6, 0.39), vec2(0.24, 0.055), fzy);
          float bar = sl_rect(zy, vec2(0.0, 0.39), vec2(0.86, 0.03), fzy);
          m = fract(vRand.y * 7.0) < 0.3 ? bar : lamps;
        } else {
          m = sl_rect(vec2(abs(zyN.x), zyN.y), vec2(0.68, 0.25), vec2(0.17, 0.035), fzyN);
        }
        glow += vHead * m * 7.0;
      }
    } else if (an.z > 0.9) {
      // Flanks: a lit skirt, and a route stripe on vans and buses.
      glow += vAccent * sc_line(q.y - (floorY + 0.05), 0.03, fw.y) * (0.5 + vTail.a) * 1.3;
      glow += vAccent * boxy * sc_line(zyN.y - mix(0.4, 0.33, bus), mix(0.008, 0.014, bus), fzyN.y) * mix(1.2, 2.6, bus);
    } else if (q.y < floorY + 0.01) {
      col = vec3(0.004, 0.004, 0.008);
    }
  } else if (part < 1.5 && bike > 0.5) {
    // The rider: dark leathers, a helmet in the paint colour, and a lit visor round its front.
    float helmet = step(tall - 0.3, q.y);
    col = mix(vec3(0.012, 0.010, 0.022) * (0.4 + 0.6 * up), col, helmet);
    glow += vAccent * sc_line(q.y - (tall - 0.16), 0.035, fw.y) * step(-0.02, q.x) * (1.0 - up) * 3.0;
  } else if (part < 1.5) {
    float base = klass < 0.5 ? 0.7 : 1.18 * (bus > 0.5 ? ${f(BUS_SCALE[1])} : 1.0);
    float t = clamp((q.y - base) / (tall - base), 0.0, 1.0);
    vec3 glass = vec3(0.006, 0.008, 0.02) + uSkyHorizon * 0.09 * t * t + vTint * streak * 0.22;
    if (up > 0.85) {
      // Roof: a neon roof line, a taxi sign or an emergency light bar.
      if (klass < 0.5) {
        vec2 fxz = vec2(fw.x, fw.z);
        if (kind > 1.5) {
          vec3 bar = sc_neon(6.0) * vStrobe.x * (1.0 - step(0.0, q.z)) + SL_BLUE * vStrobe.y * step(0.0, q.z);
          glow += bar * sl_rect(q.xz, vec2(-0.45, 0.0), vec2(0.1, 0.56), fxz) * 9.0;
        } else if (kind > 0.5) {
          glow += sc_neon(4.0) * sl_rect(q.xz, vec2(-0.45, 0.0), vec2(0.1, 0.3), fxz) * 3.0;
        } else {
          glow += vAccent * sc_line(q.z, 0.045, fw.z) * step(0.45, vRand.z) * 2.2;
        }
      } else {
        glow += vAccent * bus * sc_line(abs(q.z) - halfW * 0.7, 0.04, fw.z) * 1.6;
      }
    } else if (klass < 0.5) {
      col = glass;
    } else if (bus > 0.5) {
      if (an.z > 0.9) {
        // A lit saloon behind a row of windows.
        float band = sc_line(zyN.y - 0.74, 0.115, fzyN.y);
        float win = sc_pulse(q.x / 1.5 + 0.25, 0.86, fw.x / 1.5);
        vec3 interior = mix(vec3(1.0, 0.74, 0.42), vec3(0.5, 0.9, 1.0), step(0.55, vRand.w));
        col = paint * 0.5;
        glow += interior * band * win * mix(0.7, 1.1, t);
      } else {
        col = glass;
        // Destination sign over the windscreen.
        if (q.x > 0.0) glow += sc_neon(3.0) * sl_rect(zyN, vec2(0.0, 0.93), vec2(0.6, 0.028), fzyN) * 2.5;
      }
    } else {
      // Van: a windscreen and a door window; the rest is panel.
      float door = step(0.9, an.z) * sl_rect(vec2(q.x, zyN.y), vec2(1.55, 0.76), vec2(0.5, 0.12), vec2(fw.x, fzyN.y));
      col = an.x > 0.3 && q.x > 0.0 ? glass : mix(col, glass, door);
    }
  } else {
    col = vec3(0.004, 0.004, 0.008);
    if (an.z > 0.9) {
      // The axle is a box; cut its two outer faces down to round wheels (a pair of them on a bus).
      float sx = klass < 0.5 ? halfL / ${f(CAR_DIMS[0])} : (bus > 0.5 ? ${f(BUS_SCALE[0])} : 1.0);
      float sy = bus > 0.5 ? ${f(BUS_SCALE[1])} : 1.0;
      float r0 = bike > 0.5 ? ${f(BIKE_AXLES[2])} : klass < 0.5 ? ${f(CAR_AXLES[2])} : ${f(VAN_AXLES[2])};
      float axle = bike > 0.5 ? (q.x > 0.0 ? ${f(BIKE_AXLES[0])} : ${f(BIKE_AXLES[1])}) : (klass < 0.5 ? (q.x > 0.0 ? ${f(CAR_AXLES[0])} : ${f(CAR_AXLES[1])}) : (q.x > 0.0 ? ${f(VAN_AXLES[0])} : ${f(VAN_AXLES[1])})) * sx;
      float radius = r0 * sy;
      float r = length(vec2(max(abs(q.x - axle) - max(r0 * sx - radius, 0.0), 0.0), q.y - radius));
      cut = r > radius;
      // A dull hub, and on a few cars a lit ring.
      col += paint * 0.35 * (1.0 - step(0.55 * radius, r));
      glow += vAccent * sc_line(r - 0.68 * radius, 0.03, max(fw.x, fw.y)) * step(0.8, vRand.z) * (1.0 - boxy) * 2.0;
    }
  }

  // Every derivative was taken above, so discarding here cannot outline anything.
  if (cut) discard;
  col += glow * uGlow;
  gl_FragColor = vec4(sc_fog(col, vP), 1.0);
}
`;

// ---- lamp sprites: two headlights, two tail lights and a roof beacon per car. Additive, reflected.

export const LAMP_VERT = SC_COMMON + SC_VERTEX + SL_LANES + SL_PLACED + /* glsl */ `
uniform vec2 uLamp;   // x smallest half-size in pixels, y how much a lamp held at that size dims
varying vec2 vUv;
flat varying vec3 vColor;
flat varying vec2 vShape;   // x sharpness of the core, y streak amount
void main() {
  SlPlaced c = sl_placed();
  float id = position.z;
  vUv = position.xy;
  vColor = vec3(0.0);
  vShape = vec2(14.0, 0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (c.car.show < 0.5 || c.fadeNear <= 0.0) return;

  float bike = step(2.5, c.car.klass);
  float boxy = step(0.5, c.car.klass) - bike;
  float sideSign = mod(id, 2.0) < 0.5 ? -1.0 : 1.0;
  vec3 lamp;
  vec3 color;
  float size;
  float streak = 0.0;
  if (id < 1.5) {
    lamp = vec3(c.dims.x + 0.05, boxy > 0.5 ? 0.25 * c.dims.y : 0.39, sideSign * (boxy > 0.5 ? 0.68 : 0.63) * c.dims.z);
    color = sl_headColor(c.car) * 6.0;
    size = 0.6;
    streak = 1.0;
  } else if (id < 3.5) {
    lamp = vec3(-c.dims.x - 0.05, boxy > 0.5 ? 0.36 * c.dims.y : 0.66, sideSign * (boxy > 0.5 ? 0.8 : 0.62) * c.dims.z);
    color = sl_tailColor(c.car) * 4.0;
    size = 0.5;
  } else {
    if (c.car.kind < 0.5) return;
    lamp = vec3(-0.45, c.dims.y + 0.12, 0.0);
    if (c.car.kind > 1.5) {
      vec2 s = sl_strobe(c.car);
      color = (sc_neon(6.0) * s.x + SL_BLUE * s.y) * 10.0;
      size = 1.0;
    } else {
      color = sc_neon(4.0) * 2.5;
      size = 0.32;
    }
  }

  if (bike > 0.5 && id < 3.5) {
    // A motorcycle has one lamp at each end, on its centre line.
    if (sideSign > 0.0) return;
    lamp = vec3(sign(lamp.x) * (c.dims.x + 0.05), 0.8, 0.0);
  }

  vec3 centre = sc_place(c.anchor, sl_turn(c.fwd, lamp));
  vec3 toCam = vec3(0.0, cameraPosition.y, 0.0) - centre;
  float range = length(toCam);
  toCam /= max(range, 1e-3);
  // Headlights throw forward and tail lights back; neither shows through its own car.
  float facing = dot(toCam, vec3(c.fwd.x, 0.0, c.fwd.y));
  float amount = 1.0;
  if (id < 1.5) amount = sl_headShow(facing, toCam.y);
  else if (id < 3.5) amount = sl_tailShow(facing, toCam.y);
  if (amount <= 0.0) return;

  // Stand the sprite clear of the bodywork, and never let it fall under a few pixels.
  centre += toCam * min(0.45, range * 0.5);
  float drawn = sc_minSize(centre, size, uLamp.x);
  float grow = size / drawn;
  vShape = vec2(mix(3.5, 14.0, smoothstep(0.5, 1.0, grow)), streak * grow);
  vColor = color * amount * c.fadeNear * mix(uLamp.y, 1.0, grow) * (1.0 - sc_fogAmount(centre)) * uGlow;
  gl_Position = sc_project(sc_sprite(centre, position.xy, drawn));
}
`;

export const LAMP_FRAG = SC_COMMON + /* glsl */ `
varying vec2 vUv;
flat varying vec3 vColor;
flat varying vec2 vShape;
void main() {
  float r2 = dot(vUv, vUv);
  float core = exp(-r2 * vShape.x);
  float halo = exp(-r2 * 3.2) * 0.16;
  // A thin horizontal flare, as an anamorphic lens would draw.
  float streak = vShape.y * exp(-vUv.y * vUv.y * 110.0) * exp(-vUv.x * vUv.x * 2.4) * 0.3;
  float edge = 1.0 - smoothstep(0.7, 1.0, sqrt(r2));
  gl_FragColor = vec4(vColor * (core + halo + streak) * edge, 1.0);
}
`;

// ---- light on the road: headlight pool, tail smear and underglow per car. Additive, not reflected.

export const POOL_VERT = SC_COMMON + SC_VERTEX + SL_LANES + SL_PLACED + /* glsl */ `
varying vec2 vQ;             // car frame, metres: x ahead of the centre, y to the right
varying float vClear;        // 1 - fog
flat varying vec4 vKind;     // which quad, half length, half width, falloff margin
flat varying vec3 vColor;
void main() {
  SlPlaced c = sl_placed();
  float id = position.z;
  vQ = vec2(0.0);
  vClear = 0.0;
  vKind = vec4(id, c.dims.x, c.dims.z, 1.0);
  vColor = vec3(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (c.car.show < 0.5 || c.fadeNear <= 0.0) return;

  vec2 lo, hi;
  vec3 color;
  if (id < 0.5) {
    // A motorcycle's one lamp throws a narrower pool.
    float poolHalf = ${f(POOL_HALF)} * (c.car.klass > 2.5 ? 0.6 : 1.0);
    lo = vec2(c.dims.x - 0.8, -poolHalf);
    hi = vec2(c.dims.x + ${f(POOL_LENGTH)}, poolHalf);
    color = mix(sl_headColor(c.car), sc_neon(4.0), 0.25) * 0.7 * sl_poolShow(uCam.y / max(c.dist, 1.0));
  } else if (id < 1.5) {
    lo = vec2(-c.dims.x - 7.0, -1.8);
    hi = vec2(-c.dims.x + 0.5, 1.8);
    color = sl_tailColor(c.car) * 0.45 * sl_poolShow(uCam.y / max(c.dist, 1.0));
  } else {
    float margin = 1.3;
    color = sl_accent(c.car) * sl_underglow(c.car);
    if (c.car.kind > 1.5) {
      // An emergency car throws its strobe across the whole carriageway.
      vec2 s = sl_strobe(c.car);
      margin = 8.0;
      color = (sc_neon(6.0) * s.x + SL_BLUE * s.y) * 2.4;
    }
    lo = -(c.dims.xz + margin);
    hi = c.dims.xz + margin;
    vKind.w = margin;
  }
  vec2 q = mix(lo, hi, position.xy * 0.5 + 0.5);
  vec3 p = sc_place(c.anchor + vec3(0.0, ${f(GROUND_LIFT)}, 0.0), sl_turn(c.fwd, vec3(q.x, 0.0, q.y)));
  vQ = q;
  vClear = 1.0 - sc_fogAmount(p);
  vColor = color * c.fadeNear * uGlow;
  gl_Position = sc_project(p);
}
`;

export const POOL_FRAG = SC_COMMON + /* glsl */ `
varying vec2 vQ;
varying float vClear;
flat varying vec4 vKind;
flat varying vec3 vColor;
void main() {
  float id = vKind.x, halfL = vKind.y, halfW = vKind.z;
  float a;
  if (id < 0.5) {
    // Two beams merging into one widening pool.
    float t = clamp((vQ.x - halfL) / ${f(POOL_LENGTH)}, 0.0, 1.0);
    float w = mix(0.7, ${f(POOL_HALF * 0.6)}, t);
    // Two beams a car's lamps apart, merging; a motorcycle's are nearly one.
    float y = abs(vQ.y) - 0.55 * min(halfW / ${f(CAR_DIMS[2])}, 1.0) * (1.0 - t);
    a = smoothstep(0.0, 0.06, t) * pow(1.0 - t, 2.4) * exp(-y * y / (w * w));
  } else if (id < 1.5) {
    float t = clamp((-halfL - vQ.x) / 7.0, 0.0, 1.0);
    a = (1.0 - t) * (1.0 - t) * exp(-vQ.y * vQ.y * 1.1) * (1.0 - smoothstep(0.0, 0.5, vQ.x + halfL));
  } else {
    vec2 d = max(abs(vQ) - vec2(halfL - 0.2, halfW - 0.2), 0.0);
    a = 1.0 - smoothstep(0.0, 1.0, length(d) / vKind.w);
    a *= a;
  }
  gl_FragColor = vec4(vColor * a * vClear, 1.0);
}
`;

// ---- far traffic: one quad per road, on which every car beyond the handover is a pair of dashes

export const FAR_VERT = SC_COMMON + SC_VERTEX + /* glsl */ `
attribute vec2 aRoad;   // axis, grid line
varying vec2 vRel;      // render-space x and z
varying float vAcross;  // metres from the road's centre line
flat varying vec2 vRoad;
void main() {
  float axis = aRoad.x, line = aRoad.y;
  float halfRoad = sc_roadHalf(sc_isAvenue(line));
  vec2 centre = sc_wrap(vec2(line * SC_CELL));
  float along = position.x * uFar.y;
  float across = position.y * halfRoad;
  vec3 p = axis < 0.5 ? vec3(along, ${f(GROUND_LIFT)}, centre.y + across) : vec3(centre.x + across, ${f(GROUND_LIFT)}, along);
  vRel = p.xz;
  vAcross = across;
  vRoad = aRoad;
  gl_Position = sc_project(p);
}
`;

const laneGeometry = (spec: typeof STREET): string =>
  `vec3(${f(spec.lanes[0] ?? 2)}, ${f((spec.lanes[1] ?? (spec.lanes[0] ?? 2) + 4) - (spec.lanes[0] ?? 2))}, ${f(spec.lanes.length)})`;

export const FAR_FRAG = SC_COMMON + SL_LANES + /* glsl */ `
uniform vec2 uLamp;   // as the lamp sprites: x smallest half-size in pixels, y how much a lamp held at that size dims
uniform vec4 uDash;   // x smallest sigma of a far lamp in pixels, y pool gain, z tail smear gain, w underglow gain
varying vec2 vRel;
varying float vAcross;
flat varying vec2 vRoad;

// A soft spot of light on the road, filtered against the pixel footprint fw. "at" is the offset from
// its centre (along, across), sigma its size. minPx keeps it from falling under that many pixels;
// power 1 conserves its energy when it is enlarged, less keeps it bright.
float sl_spot(vec2 at, vec2 sigma, vec2 fw, float minPx, float power) {
  vec2 s = max(sqrt(sigma * sigma + 0.25 * fw * fw), minPx * fw);
  vec2 u = at / s;
  return exp(-0.5 * dot(u, u)) * pow(sigma.x * sigma.y / (s.x * s.y), power);
}

void main() {
  float axis = vRoad.x, line = vRoad.y;
  float relAlong = axis < 0.5 ? vRel.x : vRel.y;
  float relAcross = axis < 0.5 ? vRel.y : vRel.x;
  vec2 fw = max(vec2(fwidth(relAlong), fwidth(vAcross)), 1e-4);

  // Which lane this pixel is in. x first lane offset, y lane pitch, z lanes per direction.
  vec3 geom = mix(${laneGeometry(STREET)}, ${laneGeometry(AVENUE)}, sc_isAvenue(line));
  float slot = clamp(floor((abs(vAcross) - geom.x) / geom.y + 0.5), 0.0, geom.z - 1.0);
  float row = axis * 6.0 + step(0.0, vAcross) * 3.0 + slot;
  vec4 lane = sl_lane(line, row);
  float laneId = line + row * 64.0;
  float dl = vAcross - lane.x;
  float q = sl_q(lane, (axis < 0.5 ? uCam.x : uCam.z) + relAlong);
  float i0 = floor(q);
  float dir = lane.y < 0.0 ? -1.0 : 1.0;

  vec3 col = vec3(0.0);
  // The two cars either side of this pixel; nothing a car lights reaches further than that.
  for (int j = 0; j < 2; j++) {
    SlCar car = sl_car(lane, laneId, row, q, i0 + float(j));
    float halfL = sl_dims(car).x;
    float x = -car.offset * dir;                    // metres ahead of the car's centre
    float carAlong = relAlong + car.offset;         // the car's centre, relative to the camera
    float dist = length(vec3(carAlong, relAcross - dl, uCam.y));
    float amount = smoothstep(uHandover.x, uHandover.y, dist) * car.show;
    float facing = -dir * carAlong / max(dist, 1.0);   // 1 when it drives straight at the camera
    float lift = uCam.y / max(dist, 1.0);
    vec3 head = sl_headColor(car), tail = sl_tailColor(car);
    // Lamps: the two of each end drawn as one dot, held at a few pixels and dimmed as the sprites are.
    float lampGain = 1.6 * mix(uLamp.y, 1.0, clamp(0.6 / (uLamp.x * min(fw.x, fw.y)), 0.0, 1.0));
    // A motorcycle has one lamp at each end, not a pair.
    lampGain *= car.klass > 2.5 ? 0.55 : 1.0;
    vec3 c = head * sl_spot(vec2(x - halfL - 0.3, dl), vec2(0.5), fw, uDash.x, 0.0) * sl_headShow(facing, lift) * 6.0 * lampGain;
    c += tail * sl_spot(vec2(x + halfL + 0.3, dl), vec2(0.5), fw, uDash.x, 0.0) * sl_tailShow(facing, lift) * 4.0 * lampGain;
    // Light on the road, with the energy of the near quads.
    float pool = sl_poolShow(lift);
    c += mix(head, sc_neon(4.0), 0.25) * sl_spot(vec2(x - halfL - 6.5, dl), vec2(4.0, 1.2), fw, 0.0, 1.0) * uDash.y * pool;
    c += tail * sl_spot(vec2(x + halfL + 3.0, dl), vec2(2.2, 0.9), fw, 0.0, 1.0) * uDash.z * pool;
    vec3 under = sl_accent(car) * sl_underglow(car);
    if (car.kind > 1.5) {
      vec2 s = sl_strobe(car);
      under = (sc_neon(6.0) * s.x + SL_BLUE * s.y) * 6.0;
    }
    c += under * sl_spot(vec2(x, dl), vec2(halfL * 0.75, 1.25), fw, 0.0, 1.0) * uDash.w;
    col += c * amount;
  }

  // Only the two nearest cars are summed; where the footprint spans more of them, make up the rest.
  float spacing = SC_TILE / max(lane.z, 1.0);
  col *= clamp(1.25 * uDash.x * fw.x / spacing, 1.0, 2.5);

  vec3 p = vec3(vRel.x, ${f(GROUND_LIFT)}, vRel.y);
  col *= sc_farFade(vRel) * (1.0 - sc_fogAmount(p)) * uGlow;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- crowds: upright impostors on the sidewalks near the camera

const share = CROWD_BY_DISTRICT;

const crowdShare = (district: string): string =>
  `(${district} < 0.5 ? ${f(share[0] ?? 1)} : ${district} < 1.5 ? ${f(share[1] ?? 1)} : ${district} < 2.5 ? ${f(share[2] ?? 1)}
    : ${district} < 3.5 ? ${f(share[3] ?? 1)} : ${f(share[4] ?? 1)})`;

const SL_FIGURE = /* glsl */ `
uniform vec4 uCrowd;      // x where people start to shrink away, y where they are gone, z people per block face, w people per cell
varying vec3 vP;
varying vec2 vQ;          // metres: x across the figure, y up from the feet
flat varying vec4 vBody;  // stature, leg swing -1..1, bob, accent variant 0..1
flat varying vec4 vLook;  // umbrella, coat, cloth shade, lean
flat varying vec3 vAccent;
flat varying vec3 vRim;

float sl_imod(float x, float y) { return x - y * floor((x + 0.5) / y); }

// Dress a figure from its hashes and stand it at anchor, upright and turned about the vertical to face
// the camera. stride is the distance walked in radians of leg swing; palette the neon of its block.
void sl_figure(vec3 anchor, float scale, float stride, float moving, vec3 r2, vec3 r3, float palette) {
  float stature = mix(1.52, 1.9, r2.y);
  vBody = vec4(stature, sin(stride) * moving, abs(sin(stride)) * 0.035 * moving, r2.z);
  vLook = vec4(step(0.86, r3.x), step(0.62, r3.y), r3.z * r3.z, 0.0);
  float a = r3.x * 7.0 - floor(r3.x * 7.0);
  vAccent = sc_neon(a < 0.3 ? 0.0 : a < 0.6 ? 1.0 : a < 0.75 ? 4.0 : a < 0.87 ? 5.0 : a < 0.95 ? 3.0 : 7.0);
  vRim = sc_neon(palette);

  vec3 right = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
  float rl = length(right);
  right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);
  vec2 quad = vec2(position.x * ${f(WALKER_HALF)}, position.y * ${f(WALKER_TALL)});
  vec3 p = sc_place(anchor, (right * quad.x + vec3(0.0, quad.y, 0.0)) * scale);
  vP = p;
  vQ = quad;
  gl_Position = scale > 0.0 ? sc_project(p) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const WALKER_VERT = SC_COMMON + SC_VERTEX + SL_FIGURE + /* glsl */ `
attribute vec4 aWalker;   // axis * 2 + side, road offset, block offset, index on that block face

void main() {
  float axis = step(1.5, aWalker.x);
  float side = aWalker.x - 2.0 * axis;
  float camAlong = axis < 0.5 ? uCam.x : uCam.z;
  float camAcross = axis < 0.5 ? uCam.z : uCam.x;
  float lineF = floor(camAcross / SC_CELL + 0.5) + aWalker.y;
  float blockF = floor(camAlong / SC_CELL + 0.5) + aWalker.z;
  float line = sl_imod(lineF, SC_CELLS);
  float block = sl_imod(blockF, SC_CELLS);
  float next = sl_imod(blockF + 1.0, SC_CELLS);
  float avenue = sc_isAvenue(line);

  // This face of the block: from one cross street's curb to the next.
  float lo = blockF * SC_CELL + sc_roadHalf(sc_isAvenue(block)) + ${f(CROWD_END_MARGIN)};
  float hi = (blockF + 1.0) * SC_CELL - sc_roadHalf(sc_isAvenue(next)) - ${f(CROWD_END_MARGIN)};

  // The block it fronts decides how crowded it is and what colour its light is.
  float cellAcross = sl_imod(lineF + side - 1.0, SC_CELLS);
  vec4 cell = sc_cellData(axis < 0.5 ? ivec2(int(block + 0.5), int(cellAcross + 0.5)) : ivec2(int(cellAcross + 0.5), int(block + 0.5)));
  float district = floor(cell.r + 0.5);
  float crowd = ${crowdShare('district')};

  float id = line + aWalker.x * 64.0;
  vec3 r1 = sc_hash33(vec3(id, block, aWalker.w));
  vec3 r2 = sc_hash33(vec3(id, block, aWalker.w + 256.0));
  vec3 r3 = sc_hash33(vec3(id, block, aWalker.w + 512.0));

  // Walk the block face there and back for ever; some just stand.
  float standing = 1.0 - step(${f(STANDING_CHANCE)}, r2.x);
  float laps = standing > 0.5 ? 0.0 : floor(12.0 + 11.99 * r1.y);
  float tri = abs(2.0 * fract(laps * uLoop + r1.z) - 1.0);
  float along = mix(lo, hi, tri);
  float inner = sc_roadHalf(avenue) + ${f(CROWD_MARGIN)};
  float outer = sc_corridorHalf(avenue) - ${f(CROWD_MARGIN)};
  float across = lineF * SC_CELL + (side * 2.0 - 1.0) * mix(inner, outer, r1.x);
  vec3 anchor = axis < 0.5 ? vec3(along, 0.0, across) : vec3(across, 0.0, along);

  float dist = length(vec3(sc_wrap(anchor.xz), uCam.y));
  float scale = (1.0 - smoothstep(uCrowd.x, uCrowd.y, dist)) * step(aWalker.w + 0.5, uCrowd.z * crowd);

  float stride = tri * (hi - lo) * (SC_PI / 0.72);
  sl_figure(anchor, scale, stride, 1.0 - standing, r2, r3, cell.g);
}
`;

// ---- people between the buildings: in the alleys and on the plazas (plan M6). Mirrors blockWalkerAt in ./pack.ts.

export const BLOCK_VERT = SC_COMMON + SC_VERTEX + SL_FIGURE + /* glsl */ `
attribute vec4 aBlock;    // cell offset from the camera's cell along x and z, slot in the cell
uniform highp sampler2D uAlleyTex;

void main() {
  float cellXF = floor(uCam.x / SC_CELL) + aBlock.x;
  float cellZF = floor(uCam.z / SC_CELL) + aBlock.y;
  float cx = sl_imod(cellXF, SC_CELLS), cz = sl_imod(cellZF, SC_CELLS);
  vec4 cell = sc_cellData(ivec2(int(cx + 0.5), int(cz + 0.5)));
  float district = floor(cell.r + 0.5);
  float share = ${crowdShare('district')};
  // The block: the cell minus the road corridors on its four sides.
  float x0 = cellXF * SC_CELL + sc_corridorHalf(sc_isAvenue(cx));
  float x1 = (cellXF + 1.0) * SC_CELL - sc_corridorHalf(sc_isAvenue(sl_imod(cx + 1.0, SC_CELLS)));
  float z0 = cellZF * SC_CELL + sc_corridorHalf(sc_isAvenue(cz));
  float z1 = (cellZF + 1.0) * SC_CELL - sc_corridorHalf(sc_isAvenue(sl_imod(cz + 1.0, SC_CELLS)));

  float id = cz * SC_CELLS + cx + ${f(BLOCK_HASH_BASE)};
  float p = aBlock.z;
  vec3 r1 = sc_hash33(vec3(id, p, 11.0));
  vec3 r2 = sc_hash33(vec3(id, p, 12.0));
  vec3 r3 = sc_hash33(vec3(id, p, 13.0));
  vec3 r4 = sc_hash33(vec3(id, p, 14.0));

  vec2 at;
  float show, walked, moving;
  if (district > 2.5 && district < 3.5) {
    // A plaza: round rings about the centre, across it on straight lines, or standing about.
    show = step(p + 0.5, uCrowd.w * share);
    vec2 mid = vec2(x0 + x1, z0 + z1) * 0.5;
    vec2 halfSize = vec2(x1 - x0, z1 - z0) * 0.5;
    if (r4.x < ${f(PLAZA_RING_SHARE + PLAZA_STAND_SHARE)}) {
      moving = 1.0 - step(${f(PLAZA_RING_SHARE)}, r4.x);
      float radius = mix(${f(PLAZA_RING_MIN)}, ${f(PLAZA_RING_MAX)}, r4.y);
      float speed = 1.0 + 0.5 * r1.y;
      float laps = moving > 0.5 ? max(1.0, floor(speed * ${f(LOOP_SECONDS)} / (2.0 * SC_PI * radius))) : 0.0;
      float dir = r4.z < 0.5 ? -1.0 : 1.0;
      float u = fract(dir * laps * uLoop + r1.z);
      float a = 2.0 * SC_PI * u;
      at = mid + radius * vec2(cos(a), sin(a));
      walked = u * 2.0 * SC_PI * radius;
    } else {
      bool along0 = r4.z < 0.5;
      float ha = along0 ? halfSize.x : halfSize.y;
      float hp = along0 ? halfSize.y : halfSize.x;
      float sgn = fract(r4.z * 7.0) < 0.5 ? -1.0 : 1.0;
      float offset = sgn * (${f(PLAZA_CROSS_CENTRE)} + (hp - ${f(PLAZA_CROSS_EDGE + PLAZA_CROSS_CENTRE)}) * r4.y);
      float laps = floor(12.0 + 11.99 * r1.y);
      float tri = abs(2.0 * fract(laps * uLoop + r1.z) - 1.0);
      float along = -ha + 1.0 + (2.0 * ha - 2.0) * tri;
      at = mid + (along0 ? vec2(along, offset) : vec2(offset, along));
      walked = tri * (2.0 * ha - 2.0);
      moving = 1.0;
    }
  } else {
    // An alley: slot p belongs to alley place p mod 6 (three per axis); the cell may have fewer.
    float a = sl_imod(p, 6.0);
    float axis = step(2.5, a);
    float k = a - 3.0 * axis;
    float q = floor((p - a) / 6.0 + 0.5);
    ivec2 tx = ivec2(int(cx + 0.5) * ${ALLEY_TEXELS} + int(axis + 0.5) * 2, int(cz + 0.5));
    vec4 centres = texelFetch(uAlleyTex, tx, 0);
    vec4 halves = texelFetch(uAlleyTex, tx + ivec2(1, 0), 0);
    show = step(k + 0.5, centres.w) * step(q + 0.5, uCrowd.w / 6.0 * share);
    float centre = k < 0.5 ? centres.x : k < 1.5 ? centres.y : centres.z;
    float halfW = k < 0.5 ? halves.x : k < 1.5 ? halves.y : halves.z;
    // Some stand at a shop window; the rest walk the alley end to end and back.
    float standing = 1.0 - step(${f(ALLEY_STANDING)}, r2.x);
    moving = 1.0 - standing;
    float laps = standing > 0.5 ? 0.0 : floor(12.0 + 11.99 * r1.y);
    float tri = abs(2.0 * fract(laps * uLoop + r1.z) - 1.0);
    float lo = (axis < 0.5 ? x0 : z0) + 0.5, hi = (axis < 0.5 ? x1 : z1) - 0.5;
    float along = mix(lo, hi, tri);
    float lateral = standing > 0.5
      ? (r1.x < 0.5 ? -1.0 : 1.0) * max(halfW - ${f(ALLEY_STAND_MARGIN)}, 0.0)
      : (2.0 * r1.x - 1.0) * max(halfW - ${f(ALLEY_WALK_MARGIN)}, 0.0);
    float across = (axis < 0.5 ? cellZF : cellXF) * SC_CELL + centre + lateral;
    at = axis < 0.5 ? vec2(along, across) : vec2(across, along);
    walked = tri * (hi - lo);
  }

  vec3 anchor = vec3(at.x, 0.0, at.y);
  float dist = length(vec3(sc_wrap(anchor.xz), uCam.y));
  float scale = (1.0 - smoothstep(uCrowd.x, uCrowd.y, dist)) * show;
  sl_figure(anchor, scale, walked * (SC_PI / 0.72), moving, r2, r3, cell.g);
}
`;

export const WALKER_FRAG = SC_COMMON + /* glsl */ `
varying vec3 vP;
varying vec2 vQ;
flat varying vec4 vBody;
flat varying vec4 vLook;
flat varying vec3 vAccent;
flat varying vec3 vRim;

// Distance to a limb: a segment from a to b whose radius runs from ra to rb.
float sl_limb(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a, ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t) - mix(ra, rb, t);
}

void main() {
  vec2 p = vQ;
  float px = fwidth(vQ.x) + 1e-5;
  vec2 fw = vec2(px, fwidth(vQ.y) + 1e-5);
  float h = vBody.x, swing = vBody.y;
  float k = h / 1.75;
  p.y -= vBody.z;

  // Head, neck, shoulders, a torso that narrows to the hips.
  float d = length(p - vec2(0.0, h - 0.11 * k)) - 0.1 * k;
  d = min(d, sl_limb(p, vec2(0.0, 0.8 * h), vec2(0.0, 0.88 * h), 0.05 * k, 0.045 * k));
  d = min(d, sl_limb(p, vec2(-0.11 * k, 0.79 * h), vec2(0.11 * k, 0.79 * h), 0.065 * k, 0.065 * k));
  d = min(d, sl_limb(p, vec2(0.0, 0.75 * h), vec2(0.0, 0.54 * h), 0.15 * k, 0.115 * k));
  if (vLook.y > 0.5) {
    // A long coat.
    d = min(d, sl_limb(p, vec2(0.0, 0.56 * h), vec2(0.0, 0.31 * h), 0.13 * k, 0.185 * k));
  }
  // Legs swing from the hips and the arms swing against them.
  float reach = swing * 0.24 * k;
  d = min(d, sl_limb(p, vec2(-0.05 * k, 0.52 * h), vec2(reach - 0.03 * k, 0.05 + max(swing, 0.0) * 0.03), 0.095 * k, 0.05 * k));
  d = min(d, sl_limb(p, vec2(0.05 * k, 0.52 * h), vec2(0.03 * k - reach, 0.05 + max(-swing, 0.0) * 0.03), 0.095 * k, 0.05 * k));
  d = min(d, sl_limb(p, vec2(-0.17 * k, 0.78 * h), vec2((-0.2 - swing * 0.12) * k, 0.47 * h), 0.05 * k, 0.038 * k));
  d = min(d, sl_limb(p, vec2(0.17 * k, 0.78 * h), vec2((0.2 + swing * 0.12) * k, 0.47 * h), 0.05 * k, 0.038 * k));
  float canopy = 1.0;
  if (vLook.x > 0.5) {
    // An umbrella: a dome over the head on a thin pole.
    canopy = max(length(p - vec2(0.0, h + 0.02)) - 0.52, (h + 0.2) - p.y);
    d = min(d, sl_limb(p, vec2(0.2 * k, 0.5 * h), vec2(0.0, h + 0.4), 0.012, 0.012));
    d = min(d, canopy);
  }
  // Keep a far figure at least a pixel wide.
  d -= 0.35 * px;
  if (d > 0.0) discard;

  vec3 col = mix(vec3(0.010, 0.008, 0.024), vec3(0.045, 0.04, 0.065), vLook.z);
  // The block's neon catches the outline: a hairline close by, the whole figure once it is a few pixels tall.
  float rim = smoothstep(-max(0.02, 1.2 * px), 0.0, d);
  col += vRim * rim * 0.32;
  vec3 glow = vec3(0.0);
  float v = vBody.w;
  float chest = step(0.56 * h, p.y) * (1.0 - step(0.77 * h, p.y));
  if (v < 0.28) {
    // An open jacket with a lit seam.
    glow += vAccent * sc_line(p.x, 0.012, px) * chest * 2.6;
  } else if (v < 0.5) {
    // A visor.
    glow += vAccent * sc_line(p.x, 0.08 * k, fw.x) * sc_line(p.y - (h - 0.1 * k), 0.016, fw.y) * 3.2;
  } else if (v < 0.7) {
    // Lit soles.
    glow += vAccent * sc_line(p.y - 0.045, 0.03, fw.y) * 2.6;
  } else if (v < 0.84) {
    // A screen held in the hand.
    glow += sc_neon(7.0) * sc_line(p.x - 0.14 * k, 0.03, fw.x) * sc_line(p.y - 0.6 * h, 0.05, fw.y) * 3.0;
  } else {
    // Piping down both sides of a jacket.
    glow += vAccent * sc_line(abs(p.x) - 0.12 * k, 0.011, fw.x) * chest * 2.2;
  }
  if (vLook.x > 0.5) {
    float dome = step(h + 0.2, p.y);
    glow += vAccent * dome * (sc_line(canopy + 0.016, 0.016, px) * 2.4 + 0.1 * (1.0 - step(0.0, canopy)));
  }
  col += glow * uGlow;
  gl_FragColor = vec4(sc_fog(col, vP), 1.0);
}
`;
