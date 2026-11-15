// Declarations shared by the buildings vertex and fragment shaders (plan T05).
//
// The vertex shader turns each box's seeds into a "facade spec": every random choice a facade makes
// (window size, lit share, colours, trim, sign panel, shop front) is decided once per vertex and sent
// down as `flat` varyings. The fragment shader then only evaluates patterns in metres, so its cost
// per pixel is a few hashes whatever the style. Fourteen varying vectors in all: WebGL2 guarantees 15.
import { BOX_FLAG, BOX_STYLE } from '../../../contracts/city';

const f = (n: number): string => `${n}.0`;

export const SB_SHARED = /* glsl */ `
#define SB_PODIUM ${f(BOX_STYLE.podium)}
#define SB_SHAFT ${f(BOX_STYLE.shaft)}
#define SB_GLASS ${f(BOX_STYLE.glass)}
#define SB_SLAB ${f(BOX_STYLE.slab)}
#define SB_STRIP ${f(BOX_STYLE.strip)}
#define SB_CROWN ${f(BOX_STYLE.crown)}
#define SB_SPIRE ${f(BOX_STYLE.spire)}
#define SB_MEGA ${f(BOX_STYLE.mega)}
#define SB_KIOSK ${f(BOX_STYLE.kiosk)}
#define SB_FLAG_ROOF ${f(BOX_FLAG.roof)}
#define SB_FLAG_STREET ${f(BOX_FLAG.street)}
#define SB_FLAG_ROUND ${f(BOX_FLAG.round)}
#define SB_FLAG_LANDMARK ${f(BOX_FLAG.landmark)}
#define SB_FACE_TOP 3.5
// Added to the panel kind when the panel is the whole facade and its "pixels" are the windows.
#define SB_WHOLE 16.0

// xyz: render-space position. w: u on the face, metres, left to right seen from outside.
varying vec4 vPu;
// xyz: normal. w: v on the face, metres: height above the box base (on a roof: distance along z).
varying vec4 vNv;
// Face width, face height, face id (0..3 sides, 4 top), box flags.
flat varying vec4 vFace;
// Face seed (an exact integer), building seed (an exact integer), style, base y of the box.
flat varying vec4 vSeed;
// Window cell width and height in metres, glazed share of the cell in u and in v.
flat varying vec4 vGrid;
// Lit share of the windows, zone size in cells (u, v), share of windows in the accent colour.
flat varying vec4 vLit;
// Spacing of light bands (m, 0 = none), spacing of fins (m, 0 = none), trim half-width (m), trim gain.
flat varying vec4 vDeco;
// Sign panel rectangle on the face: u0, v0, width, height in metres (width 0 = none).
flat varying vec4 vPanel;
// Panel kind (+ SB_WHOLE), LED pitch in u and v (m), seed (an exact integer).
flat varying vec4 vPanelK;
// Shop front: height (m, 0 = none), bay width (m), seed (an exact integer), height of the sign strip (m).
flat varying vec4 vShop;
// Window colours on the light scale. vC1.w: roof height of the whole building. vC2.w: variant 0..1.
flat varying vec4 vC1;
flat varying vec4 vC2;
// Trim colours, luminance-balanced. w: palette indices of the two panel colours.
flat varying vec4 vTrimA;
flat varying vec4 vTrimB;

float sb_bit(float flags, float bit) { return mod(floor(flags / bit), 2.0); }
bool sb_is(float style, float which) { return abs(style - which) < 0.5; }
// Palette colours differ five-fold in luminance (violet 0.2, cyan 0.7), and bloom keys on luminance.
// This evens them out most of the way, so a magenta tube glows like a cyan one.
vec3 sb_even(vec3 c, float power) { return c / pow(max(sc_luma(c), 0.05), power); }
`;
