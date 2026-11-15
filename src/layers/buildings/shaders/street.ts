// Rooms behind the glass and shop fronts at street level (plan T05, M2 and M3).
export const SB_STREET = /* glsl */ `
// Interior mapping: what a ray through a window hits inside a box-shaped room. No geometry, no loop.
// f: where the ray enters, 0..1 across and up the room front. room: width, height, depth in metres.
// vt: view direction in face space (x right, y up, z into the wall, z > 0).
// Returns the hit point in room units (z = 1 is the back wall) and which surface it is:
// 0 back wall, 1 ceiling, 2 floor, 3 side wall.
vec4 sb_roomHit(vec2 f, vec3 room, vec3 vt) {
  vec3 rd = vt / room;
  rd = vec3(abs(rd.x) < 1e-5 ? 1e-5 : rd.x, abs(rd.y) < 1e-5 ? 1e-5 : rd.y, max(rd.z, 1e-5));
  vec3 ro = vec3(clamp(f, 0.0, 1.0), 0.0);
  vec3 tt = (step(vec3(0.0), rd) - ro) / rd;
  float t = min(tt.x, min(tt.y, tt.z));
  float surface = t == tt.z ? 0.0 : t == tt.y ? (rd.y > 0.0 ? 1.0 : 2.0) : 3.0;
  return vec4(ro + rd * t, surface);
}

// Brightness of an office or a flat seen through its window, about 0.85 on average:
// a lit ceiling with strips, a dim floor, walls falling off with depth. h: a random 0..1.
float sb_room(vec2 f, vec3 room, vec3 vt, float h) {
  vec4 hit = sb_roomHit(f, room, vt);
  vec3 hp = hit.xyz;
  float s;
  if (hit.w < 0.5) {
    // Back wall, with a bright doorway on some.
    float door = step(abs(hp.x - 0.3 - 0.4 * h), 0.14) * step(hp.y, 0.72);
    s = 0.6 + 0.3 * hp.y + 0.55 * door * step(h, 0.6);
  } else if (hit.w < 1.5) {
    s = 1.0 + 0.8 * step(fract(hp.z * 2.5 + h), 0.45);
  } else if (hit.w < 2.5) {
    s = 0.3;
  } else {
    s = (0.42 + 0.3 * hp.y) * (0.75 + 0.5 * step(fract(hp.z * 2.0 + h), 0.5));
  }
  return s * mix(1.2, 0.5, hp.z);
}

// A shop seen through its window: ceiling strips, a floor that picks up the light, and a back wall
// of posters and shelves in loud colours.
vec3 sb_shopRoom(vec2 f, vec3 room, vec3 vt, vec3 light, float bay, float seed) {
  vec4 hit = sb_roomHit(f, room, vt);
  vec3 hp = hit.xyz;
  vec3 c;
  if (hit.w < 0.5) {
    vec2 dg = hp.xy * vec2(max(2.0, floor(room.x / 1.5)), 3.0);
    vec2 di = floor(dg);
    vec2 df = dg - di;
    vec3 hd = sc_hash33(vec3(di.x + 16.0 * di.y, bay, seed));
    float inside = step(0.1, df.x) * step(df.x, 0.9) * step(0.12, df.y) * step(df.y, 0.88);
    vec3 poster = sb_even(sc_neon(floor(hd.x * 7.0)), 0.5) * (0.3 + 0.9 * hd.y);
    c = mix(light * 0.3, poster, inside * step(0.3, hd.z));
  } else if (hit.w < 1.5) {
    c = light * (0.75 + 1.1 * step(fract(hp.z * 3.0 + 0.2), 0.4));
  } else if (hit.w < 2.5) {
    c = light * (0.22 + 0.25 * (1.0 - hp.z));
  } else {
    // Side walls: shelves of goods in mixed colours.
    vec2 sg = vec2(hp.z * max(2.0, floor(room.z / 1.2)), hp.y * 4.0);
    vec2 si = floor(sg);
    vec2 sf = sg - si;
    vec3 hd = sc_hash33(vec3(si.x + 16.0 * si.y, bay + 0.5, seed));
    float goods = step(0.12, sf.x) * step(sf.x, 0.88) * step(0.18, sf.y) * step(sf.y, 0.3 + 0.6 * hd.y);
    vec3 item = sb_even(sc_neon(floor(hd.x * 7.0)), 0.5) * (0.35 + 0.6 * hd.z);
    c = mix(light * (0.28 + 0.3 * hp.y), item, goods * step(hp.y, 0.75));
  }
  return c * mix(1.25, 0.6, hp.z);
}

// Distance to the outline of an equilateral triangle of "radius" r, point up.
float sb_triangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return length(p);
}

// The shop front along the bottom of a street-level box. cover: share of the pixel under the band.
vec3 sb_shop(vec2 uv, vec2 fw, vec3 vt, out float cover) {
  float hS = vShop.x, bayW = vShop.y, seed = vShop.z, signH = vShop.w;
  cover = clamp((hS - uv.y) / fw.y + 0.5, 0.0, 1.0);
  float fwm = max(fw.x, fw.y);
  float bay = floor(uv.x / bayW);
  float bu = uv.x - bay * bayW;
  vec3 h1 = sc_hash33(vec3(bay, 3.0, seed));
  vec3 h2 = sc_hash33(vec3(bay, 9.0, seed));
  float i1 = floor(h1.x * 7.0);
  float i2 = mod(i1 + 1.0 + floor(h1.y * 5.0), 7.0);
  vec3 c1 = sb_even(sc_neon(i1), 0.5);
  vec3 c2 = sb_even(sc_neon(i2), 0.75);
  float near = sc_detail(bayW, fwm * 9.0);

  // Glass between piers, from a low plinth up to the sign. A third of the shops are lit white,
  // the rest soak in one colour.
  float pier = 0.3;
  float glassTop = max(hS - signH - 0.6, 1.0);
  float gx = sc_pulse((uv.x - pier) / bayW, 1.0 - 2.0 * pier / bayW, fw.x / bayW);
  float gy = clamp((uv.y - 0.45) / fw.y + 0.5, 0.0, 1.0) * clamp((glassTop - uv.y) / fw.y + 0.5, 0.0, 1.0);
  vec3 light = h1.z < 0.33 ? vec3(1.0, 0.86, 0.68) * (0.9 + 0.25 * h2.y) : mix(vec3(1.0, 0.82, 0.6), c1, 0.88) * (0.6 + 0.4 * h2.y);
  vec3 inside = light * 0.8;
  float shape = 0.0;
  if (near > 0.01) {
    inside = sb_shopRoom(vec2(bu / bayW, uv.y / glassTop), vec3(bayW, glassTop, 7.0), vt, light, bay, seed);
    // The window display: goods standing behind the glass, seen as dark shapes against the light.
    float column = floor(bu / 0.55);
    float tall = sc_hash21(vec2(column, seed + bay));
    float goods = step(uv.y - 0.45, (0.08 + 0.3 * tall * tall) * glassTop) * step(0.25, tall) * step(fract(bu / 0.55), 0.82);
    inside *= 1.0 - 0.8 * goods;
    // Glazing bars and a transom.
    float bars = 2.0 + floor(h2.z * 3.0);
    float bx = (fract(bu / bayW * bars + 0.5) - 0.5) * bayW / bars;
    float frame = max(sc_line(bx, 0.05, fw.x), sc_line(uv.y - 0.72 * glassTop, 0.05, fw.y));
    inside = mix(light * 0.8, inside * (1.0 - 0.85 * frame), near);
    // A neon shape hung in the window: ring, triangle or diamond.
    vec2 sp = vec2(bu - 0.5 * bayW, uv.y - 0.42 * glassTop);
    float r = 0.24 * min(bayW, glassTop);
    float d = h2.x < 0.2 ? abs(length(sp) - r) : h2.x < 0.38 ? sb_triangle(sp, r) : h2.x < 0.52 ? abs(abs(sp.x) + abs(sp.y) - r) : 1e3;
    shape = sb_tube(d, 0.055, fwm) * near;
  }
  vec3 col = vec3(0.016, 0.01, 0.04);
  col = mix(col, inside, gx * gy);
  col += c2 * (shape * gx * gy * 2.4 * uGlow);

  // The sign strip above the glass: glyphs, tubes, a light box, or a chase of bulbs.
  float sy0 = glassTop + 0.3, sy1 = hS - 0.3;
  float sh = max(sy1 - sy0, 0.2);
  float margin = 0.5 + 1.2 * h2.z;
  float sgy = clamp((uv.y - sy0) / fw.y + 0.5, 0.0, 1.0) * clamp((sy1 - uv.y) / fw.y + 0.5, 0.0, 1.0);
  float sgx = sc_pulse((uv.x - margin) / bayW, 1.0 - 2.0 * margin / bayW, fw.x / bayW);
  float pitch = sh / 9.0;
  vec2 q = vec2(bu - margin, uv.y - sy0) / pitch;
  vec2 gf = fw / pitch;
  float fine = sc_detail(1.0, max(gf.x, gf.y) * 0.5);
  float amount;
  if (h1.y < 0.4) {
    float led = sc_pulse(q.x - 0.1, 0.8, gf.x) * sc_pulse(q.y - 0.1, 0.8, gf.y);
    float glyph = sb_glyph(vec2(floor(q.x), clamp(floor(q.y), 0.0, 8.0)), bay, seed);
    amount = mix(0.3, glyph * led, fine);
  } else if (h1.y < 0.6) {
    float d = uv.y - 0.5 * (sy0 + sy1);
    amount = max(sc_line(d - 0.25 * sh, 0.1 * sh, fw.y), sc_line(d + 0.25 * sh, 0.1 * sh, fw.y));
  } else if (h1.y < 0.8) {
    // Light box: a bright plate with the glyphs cut out of it.
    float glyph = sb_glyph(vec2(floor(q.x * 0.75), clamp(floor(q.y), 0.0, 8.0)), bay, seed);
    amount = 0.62 * (1.0 - 0.9 * glyph * fine);
  } else {
    // Theatre bulbs chasing round a dark plate.
    float step3 = floor(uTime * 4.0 * (0.3 + 0.7 * uMotion));
    float bulbs = step(mod(floor(q.x * 0.5) + step3, 3.0), 0.5) * sc_pulse(q.x * 0.5 - 0.15, 0.7, gf.x * 0.5);
    float rows = max(sc_line(q.y - 1.5, 0.8, gf.y), sc_line(q.y - 7.5, 0.8, gf.y));
    amount = mix(0.25, bulbs * rows + 0.5 * sc_line(q.y - 4.5, 0.5, gf.y), fine);
  }
  float blink = 1.0;
  if (h1.z > 0.8) blink = mix(0.8, 0.3 + 0.7 * step(0.3, fract(uTime * (0.6 + h2.z) + h2.y * 9.0)), uMotion);
  col += c2 * (amount * sgx * sgy * 2.1 * blink * uGlow);
  // The sign lights the fascia round it.
  col += c2 * (0.05 * sgx * clamp((uv.y - glassTop) / 0.6, 0.0, 1.0));
  return col;
}
`;
