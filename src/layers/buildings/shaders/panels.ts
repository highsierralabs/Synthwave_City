// Animated sign panels (plan T05, M4): LED matrices made from maths. Every pattern is evaluated at
// the centre of an LED, so it is piecewise constant and the only thing left to filter is the LED
// grid itself. Far away the pattern fades to its average brightness.
export const SB_PANELS = /* glsl */ `
// A neon tube: sc_line with a floor under the dimming, so far outlines stay drawn instead of vanishing.
// Seen close, where the tube is several pixels wide, it has a hot core and dimmer shoulders.
float sb_tube(float d, float w, float fw) {
  fw = max(fw, 1e-5);
  float ww = max(w, 0.75 * fw);
  float x = min(abs(d) / ww, 1.0);
  float body = mix(1.0, 0.5 + 0.85 * (1.0 - x * x), clamp(0.5 * w / fw - 0.5, 0.0, 1.0));
  return (1.0 - smoothstep(ww - fw, ww + fw, abs(d))) * body * max(w / ww, 0.3);
}

// One pseudo-glyph pixel: 5 x 7 dots, mirrored left to right so it reads as a character.
// cell: LED index, already scrolled. id: an exact number naming the line of text.
float sb_glyph(vec2 cell, float id, float seed) {
  vec2 gid = floor(cell / vec2(6.0, 9.0));
  vec2 sub = cell - gid * vec2(6.0, 9.0);
  float blank = step(0.2, sc_hash31(vec3(gid.x, gid.y + 64.0 * id, seed)));
  float sx = min(sub.x, 4.0 - sub.x);
  float bit = step(0.45, sc_hash31(vec3(sx + 3.0 * sub.y, gid.x + 64.0 * gid.y + 4096.0 * id, seed)));
  return bit * blank * step(sub.x, 4.5) * step(0.5, sub.y) * step(sub.y, 7.5);
}

// The panel at this fragment. cover: how much of the pixel the panel takes (0 outside).
vec3 sb_panel(vec2 uv, vec2 fw, out float cover) {
  vec2 pm = uv - vPanel.xy;
  vec2 ps = vPanel.zw;
  vec2 e2 = min(pm, ps - pm);
  vec2 cv = clamp(e2 / fw + 0.5, 0.0, 1.0);
  cover = cv.x * cv.y;

  float kind = vPanelK.x;
  float whole = step(SB_WHOLE - 0.5, kind);
  kind -= whole * SB_WHOLE;
  vec2 pitch = vPanelK.yz;
  float seed = vPanelK.w;
  vec2 n = max(vec2(1.0), floor(ps / pitch + 0.5));
  vec2 q = pm / pitch;
  vec2 qi = clamp(floor(q), vec2(0.0), n - 1.0);
  vec2 c01 = (qi + 0.5) / n;
  vec3 hs = sc_hash33(vec3(seed, 71.0, 9.0));
  float t = uTime;
  float pace = 0.3 + 0.7 * uMotion;

  vec3 ca = sb_even(sc_neon(vTrimA.w), 0.75);
  vec3 cb = sb_even(sc_neon(vTrimB.w), 0.75);
  float I = 0.0, tone = 0.0, avg = 0.4, hot = 0.0;

  if (kind < 0.5) {
    // Chevrons marching up or down.
    float per = 6.0 + floor(hs.x * 6.0);
    float ax = abs(qi.x + 0.5 - 0.5 * n.x) * (pitch.x / pitch.y);
    float ph = (qi.y + 0.5 + ax * (hs.z < 0.5 ? 1.0 : -1.0)) / per + t * 0.7 * pace * (hs.y < 0.5 ? 1.0 : -1.0);
    I = step(fract(ph), 0.5);
    tone = mod(floor(ph), 2.0);
    avg = 0.5;
  } else if (kind < 1.5) {
    // Equaliser: bars jump on the beat and fall back.
    float barW = max(1.0, floor(n.x / 12.0 + 0.5));
    float b = floor(qi.x / barW);
    float gap = (whole < 0.5 && barW > 2.5) ? step(mod(qi.x, barW), barW - 1.5) : 1.0;
    float beat = mix(0.6, uBeat.x, uMotion);
    float lv = (0.18 + 0.82 * sc_hash31(vec3(b, uBeat.z, seed))) * (0.42 + 0.58 * beat);
    float rows = floor(lv * n.y + 0.5);
    I = step(qi.y + 0.5, rows) * gap;
    hot = step(rows - 1.5, qi.y) * I;
    tone = c01.y / max(lv, 0.05) * 0.8;
    avg = 0.33;
  } else if (kind < 2.5) {
    // Rings, squares or diamonds growing out of the centre.
    vec2 dl = (qi + 0.5 - 0.5 * n) * vec2(pitch.x / pitch.y, 1.0);
    float r = hs.x < 0.4 ? length(dl) : hs.x < 0.7 ? max(abs(dl.x), abs(dl.y)) : abs(dl.x) + abs(dl.y);
    float ph = r / (5.0 + floor(hs.z * 5.0)) - t * 0.55 * pace;
    I = step(fract(ph), 0.45);
    tone = mod(floor(ph), 2.0);
    avg = 0.45;
  } else if (kind < 3.5) {
    // Wipes: stacked bars sliding against each other.
    float bands = 3.0 + floor(hs.x * 4.0);
    float rb = floor(c01.y * bands);
    float hr = sc_hash31(vec3(rb, 5.0, seed));
    float dir = mod(rb, 2.0) * 2.0 - 1.0;
    float ph = c01.x * (0.6 + hr) + dir * t * (0.1 + 0.22 * hr) * pace + hr * 7.0;
    I = step(fract(ph), 0.5);
    tone = mod(rb + floor(ph), 2.0);
    avg = 0.5;
  } else if (kind < 4.5) {
    // Checker shimmer.
    float cs = whole > 0.5 ? 1.0 : 2.0 + floor(hs.x * 3.0);
    vec2 cc = floor(qi / cs);
    vec3 hk = sc_hash33(vec3(cc, seed));
    float flick = fract(hk.x + 0.618 * floor(t * (0.5 + 1.5 * hk.y) * pace + hk.z * 5.0));
    I = 0.1 + 0.9 * step(0.45, flick);
    tone = mod(cc.x + cc.y, 2.0);
    avg = 0.6;
  } else if (kind < 5.5) {
    // Rain of light: a bright head falling down each column with a tail above it.
    vec3 hk = sc_hash33(vec3(qi.x, 13.0, seed));
    float len = max(6.0, n.y * (0.35 + 0.6 * hk.z));
    float ph = fract((qi.y + 0.5) / len + t * (7.0 + 16.0 * hk.x) * pace / len + hk.y);
    ph = 1.0 - ph;
    I = ph * ph * ph;
    hot = step(0.93, ph);
    tone = step(0.7, hk.z);
    avg = 0.25;
  } else if (kind < 6.5) {
    // The striped sun.
    vec2 dm = (qi + 0.5) * pitch - 0.5 * ps;
    float R = 0.43 * min(ps.x, ps.y);
    float y01 = clamp(0.5 + 0.5 * dm.y / R, 0.0, 1.0);
    float cut = step(fract(y01 * 11.0 - t * 0.18 * pace), mix(0.3, 0.92, clamp(y01 / 0.56, 0.0, 1.0)));
    I = step(length(dm), R) * mix(cut, 1.0, step(0.56, y01));
    tone = y01;
    ca = sb_even(uPalette[0], 0.75);
    cb = sb_even(uPalette[4], 0.75);
    avg = 0.3;
  } else {
    // Lines of invented glyphs scrolling sideways.
    float line = floor(qi.y / 9.0);
    float hl = sc_hash31(vec3(line, 17.0, seed));
    float scroll = floor(t * (5.0 + 9.0 * hl) * pace);
    I = sb_glyph(vec2(qi.x + scroll, qi.y), line, seed);
    tone = mod(line, 2.0);
    avg = 0.25;
  }

  // The LED grid, box-filtered; the pattern gives way to its average once LEDs are sub-pixel.
  vec2 gf = fw / pitch;
  vec2 ld = whole > 0.5 ? vGrid.zw : vec2(0.78);
  float led = sc_pulse(q.x - 0.5 * (1.0 - ld.x), ld.x, gf.x) * sc_pulse(q.y - 0.5 * (1.0 - ld.y), ld.y, gf.y);
  float detail = sc_detail(1.0, max(gf.x, gf.y) * 0.4);
  I = mix(avg, I, detail);
  hot *= detail;
  vec3 pc = mix(ca, cb, clamp(tone, 0.0, 1.0));
  pc = mix(pc, vec3(1.6), hot * 0.7);
  // A framed sign keeps a dark border of one LED inside its frame.
  float inner = whole > 0.5 ? 1.0 : step(0.5, qi.x) * step(qi.x, n.x - 1.5) * step(0.5, qi.y) * step(qi.y, n.y - 1.5);
  vec3 col = vec3(0.012, 0.008, 0.03) + pc * (led * inner * (0.03 + I * 1.45 * uGlow));
  if (whole < 0.5) {
    float e = min(e2.x, e2.y);
    col += cb * (sb_tube(e - 0.3, 0.16, max(fw.x, fw.y)) * 1.7 * uGlow);
  }
  return col;
}
`;
