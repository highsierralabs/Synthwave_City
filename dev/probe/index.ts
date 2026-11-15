// The probe: a throwaway layer that draws the plan's boxes and the street grid with flat shading.
// It exists to prove the engine, the wrap, the fog, the grid helpers and the reflection texture
// before the real layers do. It lives in dev/ and never ships.
import {
  BoxGeometry, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial,
} from 'three';
import { BOX, BOX_STRIDE } from '../../src/contracts/city';
import { CAMERA_FAR, SC_LAYER_NO_REFLECT } from '../../src/contracts/constants';
import { SC_COMMON, SC_VERTEX } from '../../src/contracts/glsl';
import type { FrameState, Layer, LayerContext } from '../../src/contracts/layer';

const BOX_VERT = SC_COMMON + SC_VERTEX + /* glsl */ `
attribute vec3 aPos;
attribute vec3 aSize;
attribute vec4 aStyle;
varying vec3 vP;
varying vec3 vN;
varying vec3 vLocal;
flat varying vec3 vSize;
flat varying vec4 vStyle;
void main() {
  vec3 local = position * aSize;
  vec3 p = sc_place(aPos, local);
  vP = p; vN = normal; vLocal = local; vSize = aSize; vStyle = aStyle;
  gl_Position = sc_project(p);
}
`;

const BOX_FRAG = SC_COMMON + /* glsl */ `
varying vec3 vP;
varying vec3 vN;
varying vec3 vLocal;
flat varying vec3 vSize;
flat varying vec4 vStyle;
void main() {
  // Distance to the nearest box edge on this face, metres.
  vec3 h = vSize * vec3(0.5, 1.0, 0.5);
  vec3 q = vec3(h.x - abs(vLocal.x), min(vLocal.y, h.y - vLocal.y), h.z - abs(vLocal.z));
  vec3 an = abs(vN);
  float e = an.x > 0.5 ? min(q.y, q.z) : an.y > 0.5 ? min(q.x, q.z) : min(q.x, q.y);
  float fw = fwidth(e);
  float trim = sc_line(e, 0.35, fw);
  vec3 wall = mix(vec3(0.012, 0.008, 0.035), uAmbient * 0.25, 0.5 + 0.5 * vN.y);
  // A stand-in window pattern so brightness is in the right range.
  vec2 uv = an.x > 0.5 ? vLocal.zy : vLocal.xy;
  vec2 cell = floor(uv / vec2(3.0, 3.6));
  float lit = step(0.72, sc_hash21(cell + floor(vStyle.w * 4096.0))) * (1.0 - an.y);
  lit *= sc_detail(3.0, fwidth(uv.x) + fwidth(uv.y));
  vec3 col = wall + lit * mix(vec3(1.0, 0.75, 0.45), sc_neon(vStyle.z), 0.4) * 0.7;
  col += trim * sc_neon(vStyle.y) * 2.5 * uGlow;
  gl_FragColor = vec4(sc_fog(col, vP), 1.0);
}
`;

const GROUND_VERT = SC_COMMON + SC_VERTEX + /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = sc_project(position);
}
`;

const GROUND_FRAG = SC_COMMON + /* glsl */ `
varying vec3 vP;
void main() {
  vec2 tile = uCam.xz + vP.xz;
  vec3 gx = sc_gridLine(tile.x);
  vec3 gz = sc_gridLine(tile.y);
  float fx = fwidth(tile.x), fz = fwidth(tile.y);
  float roadX = 1.0 - smoothstep(sc_corridorHalf(gx.z) - fx, sc_corridorHalf(gx.z) + fx, abs(gx.y));
  float roadZ = 1.0 - smoothstep(sc_corridorHalf(gz.z) - fz, sc_corridorHalf(gz.z) + fz, abs(gz.y));
  float road = max(roadX, roadZ);
  vec4 cell = sc_cellData(sc_cell(tile));
  vec3 block = vec3(0.02, 0.012, 0.05) + sc_neon(cell.g) * 0.015;
  vec3 col = mix(block, vec3(0.008, 0.008, 0.02), road);
  // Curb lines and centre lines, to check the grid helpers.
  float curb = max(sc_line(abs(gx.y) - sc_roadHalf(gx.z), 0.25, fx), sc_line(abs(gz.y) - sc_roadHalf(gz.z), 0.25, fz));
  col += curb * sc_neon(0.0) * 1.6 * uGlow;
  float centre = max(sc_line(gx.y, 0.15, fx), sc_line(gz.y, 0.15, fz));
  col += centre * sc_neon(1.0) * 0.8 * uGlow;
  // The mirrored scene, when the pipeline provides one.
  vec4 r = uReflMatrix * vec4(vP, 1.0);
  col += texture2D(uReflTex, r.xy / r.w).rgb * 0.5 * uReflAmount * road;
  gl_FragColor = vec4(sc_fog(col, vP), 1.0);
}
`;

export function createProbeLayer(): Layer {
  const disposables: { dispose(): void }[] = [];
  return {
    id: 'probe',
    init(ctx: LayerContext): void {
      const { plan, uniforms, scene } = ctx;
      const unit = new BoxGeometry(1, 1, 1);
      unit.translate(0, 0.5, 0);
      const geometry = new InstancedBufferGeometry();
      geometry.setIndex(unit.getIndex());
      geometry.setAttribute('position', unit.getAttribute('position'));
      geometry.setAttribute('normal', unit.getAttribute('normal'));
      const n = plan.boxCount;
      const pos = new Float32Array(n * 3);
      const size = new Float32Array(n * 3);
      const style = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const o = i * BOX_STRIDE;
        pos[i * 3] = plan.boxes[o + BOX.cx]!;
        pos[i * 3 + 1] = plan.boxes[o + BOX.y0]!;
        pos[i * 3 + 2] = plan.boxes[o + BOX.cz]!;
        size[i * 3] = plan.boxes[o + BOX.sx]!;
        size[i * 3 + 1] = plan.boxes[o + BOX.sy]!;
        size[i * 3 + 2] = plan.boxes[o + BOX.sz]!;
        style[i * 4] = plan.boxes[o + BOX.style]!;
        style[i * 4 + 1] = plan.boxes[o + BOX.colorA]!;
        style[i * 4 + 2] = plan.boxes[o + BOX.colorB]!;
        style[i * 4 + 3] = plan.boxes[o + BOX.seed]!;
      }
      geometry.setAttribute('aPos', new InstancedBufferAttribute(pos, 3));
      geometry.setAttribute('aSize', new InstancedBufferAttribute(size, 3));
      geometry.setAttribute('aStyle', new InstancedBufferAttribute(style, 4));
      geometry.instanceCount = n;
      const material = new ShaderMaterial({ vertexShader: BOX_VERT, fragmentShader: BOX_FRAG, uniforms: { ...uniforms } });
      const boxes = new Mesh(geometry, material);
      boxes.frustumCulled = false;
      boxes.matrixAutoUpdate = false;
      scene.add(boxes);

      const plane = new PlaneGeometry(CAMERA_FAR * 2, CAMERA_FAR * 2, 1, 1);
      plane.rotateX(-Math.PI / 2);
      const groundMaterial = new ShaderMaterial({ vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, uniforms: { ...uniforms } });
      const ground = new Mesh(plane, groundMaterial);
      ground.frustumCulled = false;
      ground.matrixAutoUpdate = false;
      ground.layers.set(SC_LAYER_NO_REFLECT);
      scene.add(ground);

      disposables.push(unit, geometry, material, plane, groundMaterial);
      this.dispose = (): void => {
        scene.remove(boxes, ground);
        for (const d of disposables) d.dispose();
      };
    },
    update(_frame: FrameState): void {},
    dispose(): void {},
  };
}
