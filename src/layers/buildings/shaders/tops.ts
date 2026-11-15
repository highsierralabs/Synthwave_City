// Roofs, crowns and spires (plan T05, M3 and M5).
export const SB_TOPS = /* glsl */ `
// Unlit surface colour: deep indigo, never grey, lifted a little by the mood's ambient light.
vec3 sb_wall() { return vec3(0.011, 0.007, 0.032) + uAmbient * 0.45; }

// The top face. uv is metres from one corner; W and H are the footprint.
vec3 sb_roof(vec2 uv, vec2 fw) {
  float W = vFace.x, H = vFace.y;
  float seed = vSeed.x;
  float fwm = max(fw.x, fw.y);
  vec2 c = uv - 0.5 * vec2(W, H);
  float isRound = sb_bit(vFace.w, SB_FLAG_ROUND);
  float isRoof = sb_bit(vFace.w, SB_FLAG_ROOF);
  float e = isRound > 0.5 ? 0.5 * W - length(c) : min(min(uv.x, W - uv.x), min(uv.y, H - uv.y));
  vec3 col = sb_wall() * 1.25;
  if (sb_is(vSeed.z, SB_SPIRE)) return vTrimA.rgb * 1.6 * uGlow;

  // Parapet: a thin outline and its spill on the roof deck.
  float tw = min(vDeco.z, 0.4);
  col += vTrimA.rgb * (sb_tube(e - tw - 0.15, tw * 0.8, fwm) * vDeco.w * 0.7 * uGlow);
  col += vTrimA.rgb * (0.05 * exp(-max(e, 0.0) * 0.7));

  // Plant: a 7 m grid of cooling units, vents and a few small lights, away from the edge.
  vec2 pg = uv / 7.0;
  vec2 pid = floor(pg);
  vec2 pf = pg - pid;
  vec3 hp = sc_hash33(vec3(pid, seed));
  float inside = smoothstep(3.0, 4.0, e);
  float near = sc_detail(7.0, fwm * 3.0);
  vec2 bh = 0.22 + 0.2 * hp.yz;
  vec2 bd = abs(pf - 0.5) - bh;
  float unit = step(hp.x, 0.34) * (1.0 - smoothstep(-0.02, 0.02, max(bd.x, bd.y)));
  float vent = step(fract(pf.y * 9.0), 0.45) * step(0.5, hp.z);
  col += inside * near * unit * (sb_wall() * (1.2 + 1.4 * vent) + vTrimB.rgb * 0.012);
  float lamp = step(0.8, hp.x) * (1.0 - smoothstep(0.03, 0.07, length(pf - 0.3 - 0.4 * hp.yz)));
  vec3 lampCol = hp.y < 0.5 ? vec3(1.0, 0.85, 0.6) : vTrimB.rgb;
  col += inside * lampCol * mix(0.012, lamp * 2.5, sc_detail(1.2, fwm)) * uGlow;

  // Helipad on some of the larger exposed roofs.
  float hpad = sc_hash11(seed + 3.0);
  if (isRoof > 0.5 && min(W, H) > 30.0 && hpad < 0.4) {
    float r = length(c);
    float ring = sc_line(r - 8.0, 0.3, fwm);
    vec2 a = abs(c);
    float bar = max(step(abs(a.x - 2.4), 0.45) * step(a.y, 3.6), step(a.y, 0.45) * step(a.x, 2.4));
    bar *= sc_detail(1.0, fwm);
    vec3 padCol = hpad < 0.2 ? vec3(1.0, 0.8, 0.25) : vTrimB.rgb;
    col = mix(col, sb_wall() * 2.2, (1.0 - smoothstep(8.0, 8.3, r)) * 0.7);
    col += padCol * ((ring * 1.5 + bar * 1.2) * uGlow);
  }
  return col;
}

// The lit cap of a tower: louvres, bars or a chase of segments, glowing in the main colour.
vec3 sb_crown(vec2 uv, vec2 fw) {
  float W = vFace.x, H = vFace.y;
  float variant = vC2.w;
  float mega = sb_bit(vFace.w, SB_FLAG_LANDMARK);
  float isRound = sb_bit(vFace.w, SB_FLAG_ROUND);
  float g = uv.y / H;
  float beat = 1.0 + 0.5 * uBeat.x * uMotion * step(0.5, fract(variant * 5.0));
  float pattern;
  if (variant < 0.4) {
    float s = mix(0.9, 2.0, fract(variant * 13.0));
    pattern = sc_pulse(uv.x / s, 0.55, fw.x / s) * mix(1.25, 0.5, g);
  } else if (variant < 0.7) {
    float s = H / max(2.0, floor(H / 1.4 + 0.5));
    pattern = sc_pulse(uv.y / s + 0.2, 0.5, fw.y / s) * 1.1;
  } else {
    float s = mix(5.0, 10.0, fract(variant * 13.0));
    float run = sc_pulse(uv.x / s - uTime * 0.35 * (0.3 + 0.7 * uMotion), 0.6, fw.x / s);
    pattern = (0.35 + 0.9 * run) * (0.6 + 0.4 * sc_pulse(g * 2.0 + 0.25, 0.5, fw.y / H * 2.0));
  }
  vec3 col = sb_wall() + vTrimA.rgb * (pattern * (0.85 + 0.5 * mega) * beat * uGlow);
  float tw = vDeco.z;
  float eu = min(uv.x, W - uv.x);
  float tube = max(sb_tube(H - uv.y - tw, tw, fw.y), sb_tube(uv.y - tw, tw, fw.y));
  tube = max(tube, (1.0 - isRound) * sb_tube(eu - tw, tw, fw.x));
  col += mix(vTrimB.rgb, vec3(1.5), 0.25 + 0.4 * mega) * (tube * vDeco.w * uGlow);
  return col;
}

// A thin lit mast: a bright core, rings up its length and a pulse climbing it.
vec3 sb_spire(vec2 uv, vec2 fw) {
  float W = vFace.x, H = vFace.y;
  float mega = sb_bit(vFace.w, SB_FLAG_LANDMARK);
  float core = sc_line(uv.x - 0.5 * W, 0.2 * W, fw.x);
  float s = 7.0 + 5.0 * mega;
  float ring = sc_line((fract(uv.y / s + 0.5) - 0.5) * s, 0.35, fw.y) * sc_detail(s, fw.y * 3.0);
  float climb = fract(uv.y / (60.0 + 60.0 * mega) - uTime * 0.25);
  float pulse = climb * climb * climb * climb;
  vec3 col = sb_wall() * 2.0;
  col += vTrimA.rgb * (core * (0.8 + 1.6 * pulse) * uGlow);
  col += mix(vTrimB.rgb, vec3(1.4), 0.5) * (ring * 2.0 * uGlow);
  col += vTrimA.rgb * (0.25 * (1.0 - uv.y / H));
  return col;
}
`;
