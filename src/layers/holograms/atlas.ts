// The ad atlas (plan T09, M1): every advert, drawn with Canvas 2D once at start-up. No image files.
//
// The canvas does not hold finished colours. It holds three INKS, one per channel, and the panel
// shader turns them into light:   red = the panel's first palette colour (ink A),
// green = its second (ink B), blue = white-hot. So one advert appears in many colourways, and a mood
// that re-tints the palette re-tints every billboard. Yellow (#ff0) is both inks at once, magenta
// (#f0f) is ink A plus white, and so on. Black is "no light".
//
// Every brand here is invented. Text uses generic font stacks only and is squeezed to fit its box,
// so a machine with different fonts still gets a laid-out advert.
import { createRng, type Rng } from '../../core/random';
import { ATLAS_SIZE, CELL_PAD, type AtlasCell } from './layout';

type G = CanvasRenderingContext2D;
type Ad = (g: G, rng: Rng) => void;

const A = '#ff0000';
const B = '#00ff00';
const W = '#0000ff';
const AW = '#ff00ff';
/** Ink A warmed with a little white: for large hot areas, where full AW would bloom to a white blob. */
const AH = '#ff0078';
const BW = '#00ffff';
/** Ink B with a little white, for the tops of large gradient lettering. */
const BH = '#00ff80';
const AB = '#ffff00';
const K = '#000000';
/** Dim versions, for large fills that must stay under the bloom threshold. */
const A2 = '#c00000';
const B2 = '#00c000';
const A3 = '#800000';
const B3 = '#008000';

const SANS = 'system-ui, sans-serif';
const MONO = 'ui-monospace, monospace';
const TAU = Math.PI * 2;

interface TextStyle {
  size: number;
  weight?: number;
  italic?: boolean;
  /** Letter spacing in em. */
  track?: number;
  align?: 'left' | 'center' | 'right';
  /** Fill ink; null draws the outline only. */
  fill?: string | null;
  /** Two or more inks for a top-to-bottom gradient fill, evenly spaced; overrides fill. */
  grad?: readonly string[];
  stroke?: string;
  strokeWidth?: number;
  /** The text is squeezed sideways to fit this width. */
  maxWidth?: number;
  /** Sideways scale, applied before maxWidth. */
  stretch?: number;
  mono?: boolean;
  /** Measure only. */
  dry?: boolean;
}

/** Draw one line of text with y at the middle of the capitals. Returns the width it took. */
function type(g: G, s: string, x: number, y: number, st: TextStyle): number {
  g.save();
  g.font = `${st.italic ? 'italic ' : ''}${st.weight ?? 800} ${st.size}px ${st.mono ? MONO : SANS}`;
  const track = (st.track ?? 0) * st.size;
  g.letterSpacing = `${track}px`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  const natural = Math.max(1, g.measureText(s).width - track);
  let sx = st.stretch ?? 1;
  if (st.maxWidth !== undefined && natural * sx > st.maxWidth) sx = st.maxWidth / natural;
  const drawn = natural * sx;
  if (!st.dry) {
    const align = st.align ?? 'left';
    g.translate(align === 'center' ? x - drawn / 2 : align === 'right' ? x - drawn : x, y + st.size * 0.36);
    g.scale(sx, 1);
    g.lineJoin = 'round';
    if (st.stroke !== undefined) {
      g.strokeStyle = st.stroke;
      g.lineWidth = st.strokeWidth ?? st.size * 0.09;
      g.strokeText(s, 0, 0);
    }
    if (st.grad) {
      const grad = g.createLinearGradient(0, -st.size * 0.74, 0, 0);
      const n = st.grad.length - 1;
      for (let i = 0; i <= n; i++) grad.addColorStop(n > 0 ? i / n : 0, st.grad[i]!);
      g.fillStyle = grad;
      g.fillText(s, 0, 0);
    } else if (st.fill !== null) {
      g.fillStyle = st.fill ?? W;
      g.fillText(s, 0, 0);
    }
  }
  g.restore();
  return drawn;
}

/** Letters stacked downwards, for the tall banners. */
function stack(g: G, s: string, x: number, y0: number, step: number, st: TextStyle): void {
  for (let i = 0; i < s.length; i++) type(g, s[i]!, x, y0 + i * step, { ...st, align: 'center' });
}

function rr(g: G, x: number, y: number, w: number, h: number, r: number): void {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

function poly(g: G, pts: readonly number[]): void {
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.closePath();
}

function line(g: G, x0: number, y0: number, x1: number, y1: number, ink: string, width: number): void {
  g.strokeStyle = ink;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function disc(g: G, x: number, y: number, r: number, ink: string): void {
  g.fillStyle = ink;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

function ring(g: G, x: number, y: number, r: number, ink: string, width: number): void {
  g.strokeStyle = ink;
  g.lineWidth = width;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.stroke();
}

function vgrad(g: G, y0: number, y1: number, top: string, bottom: string): CanvasGradient {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  return grad;
}

function hgrad(g: G, x0: number, x1: number, left: string, right: string): CanvasGradient {
  const grad = g.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0, left);
  grad.addColorStop(1, right);
  return grad;
}

/** The striped sun: a gradient disc with horizontal cuts that widen towards the bottom. */
function sun(g: G, cx: number, cy: number, r: number, top: string, bottom: string, cuts = 6): void {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.clip();
  g.fillStyle = vgrad(g, cy - r, cy + r, top, bottom);
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.fillStyle = K;
  for (let i = 0; i < cuts; i++) {
    const t = i / (cuts - 1);
    g.fillRect(cx - r, cy + r * (0.02 + 0.86 * t), r * 2, r * (0.035 + 0.085 * t));
  }
  g.restore();
}

/** A perspective floor grid between the horizon y0 and y1. */
function floorGrid(g: G, x0: number, x1: number, y0: number, y1: number, ink: string, width: number): void {
  g.save();
  g.beginPath();
  g.rect(x0, y0, x1 - x0, y1 - y0);
  g.clip();
  const cx = (x0 + x1) / 2;
  for (let i = -14; i <= 14; i++) line(g, cx + i * 12, y0, cx + i * 70, y1, ink, width);
  for (let i = 0; i < 7; i++) {
    const t = Math.pow((i + 0.35) / 7, 1.9);
    line(g, x0, y0 + (y1 - y0) * t, x1, y0 + (y1 - y0) * t, ink, width);
  }
  g.restore();
}

/** Chevrons pointing right, starting at x; size is their height. */
function chevrons(g: G, x: number, y: number, size: number, count: number, ink: string, gap = 0.62): void {
  g.fillStyle = ink;
  const t = size * 0.34;
  for (let i = 0; i < count; i++) {
    const px = x + i * size * gap;
    poly(g, [px, y - size / 2, px + t, y - size / 2, px + t + size * 0.42, y, px + t, y + size / 2, px, y + size / 2, px + size * 0.42, y]);
    g.fill();
  }
}

function palm(g: G, x: number, y: number, h: number, lean: number, ink: string): void {
  const tx = x + lean * h * 0.3, ty = y - h;
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = 'round';
  g.lineWidth = h * 0.05;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + lean * h * 0.02, y - h * 0.55, tx, ty);
  g.stroke();
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * (0.03 + (0.94 * i) / 6);
    const len = h * (0.5 + 0.08 * Math.cos(i * 2.4));
    const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.5 + len * 0.34;
    const mx = tx + Math.cos(a) * len * 0.5, my = ty + Math.sin(a) * len * 0.62;
    g.beginPath();
    g.moveTo(tx, ty);
    g.quadraticCurveTo(mx, my - len * 0.16, ex, ey);
    g.quadraticCurveTo(mx, my + len * 0.1, tx, ty);
    g.fill();
  }
  g.lineCap = 'butt';
}

/** A block skyline standing on y, with windows punched out. */
function skyline(g: G, x0: number, x1: number, y: number, maxH: number, rng: Rng, ink: string): void {
  let x = x0;
  while (x < x1) {
    const w = rng.range(14, 34), h = maxH * rng.range(0.25, 1);
    g.fillStyle = ink;
    g.fillRect(x, y - h, Math.min(w, x1 - x), h);
    if (rng.chance(0.4)) g.fillRect(x + w / 2 - 1, y - h - rng.range(6, 18), 2, 18);
    g.fillStyle = K;
    for (let wy = y - h + 5; wy < y - 4; wy += 7) {
      for (let wx = x + 4; wx < x + w - 5; wx += 6) if (rng.chance(0.45)) g.fillRect(wx, wy, 3, 3);
    }
    x += w + rng.range(1, 4);
  }
}

function burst(g: G, cx: number, cy: number, r: number, spikes: number, ink: string): void {
  g.fillStyle = ink;
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.74;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}

/** A rounded badge with text knocked out of it (filled) or drawn inside it (outlined). */
function badge(g: G, x: number, y: number, w: number, h: number, text: string, ink: string, filled: boolean): void {
  rr(g, x, y, w, h, h * 0.28);
  if (filled) {
    g.fillStyle = ink;
    g.fill();
  } else {
    g.strokeStyle = ink;
    g.lineWidth = Math.max(2, h * 0.09);
    g.stroke();
  }
  type(g, text, x + w / 2, y + h / 2, { size: h * 0.56, weight: 900, track: 0.12, align: 'center', fill: filled ? K : ink, maxWidth: w * 0.84 });
}

function bars(g: G, x: number, y: number, w: number, h: number, count: number, rng: Rng, top: string, bottom: string): void {
  const step = w / count;
  g.fillStyle = vgrad(g, y - h, y, top, bottom);
  for (let i = 0; i < count; i++) {
    const bh = h * (0.2 + 0.8 * Math.abs(Math.sin(i * 0.9 + rng.range(0, 1.2))));
    for (let s = 0; s < bh; s += 7) g.fillRect(x + i * step, y - s - 5, step * 0.68, 5);
  }
}

/** Invented signage glyphs: strokes on a 3 x 3 lattice. They are shapes, so they need no font. */
const GLYPH_SEGMENTS: readonly (readonly [number, number])[] = [
  [0, 2], [3, 5], [6, 8], [0, 1], [4, 5], [7, 8], [0, 6], [1, 7], [2, 8], [1, 4], [5, 8], [3, 6], [2, 4], [4, 6], [0, 4], [4, 8],
];
function glyph(g: G, x: number, y: number, s: number, rng: Rng, ink: string): void {
  g.strokeStyle = ink;
  g.lineWidth = s * 0.15;
  g.lineCap = 'square';
  const n = rng.int(3, 4);
  const start = rng.int(0, GLYPH_SEGMENTS.length - 1);
  g.beginPath();
  for (let k = 0; k < n; k++) {
    const [p, q] = GLYPH_SEGMENTS[(start + k * rng.int(2, 5)) % GLYPH_SEGMENTS.length]!;
    g.moveTo(x + (p % 3) * s * 0.5, y + Math.floor(p / 3) * s * 0.5);
    g.lineTo(x + (q % 3) * s * 0.5, y + Math.floor(q / 3) * s * 0.5);
  }
  g.stroke();
  g.lineCap = 'butt';
}
function glyphRun(g: G, x: number, y: number, s: number, count: number, rng: Rng, ink: string, vertical = false): void {
  for (let i = 0; i < count; i++) glyph(g, vertical ? x : x + i * s * 1.5, vertical ? y + i * s * 1.5 : y, s, rng, ink);
}

/** A field of dots that shrink from one side to the other. */
function halftone(g: G, x: number, y: number, w: number, h: number, ink: string, pitch = 9): void {
  g.fillStyle = ink;
  for (let j = 0; j * pitch < h; j++) {
    for (let i = 0; i * pitch < w; i++) {
      const r = pitch * 0.46 * (1 - (i * pitch) / w);
      if (r < 0.5) continue;
      g.beginPath();
      g.arc(x + i * pitch + (j % 2) * pitch * 0.5, y + j * pitch, r, 0, TAU);
      g.fill();
    }
  }
}

/** Marquee bulbs round a rectangle. */
function bulbs(g: G, x: number, y: number, w: number, h: number, pitch: number, on: string, off: string): void {
  const nx = Math.round(w / pitch), ny = Math.round(h / pitch);
  let k = 0;
  const bulb = (px: number, py: number): void => disc(g, px, py, pitch * 0.24, k++ % 2 === 0 ? on : off);
  for (let i = 0; i < nx; i++) bulb(x + (i * w) / nx, y);
  for (let i = 0; i < ny; i++) bulb(x + w, y + (i * h) / ny);
  for (let i = 0; i < nx; i++) bulb(x + w - (i * w) / nx, y + h);
  for (let i = 0; i < ny; i++) bulb(x, y + h - (i * h) / ny);
}

const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
function pixels(g: G, rows: readonly string[], x: number, y: number, s: number, ink: string): void {
  g.fillStyle = ink;
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j]!;
    for (let i = 0; i < row.length; i++) if (row[i] === 'X') g.fillRect(x + i * s, y + j * s, s - 1, s - 1);
  }
}

function can(g: G, cx: number, cy: number, w: number, h: number, tilt: number): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(tilt);
  const body = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  body.addColorStop(0, A2);
  body.addColorStop(0.3, AH);
  body.addColorStop(0.55, A);
  body.addColorStop(1, A3);
  rr(g, -w / 2, -h / 2, w, h, w * 0.16);
  g.fillStyle = body;
  g.fill();
  g.fillStyle = W;
  g.fillRect(-w * 0.42, -h / 2, w * 0.84, h * 0.03);
  g.fillRect(-w * 0.42, h / 2 - h * 0.03, w * 0.84, h * 0.03);
  g.fillStyle = K;
  g.beginPath();
  g.moveTo(-w / 2, h * 0.02);
  g.bezierCurveTo(-w * 0.15, -h * 0.2, w * 0.15, h * 0.22, w / 2, -h * 0.06);
  g.lineTo(w / 2, h * 0.14);
  g.bezierCurveTo(w * 0.15, h * 0.42, -w * 0.15, 0, -w / 2, h * 0.22);
  g.closePath();
  g.fill();
  g.strokeStyle = B;
  g.lineWidth = w * 0.07;
  g.beginPath();
  g.moveTo(-w / 2, h * 0.12);
  g.bezierCurveTo(-w * 0.15, -h * 0.1, w * 0.15, h * 0.32, w / 2, h * 0.04);
  g.stroke();
  g.restore();
}

function bowl(g: G, cx: number, cy: number, r: number): void {
  // Steam.
  g.strokeStyle = W;
  g.lineWidth = r * 0.07;
  g.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const x = cx + i * r * 0.42;
    g.beginPath();
    g.moveTo(x, cy - r * 0.3);
    g.bezierCurveTo(x - r * 0.25, cy - r * 0.62, x + r * 0.25, cy - r * 0.86, x, cy - r * 1.2);
    g.stroke();
  }
  // Noodles over the rim, then chopsticks.
  g.strokeStyle = AB;
  g.lineWidth = r * 0.06;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.arc(cx - r * 0.6 + i * r * 0.3, cy - r * 0.02, r * 0.2, Math.PI, TAU);
    g.stroke();
  }
  line(g, cx + r * 0.1, cy - r * 0.05, cx + r * 1.15, cy - r * 0.85, W, r * 0.06);
  line(g, cx + r * 0.3, cy - r * 0.02, cx + r * 1.25, cy - r * 0.68, W, r * 0.06);
  g.lineCap = 'butt';
  // The bowl.
  g.fillStyle = vgrad(g, cy, cy + r * 0.8, A, A2);
  g.beginPath();
  g.moveTo(cx - r, cy);
  g.lineTo(cx + r, cy);
  g.bezierCurveTo(cx + r * 0.95, cy + r * 0.62, cx + r * 0.5, cy + r * 0.78, cx + r * 0.36, cy + r * 0.78);
  g.lineTo(cx - r * 0.36, cy + r * 0.78);
  g.bezierCurveTo(cx - r * 0.5, cy + r * 0.78, cx - r * 0.95, cy + r * 0.62, cx - r, cy);
  g.fill();
  g.fillStyle = B;
  g.fillRect(cx - r * 0.86, cy + r * 0.22, r * 1.72, r * 0.1);
  g.fillStyle = A;
  g.fillRect(cx - r * 0.42, cy + r * 0.8, r * 0.84, r * 0.12);
}

function car(g: G, x: number, y: number, w: number): void {
  const h = w * 0.3;
  const px = (u: number): number => x + u * w, py = (v: number): number => y - h + v * h;
  g.fillStyle = hgrad(g, x, x + w, A, AH);
  g.beginPath();
  g.moveTo(px(0), py(0.78));
  g.lineTo(px(0.03), py(0.5));
  g.lineTo(px(0.27), py(0.4));
  g.lineTo(px(0.43), py(0.06));
  g.lineTo(px(0.66), py(0.04));
  g.lineTo(px(0.8), py(0.36));
  g.lineTo(px(0.97), py(0.46));
  g.lineTo(px(1), py(0.78));
  g.closePath();
  g.fill();
  g.fillStyle = K;
  poly(g, [px(0.45), py(0.13), px(0.64), py(0.11), px(0.74), py(0.36), px(0.33), py(0.4)]);
  g.fill();
  g.fillRect(px(0.555), py(0.1), w * 0.012, h * 0.3);
  line(g, px(0.05), py(0.6), px(0.96), py(0.6), K, h * 0.035);
  for (const u of [0.2, 0.78]) {
    disc(g, px(u), py(0.8), h * 0.25, K);
    ring(g, px(u), py(0.8), h * 0.18, W, h * 0.05);
    disc(g, px(u), py(0.8), h * 0.05, W);
  }
  // Tail light and the headlight's throw.
  g.fillStyle = W;
  g.fillRect(px(0.005), py(0.5), w * 0.03, h * 0.07);
  g.fillStyle = hgrad(g, px(0.97), px(1.22), BW, K);
  poly(g, [px(0.98), py(0.48), px(1.22), py(0.34), px(1.22), py(0.78), px(0.98), py(0.56)]);
  g.fill();
}

function cassette(g: G, x: number, y: number, w: number): void {
  const h = w * 0.62;
  rr(g, x, y, w, h, w * 0.04);
  g.strokeStyle = W;
  g.lineWidth = w * 0.022;
  g.stroke();
  rr(g, x + w * 0.08, y + h * 0.12, w * 0.84, h * 0.54, w * 0.03);
  g.fillStyle = A2;
  g.fill();
  g.fillStyle = A;
  g.fillRect(x + w * 0.08, y + h * 0.12, w * 0.84, h * 0.1);
  g.fillStyle = AB;
  g.fillRect(x + w * 0.08, y + h * 0.22, w * 0.84, h * 0.035);
  rr(g, x + w * 0.2, y + h * 0.32, w * 0.6, h * 0.26, h * 0.13);
  g.fillStyle = K;
  g.fill();
  for (const u of [0.32, 0.68]) {
    ring(g, x + w * u, y + h * 0.45, h * 0.085, B, w * 0.02);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + u * 5;
      line(g, x + w * u, y + h * 0.45, x + w * u + Math.cos(a) * h * 0.075, y + h * 0.45 + Math.sin(a) * h * 0.075, B, w * 0.012);
    }
  }
  g.fillStyle = B2;
  g.fillRect(x + w * 0.41, y + h * 0.4, w * 0.18, h * 0.1);
  g.strokeStyle = W;
  g.lineWidth = w * 0.016;
  poly(g, [x + w * 0.2, y + h, x + w * 0.26, y + h * 0.78, x + w * 0.74, y + h * 0.78, x + w * 0.8, y + h]);
  g.stroke();
  for (const u of [0.34, 0.44, 0.56, 0.66]) disc(g, x + w * u, y + h * 0.89, w * 0.014, W);
}

function planet(g: G, cx: number, cy: number, r: number): void {
  const tilt = -0.32;
  const ringHalf = (start: number, end: number): void => {
    g.strokeStyle = B;
    g.lineWidth = r * 0.13;
    g.beginPath();
    g.ellipse(cx, cy, r * 1.75, r * 0.42, tilt, start, end);
    g.stroke();
    g.strokeStyle = W;
    g.lineWidth = r * 0.03;
    g.beginPath();
    g.ellipse(cx, cy, r * 1.52, r * 0.34, tilt, start, end);
    g.stroke();
  };
  ringHalf(Math.PI, TAU);
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.clip();
  g.fillStyle = vgrad(g, cy - r, cy + r, AH, A2);
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.fillStyle = K;
  for (let i = 0; i < 4; i++) g.fillRect(cx - r, cy - r * 0.5 + i * r * 0.42, r * 2, r * (0.04 + i * 0.025));
  g.restore();
  ringHalf(0, Math.PI);
}

function bolt(g: G, cx: number, cy: number, h: number): void {
  const p = (u: number, v: number): [number, number] => [cx + u * h, cy + v * h];
  const pts = [...p(0.1, -0.5), ...p(-0.26, 0.06), ...p(-0.04, 0.06), ...p(-0.14, 0.5), ...p(0.28, -0.1), ...p(0.05, -0.1), ...p(0.2, -0.5)];
  poly(g, pts);
  g.fillStyle = vgrad(g, cy - h / 2, cy + h / 2, AH, A);
  g.fill();
  g.strokeStyle = B;
  g.lineWidth = h * 0.03;
  g.lineJoin = 'miter';
  g.stroke();
}

function eye(g: G, cx: number, cy: number, w: number): void {
  const h = w * 0.3;
  g.beginPath();
  g.moveTo(cx - w / 2, cy);
  g.quadraticCurveTo(cx, cy - h * 1.9, cx + w / 2, cy);
  g.quadraticCurveTo(cx, cy + h * 1.9, cx - w / 2, cy);
  g.closePath();
  g.strokeStyle = W;
  g.lineWidth = w * 0.03;
  g.stroke();
  g.save();
  g.clip();
  disc(g, cx, cy, h * 0.92, A2);
  for (let i = 0; i < 3; i++) ring(g, cx, cy, h * (0.92 - i * 0.24), i === 1 ? AW : A, w * 0.022);
  disc(g, cx, cy, h * 0.3, K);
  disc(g, cx - h * 0.28, cy - h * 0.3, h * 0.13, W);
  g.restore();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    line(g, cx + Math.cos(a) * w * 0.56, cy + Math.sin(a) * h * 1.4, cx + Math.cos(a) * w * 0.63, cy + Math.sin(a) * h * 1.75, B, w * 0.02);
  }
}

function moon(g: G, cx: number, cy: number, r: number, ink: string): void {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.arc(cx + r * 0.45, cy - r * 0.2, r * 0.86, 0, TAU, true);
  g.clip('evenodd');
  disc(g, cx, cy, r, ink);
  g.restore();
}

function speedLines(g: G, x0: number, x1: number, y0: number, y1: number, rng: Rng, ink: string): void {
  for (let y = y0; y < y1; y += 9) {
    const a = rng.range(x0, x0 + (x1 - x0) * 0.6), len = rng.range(30, (x1 - x0) * 0.5);
    line(g, a, y, Math.min(x1, a + len), y, ink, rng.range(1.5, 4));
  }
}

// ---------------------------------------------------------------------------------------------
// Radio station parts. The five stations (SUNSET FM and the four below) share big italic
// frequency numerals, an FM tag and a genre line; each has its own motif.

/** An FM tuning scale, 88 to 108, with its needle on freq. */
function dial(g: G, x: number, y: number, w: number, freq: number, ink: string, needle: string): void {
  const at = (f: number): number => x + ((f - 88) / 20) * w;
  line(g, x, y, x + w, y, ink, 2);
  for (let f = 88; f <= 108; f++) {
    const major = f % 4 === 0;
    line(g, at(f), y, at(f), y - (major ? 9 : 5), ink, major ? 2 : 1.2);
    if (major) type(g, String(f), at(f), y + 10, { size: 10, weight: 700, align: 'center', fill: ink, mono: true });
  }
  line(g, at(freq), y - 16, at(freq), y + 4, needle, 3);
  disc(g, at(freq), y - 17, 3.5, needle);
}

/** Big frequency numerals with a small FM tag after them. Returns the right edge. */
function frequency(g: G, s: string, x: number, y: number, size: number, maxWidth: number, st: Partial<TextStyle>, tag: string): number {
  const style: TextStyle = { size, weight: 900, italic: true, maxWidth, ...st };
  const w = type(g, s, x, y, style);
  type(g, 'FM', x + w + 8, y + size * 0.18, { size: size * 0.28, weight: 900, italic: true, track: 0.1, fill: tag });
  return x + w;
}

/**
 * Shift a horizontal slice of what is already drawn sideways, like a torn video line. Works in
 * canvas pixels (putImageData ignores the transform and clip), so dx must keep it inside the cell.
 */
function tear(g: G, x: number, y: number, w: number, h: number, dx: number): void {
  const m = g.getTransform();
  const sx = Math.round(m.e + x), sy = Math.round(m.f + y);
  const slice = g.getImageData(sx, sy, Math.round(w), Math.round(h));
  g.putImageData(slice, sx + Math.round(dx), sy);
}

/** A faceted crystal shard: facets in dim inks round a ridge, edges white-hot. */
function shard(g: G, pts: readonly number[], ridge: readonly [number, number], inks: readonly string[]): void {
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    poly(g, [ridge[0], ridge[1], pts[i * 2]!, pts[i * 2 + 1]!, pts[j * 2]!, pts[j * 2 + 1]!]);
    g.fillStyle = inks[i % inks.length]!;
    g.fill();
  }
  g.lineJoin = 'miter';
  poly(g, pts);
  g.strokeStyle = W;
  g.lineWidth = 2.5;
  g.stroke();
  for (let i = 0; i < n; i++) line(g, ridge[0], ridge[1], pts[i * 2]!, pts[i * 2 + 1]!, i % 2 === 0 ? AW : A, 1.4);
}

/** A fluted classical column standing on y, top at y - h. */
function column(g: G, cx: number, y: number, h: number, w: number, ink: string, cap: string): void {
  g.fillStyle = cap;
  g.fillRect(cx - w * 0.8, y - h, w * 1.6, h * 0.05);
  g.fillRect(cx - w * 0.66, y - h * 0.95, w * 1.32, h * 0.035);
  ring(g, cx - w * 0.62, y - h * 0.9, w * 0.17, cap, 2);
  ring(g, cx + w * 0.62, y - h * 0.9, w * 0.17, cap, 2);
  g.fillStyle = ink;
  g.fillRect(cx - w / 2, y - h * 0.9, w, h * 0.84);
  g.fillStyle = K;
  for (let i = 1; i < 4; i++) g.fillRect(cx - w / 2 + (i * w) / 4 - 1, y - h * 0.86, 2, h * 0.76);
  g.fillStyle = cap;
  g.fillRect(cx - w * 0.68, y - h * 0.06, w * 1.36, h * 0.03);
  g.fillRect(cx - w * 0.8, y - h * 0.03, w * 1.6, h * 0.03);
}

/** A chequered floor in perspective between the horizon y0 and y1. */
function checkerFloor(g: G, x0: number, x1: number, y0: number, y1: number, tile: number, inkA: string, inkB: string): void {
  g.save();
  g.beginPath();
  g.rect(x0, y0, x1 - x0, y1 - y0);
  g.clip();
  const cx = (x0 + x1) / 2, rows = 6;
  const yAt = (v: number): number => y0 + (y1 - y0) * Math.pow(v, 1.7);
  const sAt = (y: number): number => 0.18 + 0.82 * ((y - y0) / (y1 - y0));
  const half = Math.ceil(((x1 - x0) / 2) / (tile * 0.18)) + 1;
  for (let j = 0; j < rows; j++) {
    const ya = yAt(j / rows), yb = yAt((j + 1) / rows), sa = sAt(ya), sb = sAt(yb);
    for (let i = -half; i < half; i++) {
      poly(g, [cx + i * tile * sa, ya, cx + (i + 1) * tile * sa, ya, cx + (i + 1) * tile * sb, yb, cx + i * tile * sb, yb]);
      g.fillStyle = ((i + j) & 1) === 0 ? inkA : inkB;
      g.fill();
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Wide adverts, 512 x 256.

const WIDE_ADS: readonly Ad[] = [
  // OBSIDIAN 93.3, darksynth: a black crystal, torn video lines, nearly all ink A.
  (g, rng) => {
    for (let y = 22; y < 236; y += 11) {
      if (!rng.chance(0.55)) continue;
      const x0 = rng.range(14, 120);
      line(g, x0, y, x0 + rng.range(20, 90), y, rng.chance(0.3) ? AW : A3, rng.range(2, 5));
    }
    shard(g, [92, 16, 150, 74, 140, 186, 84, 244, 34, 166, 50, 62], [96, 122], [A3, K, A2, K, A3, A2]);
    poly(g, [158, 150, 182, 176, 160, 214]);
    g.fillStyle = A2;
    g.fill();
    poly(g, [24, 32, 44, 44, 30, 70]);
    g.fillStyle = A3;
    g.fill();
    type(g, 'OBSIDIAN', 194, 40, { size: 50, weight: 900, italic: true, track: 0.04, fill: A, stroke: W, strokeWidth: 2.5, stretch: 0.86, maxWidth: 300 });
    type(g, '93.3', 186, 116, { size: 108, weight: 900, italic: true, fill: B2, maxWidth: 236 });
    frequency(g, '93.3', 190, 116, 108, 236, { grad: [AW, A, A2], stroke: K, strokeWidth: 4 }, W);
    line(g, 194, 172, 498, 172, A, 3);
    dial(g, 194, 210, 236, 93.3, A, W);
    badge(g, 442, 188, 56, 28, 'LIVE', A, true);
    type(g, 'DARKSYNTH ALL NIGHT', 194, 236, { size: 13, weight: 800, track: 0.34, fill: W, mono: true, maxWidth: 304 });
    tear(g, 186, 88, 312, 7, 9);
    tear(g, 186, 132, 312, 4, -7);
    tear(g, 20, 104, 160, 6, 8);
  },
  // HYPERLINE
  (g, rng) => {
    speedLines(g, 14, 330, 20, 76, rng, A2);
    chevrons(g, 340, 48, 54, 4, B, 0.7);
    type(g, 'HYPERLINE', 256, 112, { size: 74, weight: 900, italic: true, track: 0.04, align: 'center', fill: W, stroke: A, strokeWidth: 9, maxWidth: 470 });
    g.fillStyle = hgrad(g, 20, 492, A, B);
    g.fillRect(20, 152, 472, 5);
    // The train: a long pill with a tapered nose and a window strip.
    g.fillStyle = hgrad(g, 20, 400, A3, AH);
    g.beginPath();
    g.moveTo(14, 178);
    g.lineTo(330, 178);
    g.quadraticCurveTo(388, 180, 412, 206);
    g.lineTo(14, 206);
    g.closePath();
    g.fill();
    g.fillStyle = K;
    for (let x = 26; x < 320; x += 22) g.fillRect(x, 184, 15, 7);
    poly(g, [334, 184, 362, 186, 384, 198, 334, 198]);
    g.fill();
    line(g, 14, 212, 500, 212, B, 2);
    type(g, 'MAGLEV', 498, 182, { size: 15, weight: 800, track: 0.2, align: 'right', fill: B, maxWidth: 76 });
    type(g, 'EXPRESS', 498, 200, { size: 15, weight: 800, track: 0.2, align: 'right', fill: B, maxWidth: 76 });
    type(g, 'DOWNTOWN IN 4 MIN', 256, 232, { size: 17, weight: 700, track: 0.3, align: 'center', fill: W, mono: true, maxWidth: 470 });
  },
  // VELVET 97.1, chillwave: a crescent moon over still water, soft gradients, light wide type.
  (g, rng) => {
    // Sky: a dim glow round the moon that fades to nothing, and a few stars.
    const glow = g.createRadialGradient(112, 86, 30, 112, 100, 118);
    glow.addColorStop(0, A3);
    glow.addColorStop(1, K);
    g.fillStyle = glow;
    g.fillRect(14, 14, 208, 144);
    for (let i = 0; i < 16; i++) disc(g, rng.range(20, 216), rng.range(20, 120), rng.range(0.8, 1.8), i % 3 === 0 ? BW : W);
    // The moon: a soft halo, then the crescent in a gradient.
    for (let i = 0; i < 4; i++) ring(g, 112, 86, 50 + i * 9, i % 2 === 0 ? A3 : B3, 2);
    g.save();
    g.beginPath();
    g.arc(112, 86, 46, 0, TAU);
    g.clip();
    g.beginPath();
    g.rect(60, 36, 104, 104);
    g.arc(132, 74, 40, 0, TAU);
    g.clip('evenodd');
    g.fillStyle = vgrad(g, 40, 132, W, AH);
    g.fillRect(60, 36, 104, 104);
    g.restore();
    line(g, 16, 158, 220, 158, B, 2);
    // Its reflection: stripes that shorten and break up with depth.
    for (let i = 0; i < 9; i++) {
      const y = 166 + i * 8.5, half = 40 - i * 3.6, wob = Math.sin(i * 1.7) * 6;
      line(g, 112 - half + wob, y, 112 + half * 0.3 + wob, y, i % 2 === 0 ? AH : A2, 3 - i * 0.2);
      line(g, 112 + half * 0.45 + wob, y, 112 + half + wob, y, A2, 2.5 - i * 0.2);
    }
    for (let i = 0; i < 5; i++) line(g, 18 + i * 9, 170 + i * 15, 70 + i * 4, 170 + i * 15, B3, 2);
    for (let i = 0; i < 5; i++) line(g, 160 - i * 4, 176 + i * 14, 216 - i * 6, 176 + i * 14, B3, 2);
    type(g, 'velvet', 362, 44, { size: 54, weight: 400, track: 0.32, align: 'center', fill: W, maxWidth: 262 });
    line(g, 244, 82, 480, 82, B2, 1.5);
    frequency(g, '97.1', 246, 132, 96, 196, { weight: 600, italic: false, grad: [BH, B, B2] }, A);
    type(g, 'CHILLWAVE / LATE HOURS', 362, 190, { size: 14, weight: 600, track: 0.36, align: 'center', fill: AH, maxWidth: 252 });
    rr(g, 300, 210, 124, 28, 14);
    g.strokeStyle = B;
    g.lineWidth = 2;
    g.stroke();
    disc(g, 318, 224, 5, A);
    type(g, 'ON AIR', 372, 224, { size: 15, weight: 600, track: 0.3, align: 'center', fill: W, maxWidth: 80 });
  },
  // SUNSET FM 88.8
  (g, rng) => {
    sun(g, 118, 118, 92, AH, A, 6);
    line(g, 14, 214, 226, 214, B, 2);
    type(g, 'SUNSET FM', 240, 46, { size: 46, weight: 900, italic: true, fill: W, maxWidth: 258 });
    type(g, '88.8', 236, 122, { size: 112, weight: 900, italic: true, grad: [BH, B], stroke: K, maxWidth: 262 });
    badge(g, 242, 188, 104, 40, 'ON AIR', A, true);
    bars(g, 362, 230, 136, 46, 12, rng, AB, A);
    type(g, 'ALL NIGHT SYNTH', 120, 234, { size: 13, weight: 700, track: 0.28, align: 'center', fill: B, maxWidth: 210 });
  },
  // ZEPHYRA MOTORS
  (g) => {
    floorGrid(g, 12, 500, 168, 244, B2, 1.6);
    line(g, 12, 168, 500, 168, B, 2.5);
    car(g, 70, 190, 300);
    type(g, 'ZEPHYRA', 256, 42, { size: 52, weight: 900, track: 0.3, align: 'center', fill: W, maxWidth: 440 });
    type(g, 'MOTORS', 256, 82, { size: 17, weight: 700, track: 0.9, align: 'center', fill: B, maxWidth: 300 });
    line(g, 60, 82, 150, 82, A, 2);
    line(g, 362, 82, 452, 82, A, 2);
    type(g, 'VECTOR GT', 498, 208, { size: 24, weight: 900, italic: true, align: 'right', fill: A, stroke: K, strokeWidth: 6, maxWidth: 120 });
    type(g, 'TWIN TURBO', 498, 232, { size: 13, weight: 700, track: 0.2, align: 'right', fill: W, stroke: K, strokeWidth: 5, mono: true, maxWidth: 120 });
  },
  // STARPORT 101.5, spacesynth: a star at the vanishing point, lasers converging on it, chrome type.
  (g, rng) => {
    const vx = 112, vy = 120;
    for (let i = 0; i < 70; i++) {
      const x = rng.range(14, 498), y = rng.range(14, 242);
      if (x > 200 && y > 40 && y < 200) continue;
      disc(g, x, y, rng.range(0.7, 1.7), rng.chance(0.25) ? BW : W);
    }
    // Lasers: bright near the star, dim where they run behind the type.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.1;
      const ex = vx + Math.cos(a) * 420, ey = vy + Math.sin(a) * 420;
      g.strokeStyle = hgrad(g, vx, ex, i % 2 === 0 ? A : B, K);
      g.lineWidth = i % 4 === 0 ? 3 : 1.6;
      g.beginPath();
      g.moveTo(vx, vy);
      g.lineTo(ex, ey);
      g.stroke();
    }
    for (let i = 0; i < 4; i++) ring(g, vx, vy, 30 * Math.pow(1.6, i), i % 2 === 0 ? B3 : A3, 1.6);
    burst(g, vx, vy, 52, 8, A2);
    burst(g, vx, vy, 40, 16, AB);
    burst(g, vx, vy, 22, 4, W);
    disc(g, vx, vy, 9, W);
    chevrons(g, 152, 214, 26, 3, B, 0.7);
    type(g, 'STARPORT', 206, 48, { size: 56, weight: 900, italic: true, grad: [W, BW, B3, B, BH], stroke: W, strokeWidth: 1.5, maxWidth: 292 });
    frequency(g, '101.5', 208, 124, 96, 236, { grad: [AH, A, A2], stroke: W, strokeWidth: 2.5 }, B);
    type(g, 'SPACESYNTH NONSTOP', 210, 180, { size: 17, weight: 800, italic: true, track: 0.22, fill: W, maxWidth: 288 });
    dial(g, 210, 216, 220, 101.5, B, AW);
    badge(g, 446, 196, 52, 28, 'ON', A, true);
  },
  // PLAZA 104.3, mallsoft: columns under an arch, a chequered floor, letters spaced wide.
  (g) => {
    checkerFloor(g, 12, 500, 196, 246, 46, A3, B3);
    line(g, 12, 196, 500, 196, B, 2);
    column(g, 48, 196, 176, 26, B3, W);
    column(g, 464, 196, 176, 26, B3, W);
    g.strokeStyle = A2;
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(256, 34, 196, 18, 0, Math.PI, TAU);
    g.stroke();
    line(g, 60, 34, 452, 34, A2, 3);
    type(g, 'P L A Z A', 256, 62, { size: 34, weight: 400, track: 0.3, align: 'center', fill: W, maxWidth: 330 });
    frequency(g, '104.3', 104, 128, 86, 220, { grad: [AH, A], stroke: W, strokeWidth: 2 }, B);
    // A potted palm, as in every atrium.
    palm(g, 410, 142, 62, 0.2, B2);
    poly(g, [390, 140, 428, 140, 422, 158, 396, 158]);
    g.fillStyle = A2;
    g.fill();
    line(g, 388, 140, 430, 140, W, 2);
    type(g, 'MALLSOFT / OPEN TIL CLOSE', 256, 180, { size: 14, weight: 700, track: 0.3, align: 'center', fill: AH, mono: true, maxWidth: 330 });
  },
  // ORBIT AIRLINES
  (g) => {
    planet(g, 112, 138, 56);
    g.strokeStyle = hgrad(g, 150, 480, A2, AW);
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(206, 212);
    g.quadraticCurveTo(452, 214, 480, 48);
    g.stroke();
    poly(g, [488, 26, 486, 66, 470, 50, 448, 46]);
    g.fillStyle = W;
    g.fill();
    type(g, 'ORBIT', 216, 84, { size: 96, weight: 900, italic: true, fill: W, stroke: A, strokeWidth: 8, maxWidth: 226 });
    type(g, 'AIRLINES', 220, 146, { size: 26, weight: 800, track: 0.5, fill: B, maxWidth: 200 });
    type(g, 'FLY THE NEON SKY', 222, 178, { size: 14, weight: 700, track: 0.24, fill: W, maxWidth: 170 });
    type(g, 'GATE 88 / NOW BOARDING', 498, 234, { size: 13, weight: 700, track: 0.12, align: 'right', fill: AB, mono: true, maxWidth: 230 });
  },
  // CLUB COSTA NEON
  (g) => {
    sun(g, 132, 132, 70, AB, A, 5);
    for (let i = 0; i < 6; i++) {
      const y = 208 + i * 6, half = 108 - i * 15;
      line(g, 132 - half, y, 132 + half, y, i % 2 === 0 ? B : B2, 2.5);
    }
    palm(g, 62, 206, 150, 0.5, K);
    palm(g, 62, 206, 150, 0.5, B2);
    palm(g, 204, 206, 112, -0.45, B2);
    type(g, 'COSTA', 250, 76, { size: 92, weight: 900, italic: true, fill: A, stroke: W, strokeWidth: 5, maxWidth: 250 });
    type(g, 'NEON', 262, 150, { size: 86, weight: 900, italic: true, fill: null, stroke: BW, strokeWidth: 5, track: 0.08, maxWidth: 236 });
    type(g, 'BEACH CLUB / SUBLEVEL 3', 252, 216, { size: 15, weight: 700, track: 0.2, fill: W, maxWidth: 246 });
  },
  // STRATA TOWERS
  (g, rng) => {
    skyline(g, 14, 498, 244, 92, rng, A2);
    g.fillStyle = vgrad(g, 70, 244, BW, B2);
    poly(g, [392, 244, 392, 96, 410, 70, 428, 96, 428, 244]);
    g.fill();
    g.fillStyle = K;
    for (let y = 104; y < 240; y += 9) g.fillRect(397, y, 26, 3);
    line(g, 410, 70, 410, 40, W, 2);
    disc(g, 410, 38, 4, W);
    type(g, 'LIVE ABOVE', 20, 50, { size: 50, weight: 900, italic: true, fill: W, maxWidth: 330 });
    type(g, 'IT ALL', 20, 100, { size: 50, weight: 900, italic: true, fill: A, stroke: W, strokeWidth: 4, maxWidth: 250 });
    type(g, 'STRATA TOWERS', 22, 142, { size: 20, weight: 800, track: 0.34, fill: B, stroke: K, strokeWidth: 6, maxWidth: 300 });
    burst(g, 462, 54, 40, 14, AB);
    type(g, 'LEVEL', 462, 44, { size: 13, weight: 900, align: 'center', fill: K, maxWidth: 52 });
    type(g, '400', 462, 62, { size: 22, weight: 900, align: 'center', fill: K, maxWidth: 52 });
  },
  // MIRA-9
  (g) => {
    for (let i = 0; i < 5; i++) ring(g, 112, 128, 22 + i * 17, i % 2 === 0 ? A : B2, i === 0 ? 6 : 2.5);
    disc(g, 112, 128, 11, W);
    g.strokeStyle = BW;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 14; x <= 210; x += 4) {
      const k = Math.exp(-Math.pow((x - 112) / 52, 2));
      g.lineTo(x, 128 + Math.sin(x * 0.42) * 28 * k);
    }
    g.stroke();
    type(g, 'MIRA', 228, 78, { size: 104, weight: 900, fill: W, stroke: A, strokeWidth: 8, stretch: 1.1, maxWidth: 216 });
    type(g, '9', 456, 62, { size: 60, weight: 900, italic: true, fill: AB, maxWidth: 44 });
    type(g, 'PERSONAL A.I. COMPANION', 230, 148, { size: 16, weight: 800, track: 0.2, fill: B, maxWidth: 268 });
    line(g, 230, 168, 498, 168, A2, 2);
    type(g, 'SHE REMEMBERS EVERYTHING', 230, 192, { size: 17, weight: 700, italic: true, fill: W, maxWidth: 268 });
    type(g, 'NOW IN EVERY HOME', 230, 222, { size: 12, weight: 700, track: 0.3, fill: A, mono: true, maxWidth: 268 });
  },
  // MEGAMALL
  (g) => {
    chevrons(g, 16, 70, 96, 3, A2, 0.5);
    chevrons(g, 148, 70, 96, 1, A, 0.5);
    type(g, 'MEGAMALL', 244, 62, { size: 60, weight: 900, italic: true, fill: W, stroke: A, strokeWidth: 7, maxWidth: 254 });
    type(g, 'LEVEL 88', 246, 110, { size: 24, weight: 800, track: 0.4, fill: B, maxWidth: 250 });
    burst(g, 88, 184, 56, 16, AB);
    type(g, 'SALE', 88, 170, { size: 22, weight: 900, align: 'center', fill: K, maxWidth: 80 });
    type(g, '-50%', 88, 196, { size: 30, weight: 900, align: 'center', fill: K, maxWidth: 84 });
    g.fillStyle = hgrad(g, 170, 498, B, A);
    g.fillRect(170, 150, 328, 5);
    type(g, 'EVERYTHING.', 172, 186, { size: 30, weight: 900, fill: A, maxWidth: 200 });
    type(g, 'ALWAYS.', 380, 186, { size: 30, weight: 900, fill: B, maxWidth: 118 });
    type(g, '4000 SHOPS / 9 FOOD COURTS / 1 SKY', 172, 224, { size: 13, weight: 700, track: 0.1, fill: W, mono: true, maxWidth: 326 });
  },
  // KILOVOLT ENERGY
  (g) => {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      line(g, 104 + Math.cos(a) * 62, 128 + Math.sin(a) * 62, 104 + Math.cos(a) * (i % 2 === 0 ? 106 : 84), 128 + Math.sin(a) * (i % 2 === 0 ? 106 : 84), B2, 3);
    }
    bolt(g, 104, 128, 196);
    halftone(g, 384, 24, 118, 60, A2, 10);
    type(g, 'KILOVOLT', 206, 96, { size: 88, weight: 900, italic: true, fill: AB, stroke: K, strokeWidth: 4, maxWidth: 290 });
    type(g, 'ENERGY DRINK', 210, 152, { size: 26, weight: 800, track: 0.3, fill: W, maxWidth: 284 });
    g.fillStyle = hgrad(g, 210, 498, A, B);
    g.fillRect(210, 176, 288, 5);
    type(g, 'STAY UP FOREVER', 210, 208, { size: 22, weight: 900, italic: true, fill: B, maxWidth: 284 });
  },
  // MAGNETA TAPES
  (g) => {
    // The three-band corner stripe.
    g.save();
    g.beginPath();
    g.rect(12, 12, 488, 232);
    g.clip();
    const inks = [A, AB, B];
    for (let i = 0; i < 3; i++) {
      g.fillStyle = inks[i]!;
      poly(g, [300 + i * 26, 12, 322 + i * 26, 12, 142 + i * 26, 244, 120 + i * 26, 244]);
      g.fill();
    }
    g.restore();
    g.fillStyle = K;
    g.fillRect(24, 50, 220, 152);
    cassette(g, 30, 60, 208);
    type(g, 'MAGNETA', 498, 66, { size: 54, weight: 900, align: 'right', fill: W, stroke: K, strokeWidth: 12, maxWidth: 226 });
    type(g, 'CHROME C-90', 498, 112, { size: 22, weight: 800, track: 0.2, align: 'right', fill: B, stroke: K, strokeWidth: 8, maxWidth: 200 });
    type(g, 'RECORD', 498, 176, { size: 34, weight: 900, italic: true, align: 'right', fill: A, stroke: K, strokeWidth: 8, maxWidth: 170 });
    type(g, 'THE NIGHT', 498, 214, { size: 34, weight: 900, italic: true, align: 'right', fill: W, stroke: K, strokeWidth: 8, maxWidth: 170 });
  },
  // OKU OPTICS
  (g, rng) => {
    eye(g, 120, 118, 196);
    type(g, 'OKU', 250, 86, { size: 124, weight: 900, fill: A, stroke: W, strokeWidth: 5, stretch: 1.1, maxWidth: 244 });
    type(g, 'OPTICS', 254, 160, { size: 30, weight: 800, track: 0.62, fill: B, maxWidth: 240 });
    type(g, 'SEE IN NEON', 120, 220, { size: 18, weight: 800, track: 0.3, align: 'center', fill: W, maxWidth: 196 });
    glyphRun(g, 258, 196, 18, 9, rng, AB);
    for (const [x, y] of [[20, 20], [492, 20], [20, 236], [492, 236]] as const) {
      line(g, x - 6, y, x + 6, y, W, 2);
      line(g, x, y - 6, x, y + 6, W, 2);
    }
  },
  // GRAVBALL FINALS
  (g) => {
    halftone(g, 14, 62, 150, 120, A3, 11);
    g.save();
    g.translate(498, 0);
    g.scale(-1, 1);
    halftone(g, 0, 62, 150, 120, B3, 11);
    g.restore();
    type(g, 'GRAVBALL FINALS', 256, 34, { size: 26, weight: 900, track: 0.34, align: 'center', fill: W, maxWidth: 460 });
    line(g, 24, 56, 488, 56, AB, 2);
    type(g, 'CRIMSON', 20, 122, { size: 60, weight: 900, italic: true, fill: A, stroke: W, strokeWidth: 4, maxWidth: 188 });
    type(g, 'COBALT', 492, 122, { size: 60, weight: 900, italic: true, align: 'right', fill: B, stroke: W, strokeWidth: 4, maxWidth: 188 });
    poly(g, [256, 76, 302, 122, 256, 168, 210, 122]);
    g.fillStyle = K;
    g.fill();
    g.strokeStyle = AB;
    g.lineWidth = 4;
    g.stroke();
    type(g, 'VS', 256, 122, { size: 44, weight: 900, italic: true, align: 'center', fill: W, maxWidth: 62 });
    badge(g, 108, 192, 84, 38, 'LIVE', A, true);
    type(g, 'TONIGHT / CHANNEL 404', 204, 211, { size: 22, weight: 800, track: 0.14, fill: W, maxWidth: 290 });
  },
];

// ---------------------------------------------------------------------------------------------
// Tall adverts, 256 x 512.

function arrowDown(g: G, cx: number, y: number, size: number, ink: string): void {
  g.fillStyle = ink;
  poly(g, [cx - size * 0.2, y, cx + size * 0.2, y, cx + size * 0.2, y + size * 0.5, cx + size * 0.5, y + size * 0.5, cx, y + size, cx - size * 0.5, y + size * 0.5, cx - size * 0.2, y + size * 0.5]);
  g.fill();
}

const TALL_ADS: readonly Ad[] = [
  // KIRO
  (g, rng) => {
    stack(g, 'KIRO', 112, 62, 78, { size: 92, weight: 900, fill: A, stroke: W, strokeWidth: 5, maxWidth: 130 });
    glyphRun(g, 206, 34, 20, 9, rng, AB, true);
    line(g, 190, 26, 190, 304, A2, 2);
    bowl(g, 124, 424, 58);
    type(g, 'NOODLE BAR', 128, 488, { size: 20, weight: 800, track: 0.2, align: 'center', fill: B, maxWidth: 220 });
  },
  // HOTEL
  (g) => {
    moon(g, 128, 50, 24, W);
    stack(g, 'HOTEL', 128, 128, 60, { size: 70, weight: 900, grad: [BH, B], maxWidth: 110 });
    line(g, 44, 96, 44, 396, A, 3);
    line(g, 212, 96, 212, 396, A, 3);
    badge(g, 38, 404, 180, 40, 'VACANCY', A, true);
    arrowDown(g, 128, 452, 46, AB);
  },
  // ARCADE
  (g) => {
    bulbs(g, 24, 24, 208, 464, 18, W, A2);
    stack(g, 'ARCADE', 128, 72, 54, { size: 62, weight: 900, fill: A, stroke: W, strokeWidth: 4, maxWidth: 110 });
    pixels(g, HEART, 93, 392, 10, AW);
    type(g, 'OPEN ALL NIGHT', 128, 474, { size: 13, weight: 700, track: 0.16, align: 'center', fill: B, mono: true, maxWidth: 180 });
  },
  // NOVA COLA
  (g) => {
    type(g, 'NOVA', 128, 56, { size: 76, weight: 900, italic: true, align: 'center', fill: A, stroke: W, strokeWidth: 4, maxWidth: 216 });
    can(g, 128, 262, 116, 268, 0.12);
    for (const [x, y, r] of [[40, 150, 8], [222, 190, 6], [34, 300, 5], [226, 330, 10], [48, 392, 7], [212, 120, 4]] as const) ring(g, x, y, r, B, 2.5);
    type(g, 'COLA', 128, 444, { size: 76, weight: 900, italic: true, align: 'center', grad: [BH, B], maxWidth: 216 });
    type(g, 'ICE COLD', 128, 492, { size: 14, weight: 700, track: 0.4, align: 'center', fill: W, maxWidth: 200 });
  },
  // OPEN 25 HRS
  (g) => {
    type(g, 'OPEN', 128, 50, { size: 50, weight: 900, track: 0.2, align: 'center', fill: W, maxWidth: 210 });
    ring(g, 128, 176, 84, A, 7);
    ring(g, 128, 176, 68, B2, 2.5);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      line(g, 128 + Math.cos(a) * 56, 176 + Math.sin(a) * 56, 128 + Math.cos(a) * 64, 176 + Math.sin(a) * 64, W, i % 3 === 0 ? 4 : 2);
    }
    line(g, 128, 176, 128, 128, W, 5);
    line(g, 128, 176, 162, 196, AB, 5);
    disc(g, 128, 176, 6, W);
    type(g, '25', 128, 338, { size: 150, weight: 900, italic: true, align: 'center', fill: A, stroke: W, strokeWidth: 5, maxWidth: 216 });
    type(g, 'HRS', 128, 436, { size: 56, weight: 900, track: 0.3, align: 'center', grad: [BH, B], maxWidth: 200 });
    type(g, 'WE NEVER CLOSE', 128, 488, { size: 13, weight: 700, track: 0.2, align: 'center', fill: W, mono: true, maxWidth: 210 });
  },
  // SUNSET FM
  (g, rng) => {
    sun(g, 128, 122, 92, AH, A, 6);
    palm(g, 62, 256, 150, 0.4, K);
    palm(g, 62, 256, 150, 0.4, B2);
    line(g, 20, 256, 236, 256, B, 2.5);
    type(g, '88.8', 128, 310, { size: 96, weight: 900, italic: true, align: 'center', grad: [BH, B], maxWidth: 212 });
    type(g, 'SUNSET FM', 128, 374, { size: 30, weight: 900, italic: true, align: 'center', fill: W, maxWidth: 212 });
    bars(g, 30, 452, 196, 44, 14, rng, AB, A);
    badge(g, 68, 462, 120, 34, 'ON AIR', A, true);
  },
  // A column of invented signage
  (g, rng) => {
    rr(g, 26, 26, 204, 460, 14);
    g.strokeStyle = A2;
    g.lineWidth = 3;
    g.stroke();
    glyphRun(g, 52, 52, 56, 5, rng, A, true);
    glyphRun(g, 150, 52, 56, 5, rng, BW, true);
    line(g, 128, 44, 128, 440, B2, 2);
    type(g, 'LEVEL 88', 128, 466, { size: 18, weight: 800, track: 0.3, align: 'center', fill: W, maxWidth: 180 });
  },
  // CLUB PARALLAX
  (g, rng) => {
    type(g, 'CLUB', 128, 44, { size: 34, weight: 800, track: 0.6, align: 'center', fill: W, maxWidth: 200 });
    for (let i = 0; i < 5; i++) {
      const s = 96 - i * 19;
      poly(g, [128, 170 - s, 128 + s * 0.92, 170 + s * 0.6, 128 - s * 0.92, 170 + s * 0.6]);
      g.strokeStyle = i % 2 === 0 ? A : B;
      g.lineWidth = i === 0 ? 6 : 3;
      g.stroke();
    }
    g.save();
    g.translate(128, 318);
    type(g, 'PARALLAX', 0, 0, { size: 50, weight: 900, italic: true, align: 'center', fill: AW, stroke: W, strokeWidth: 3, maxWidth: 216 });
    g.restore();
    bars(g, 26, 440, 204, 76, 13, rng, B, A);
    type(g, 'DANCE TIL DAWN', 128, 476, { size: 17, weight: 800, track: 0.22, align: 'center', fill: W, maxWidth: 210 });
  },
];

// ---------------------------------------------------------------------------------------------
// Ticker strips, 2048 x 128. Each is a run of items laid end to end, then scaled so the run fills
// the strip exactly and the text wraps without a seam.

/** Draws itself with its left edge at x and returns its width. With dry it only measures. */
type Item = (g: G, x: number, dry: boolean) => number;

const STRIP_Y = 64;
const word = (s: string, ink: string, extra: Partial<TextStyle> = {}): Item => (g, x, dry) =>
  type(g, s, x, STRIP_Y, { size: 78, weight: 800, fill: ink, ...extra, dry }) + 30;
const space = (w: number): Item => () => w;
const arrowItem = (up: boolean, ink: string): Item => (g, x, dry) => {
  if (!dry) {
    g.fillStyle = ink;
    poly(g, up ? [x, STRIP_Y + 24, x + 26, STRIP_Y - 26, x + 52, STRIP_Y + 24] : [x, STRIP_Y - 24, x + 26, STRIP_Y + 26, x + 52, STRIP_Y - 24]);
    g.fill();
  }
  return 70;
};
const chevronItem = (count: number, ink: string): Item => (g, x, dry) => {
  if (!dry) chevrons(g, x, STRIP_Y, 62, count, ink, 0.62);
  return count * 62 * 0.62 + 50;
};
const diamondItem = (ink: string): Item => (g, x, dry) => {
  if (!dry) {
    g.fillStyle = ink;
    poly(g, [x + 22, STRIP_Y - 22, x + 44, STRIP_Y, x + 22, STRIP_Y + 22, x, STRIP_Y]);
    g.fill();
  }
  return 76;
};
const glyphItem = (count: number, ink: string, rng: Rng): Item => (g, x, dry) => {
  if (!dry) glyphRun(g, x, STRIP_Y - 26, 52, count, rng, ink);
  return count * 78 + 20;
};
const quote = (name: string, up: boolean, value: string): Item[] => [
  word(name, W, { mono: true, weight: 700 }), arrowItem(up, up ? B : A), word(value, up ? B : A, { mono: true, weight: 700 }), space(50),
];

function stripItems(index: number, rng: Rng): Item[] {
  switch (index) {
    case 0:
      return [
        ...quote('NVC', true, '88.08'), ...quote('HYPR', false, '12.40'), ...quote('KIRO', true, '3.33'),
        ...quote('ORBT', false, '4.10'), ...quote('KVLT', true, '125.0'),
      ];
    case 1:
      return [
        word('GRAVBALL FINALS TONIGHT', W), diamondItem(A), word('SKYLANE 4 DELAYS', AB), diamondItem(A),
        word('RAIN OF LIGHT AT MIDNIGHT', B), diamondItem(A), word('OBSIDIAN 93.3 FM', AW, { italic: true, weight: 900 }), diamondItem(A),
      ];
    case 2:
      return [
        chevronItem(3, A), word('NOVA COLA', A, { italic: true, weight: 900 }), chevronItem(3, B),
        word('HYPERLINE', W, { italic: true, weight: 900 }), chevronItem(3, A), word('KIRO NOODLE BAR', B, { weight: 900 }),
        chevronItem(3, B), word('KILOVOLT', AB, { italic: true, weight: 900 }),
      ];
    default:
      return [
        glyphItem(4, A, rng), word('WELCOME TO THE CITY THAT NEVER DIMS', W, { track: 0.06 }), glyphItem(4, B, rng),
        chevronItem(4, AB), word('LEVEL 400 SKY DECK', B), chevronItem(4, AB),
      ];
  }
}

function drawStrip(g: G, index: number, seed: number, width: number): void {
  let total = 0;
  for (const item of stripItems(index, createRng(seed))) total += item(g, 0, true);
  g.scale(width / total, 1);
  let x = 0;
  for (const item of stripItems(index, createRng(seed))) x += item(g, x, false);
}

// ---------------------------------------------------------------------------------------------

/** Draw every cell of the layout into the canvas. */
export function drawAtlas(canvas: HTMLCanvasElement, cells: readonly AtlasCell[], seed: number): void {
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  // willReadFrequently keeps the canvas on the CPU: drawing is then synchronous, so the time logged
  // by the layer is the real cost, and the one upload to the GPU needs no read-back.
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('holograms: no 2D canvas context for the ad atlas');
  // Opaque black, so the upload is never un-premultiplied and "no ink" is exactly zero.
  g.fillStyle = K;
  g.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const cell of cells) {
    const rng = createRng(seed + cell.x * 31 + cell.y * 17);
    g.save();
    g.translate(cell.x, cell.y);
    g.beginPath();
    if (cell.kind === 'strip') g.rect(0, CELL_PAD, cell.w, cell.h - 2 * CELL_PAD);
    else g.rect(CELL_PAD, CELL_PAD, cell.w - 2 * CELL_PAD, cell.h - 2 * CELL_PAD);
    g.clip();
    if (cell.kind === 'wide') WIDE_ADS[cell.index % WIDE_ADS.length]!(g, rng);
    else if (cell.kind === 'tall') TALL_ADS[cell.index % TALL_ADS.length]!(g, rng);
    else drawStrip(g, cell.index, seed + cell.index, cell.w);
    g.restore();
  }
}

/** Colour pairs used to preview the inks; the city uses the palette instead. */
const PREVIEW: readonly (readonly [number, number, number, number, number, number])[] = [
  [255, 43, 214, 25, 240, 255],
  [25, 240, 255, 255, 43, 214],
  [155, 77, 255, 255, 122, 26],
  [255, 122, 26, 255, 225, 77],
  [255, 225, 77, 255, 43, 214],
];

/**
 * A review copy of the atlas with the inks turned into colours, for the ?holoAtlas= dump.
 * Each cell gets one of a few colour pairs so the colourways can be judged too.
 */
export function previewAtlas(source: HTMLCanvasElement, cells: readonly AtlasCell[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const src = source.getContext('2d');
  const dst = out.getContext('2d');
  if (!src || !dst) return out;
  const image = src.getImageData(0, 0, source.width, source.height);
  const data = image.data;
  const pairOf = new Uint8Array(source.width * source.height);
  for (let c = 0; c < cells.length; c++) {
    const cell = cells[c]!;
    for (let y = cell.y; y < cell.y + cell.h; y++) pairOf.fill(c % PREVIEW.length, y * source.width + cell.x, y * source.width + cell.x + cell.w);
  }
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const pair = PREVIEW[pairOf[p]!]!;
    const a = data[i]! / 255, b = data[i + 1]! / 255, w = data[i + 2]! / 255;
    data[i] = Math.min(255, a * pair[0] + b * pair[3] + w * 235);
    data[i + 1] = Math.min(255, a * pair[1] + b * pair[4] + w * 245);
    data[i + 2] = Math.min(255, a * pair[2] + b * pair[5] + w * 255);
  }
  dst.putImageData(image, 0, 0);
  return out;
}
