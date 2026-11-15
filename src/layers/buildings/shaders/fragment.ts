// Buildings fragment shader (plan T05): the facade, in metres, from the spec the vertex shader sent.
//
// Light levels follow architecture.md 5.2: walls are L0, lit windows L1, tubes and signs L2.
// Derivatives are taken once, at the top of main, before any branch (Agents.md, "Custom GLSL").
import { SC_COMMON } from '../../../contracts/glsl';
import { SB_PANELS } from './panels';
import { SB_SHARED } from './shared';
import { SB_STREET } from './street';
import { SB_TOPS } from './tops';

const SB_FACADE = /* glsl */ `
// What a pane of glass reflects: the sky in the mirror direction, pinker towards the sun.
vec3 sb_sky(vec3 r) {
  vec2 rh = r.xz / max(length(r.xz), 1e-4);
  vec2 sh = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float toSun = 0.5 + 0.5 * dot(rh, sh);
  vec3 low = mix(uSkyMid * 0.7, uSkyHorizon, toSun * toSun);
  vec3 sky = mix(low, uSkyMid, smoothstep(0.03, 0.4, r.y));
  sky = mix(sky, uSkyTop, smoothstep(0.4, 0.95, r.y));
  return mix(uFogCool * 0.6, sky, smoothstep(-0.25, 0.0, r.y));
}

// A side face of an ordinary box: wall, windows, sign panel, shop front, then the neon structure.
vec3 sb_facade(vec2 uv, vec2 fw, vec3 vn, vec3 n) {
  float W = vFace.x, H = vFace.y;
  float style = vSeed.z;
  float seed = vSeed.x;
  float yAbs = vSeed.w + uv.y;
  float hn = clamp(yAbs / vC1.w, 0.0, 1.0);
  float isRound = sb_bit(vFace.w, SB_FLAG_ROUND);
  bool isMega = sb_is(style, SB_MEGA);
  float glassy = (sb_is(style, SB_GLASS) || sb_is(style, SB_KIOSK)) ? 1.0 : 0.5;

  // View direction in face space: x right, y up, z into the wall.
  vec3 tangent = vec3(n.z, 0.0, -n.x);
  vec3 vt = vec3(dot(vn, tangent), vn.y, max(-dot(vn, n), 1e-3));

  // ---- wall, washed by the glow of the street near the ground
  vec3 wall = sb_wall();
  wall += (vTrimA.rgb + vTrimB.rgb) * (0.002 + 0.012 * exp(-yAbs / 22.0));

  // ---- windows
  vec2 cell = vGrid.xy;
  vec2 duty = vGrid.zw;
  vec2 g = uv / cell;
  vec2 gf = fw / cell;
  vec2 id = floor(g);
  vec2 m0 = 0.5 * (1.0 - duty);
  float mask = sc_pulse(g.x - m0.x, duty.x, gf.x) * sc_pulse(g.y - m0.y, duty.y, gf.y);
  float dx = sc_detail(1.0, gf.x), dy = sc_detail(1.0, gf.y);
  float dd = dx * dy;

  float hz = sc_hash31(vec3(floor(id / vLit.yz), seed));
  float hr = sc_hash31(vec3(id.y, 7.0, seed));
  vec3 hw = sc_hash33(vec3(id, seed));
  // Zones are dark, ordinary or busy; a few rows are lit end to end.
  float pZone = clamp(vLit.x * (0.25 + 1.5 * smoothstep(0.15, 0.9, hz)), 0.0, 1.0);
  float rowAll = step(0.93, hr);
  float pRow = mix(clamp(pZone * (0.5 + hr), 0.0, 1.0), 1.0, rowAll);
  // A few windows re-roll every so often, each on its own clock.
  float roll = floor(uTime * 0.06 + hw.y * 11.0) * step(hw.z, 0.14);
  float lit = step(1.0 - pRow, fract(hw.x + 0.618 * roll));
  float amount = mix(pZone + 0.07 * (1.0 - pZone), mix(pRow, lit, dx), dy);
  float share = mix(vLit.w, 0.92, step(0.74, hz));
  // Curtain glass fades from one colour at the street to the other at the roof.
  if (glassy > 0.75) share = clamp(hn * 1.1 - 0.05 + (hz - 0.5) * 0.3, 0.04, 0.96);
  vec3 mean = mix(vC1.rgb, vC2.rgb, share) * 0.75;
  vec3 pane = mix(vC1.rgb, vC2.rgb, max(step(1.0 - share, hw.y), rowAll));
  // A dim window goes deeper in hue, not greyer.
  pane = mix(pane * pane / max(max(pane.r, pane.g), max(pane.b, 0.05)), pane, hw.z) * (0.45 + 0.55 * hw.z);
  float room = 0.85;
  if (dd > 0.01) {
    float floors = max(1.0, floor(cell.y / 3.8 + 0.5));
    vec2 rf = vec2(g.x - id.x, fract(g.y * floors));
    room = sb_room(rf, vec3(cell.x, cell.y / floors, 4.5), vt, hw.z);
    // Glazing bars split a wide pane, and floor slabs cross a tall one.
    vec2 paneSize = cell * duty;
    vec2 parts = max(vec2(1.0), floor(paneSize / vec2(1.7, 3.8) + 0.5));
    vec2 w = clamp((g - id - m0) / duty, 0.0, 1.0);
    vec2 bar = (fract(w * parts + 0.5) - 0.5) * paneSize / parts;
    float bars = max(sc_line(bar.x, 0.05, fw.x) * step(1.5, parts.x), sc_line(bar.y, 0.12, fw.y) * step(1.5, parts.y));
    room = mix(0.85, room * (1.0 - 0.85 * bars), dd);
  }
  vec3 glow = mix(mean, pane, dd) * room;

  // Unlit glass shows the sky; curtain glass also carries a faint gradient up the tower.
  float fresnel = 0.05 + 0.95 * pow(1.0 - clamp(vt.z, 0.0, 1.0), 4.0);
  vec3 glass = wall * 0.45 + sb_sky(reflect(vn, n)) * (min(fresnel, 0.45) * 0.3 * glassy);
  glass += mix(vTrimA.rgb, vTrimB.rgb, hn) * (0.02 * glassy);
  vec3 col = mix(wall, glass, mask) + glow * (mask * amount);
  // The reveal: a narrow rim round each window that catches its light, so the glass sits in the wall.
  vec2 rim = min(vec2(0.13) / cell, m0);
  float outer = sc_pulse(g.x - m0.x + rim.x, duty.x + 2.0 * rim.x, gf.x) * sc_pulse(g.y - m0.y + rim.y, duty.y + 2.0 * rim.y, gf.y);
  col += max(outer - mask, 0.0) * (wall * 1.2 + mix(mean, pane, dd) * (amount * 0.32));

  // ---- sign panel and shop front replace the windows where they sit
  float clear = 1.0;
  if (vPanel.z > 0.0) {
    float cover;
    vec3 signCol = sb_panel(uv, fw, cover);
    col = mix(col, signCol, cover);
    clear *= 1.0 - cover;
  }
  if (vShop.x > 0.0) {
    float cover;
    vec3 shop = sb_shop(uv, fw, vt, cover);
    col = mix(col, shop, cover);
    clear *= 1.0 - cover;
  }

  // ---- neon structure
  float tw = vDeco.z;
  float gain = vDeco.w * uGlow;
  float eu = min(uv.x, W - uv.x);
  float et = H - uv.y;
  float corner = 1.0 - isRound;
  float tube = max(sb_tube(et - tw, tw, fw.y), corner * sb_tube(eu - tw, tw, fw.x));
  col += vTrimA.rgb * (tube * gain);
  col += vTrimA.rgb * (0.05 * (exp(-et * 0.7) + corner * exp(-eu * 0.7)));

  if (vShop.x > 0.0) {
    // A cornice tube along the top of the shops, the whole length of the block.
    col += vTrimB.rgb * (sb_tube(uv.y - vShop.x, 0.09, fw.y) * 0.8 * gain);
    // The signs wash the wall above them.
    col += vTrimB.rgb * (0.04 * exp(-max(uv.y - vShop.x, 0.0) / 4.0) * step(vShop.x, uv.y));
  }
  if (vDeco.x > 0.0) {
    // Light bands every so many floors, not on the base line or the roof line.
    float s = vDeco.x;
    float d = (fract(uv.y / s + 0.5) - 0.5) * s;
    float on = step(0.5 * s, uv.y) * step(0.5 * s, et) * clear;
    float bw = vC2.w < 0.5 ? 0.18 : 0.42;
    col += vTrimB.rgb * (sc_line(d, bw, fw.y) * sc_detail(s, fw.y * 4.0) * on * 0.75 * gain);
    col += vTrimB.rgb * (0.04 * exp(-abs(d) * 0.8) * on);
  }
  if (vDeco.y > 0.0) {
    // Fins: thin vertical tubes on the mullion lines.
    float s = vDeco.y;
    float d = (fract(uv.x / s + 0.5) - 0.5) * s;
    float on = step(0.5 * s, uv.x) * step(0.5 * s, W - uv.x) * clear;
    vec3 fin = fract(vC2.w * 3.0) < 0.5 ? vTrimA.rgb : vTrimB.rgb;
    col += fin * (sc_line(d, 0.1, fw.x) * sc_detail(s, fw.x * 4.0) * on * 0.7 * gain);
  }
  if (isMega) {
    // The spine: a wide band of light up the middle of every face, with dashes climbing it.
    float sx = abs(uv.x - 0.5 * W);
    float sw = max(2.5, 0.04 * W);
    float spine = (1.0 - smoothstep(sw - fw.x, sw + fw.x, sx)) * clear;
    float climb = 0.4 + 0.6 * sc_pulse(yAbs / 26.0 - uTime * 0.3, 0.5, fw.y / 26.0);
    col = mix(col, vTrimB.rgb * (1.35 * climb * uGlow), spine);
    col += vTrimA.rgb * (sb_tube(sx - sw - 1.6, 0.35, fw.x) * clear * gain);
    // Every tier ends in a broad band of light under its parapet.
    col += mix(vTrimA.rgb, vec3(1.3), 0.3) * (sc_line(et - 5.0, 1.5, fw.y) * 0.85 * gain);
  }
  return col;
}
`;

export const BUILDINGS_FRAG = SC_COMMON + SB_SHARED + SB_PANELS + SB_STREET + SB_TOPS + SB_FACADE + /* glsl */ `
void main() {
  vec3 p = vPu.xyz;
  vec2 raw = vec2(vPu.w, vNv.w);
  vec2 fw = max(fwidth(raw), vec2(1e-4));
  // Under MSAA a pixel on a silhouette is shaded at its centre, outside the triangle, so the
  // interpolated face coordinate overshoots, by hundreds of metres on a face seen edge-on.
  vec2 uv = clamp(raw, vec2(0.0), vFace.xy);
  vec3 n = normalize(vNv.xyz);
  vec3 v = p - vec3(0.0, cameraPosition.y, 0.0);
  vec3 vn = v / max(length(v), 1e-3);
  float style = vSeed.z;
  vec3 col;
  if (vFace.z > SB_FACE_TOP) col = sb_roof(uv, fw);
  else if (sb_is(style, SB_CROWN)) col = sb_crown(uv, fw);
  else if (sb_is(style, SB_SPIRE)) col = sb_spire(uv, fw);
  else col = sb_facade(uv, fw, vn, n);
  // A last guard: one runaway pixel would be smeared over the whole frame by the bloom.
  col = clamp(col, vec3(0.0), vec3(12.0));
  gl_FragColor = vec4(sc_fog(col, p), 1.0);
}
`;
