// Fallback frame pipeline: scene into a half-float target, then one tone-map pass to the canvas.
// Used when src/post is missing, fails to load, or is bypassed with ?post=0. No bloom.
import {
  BufferAttribute, BufferGeometry, HalfFloatType, Mesh, OrthographicCamera, Scene, ShaderMaterial, WebGLRenderTarget,
} from 'three';
import type { FramePipeline, FrameState, PipelineHost } from '../contracts/layer';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform float uExposure;
varying vec2 vUv;
// Narkowicz ACES fit.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb * uExposure;
  c = aces(c);
  gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}
`;

export function createBasicPipeline(host: PipelineHost): FramePipeline {
  const { renderer, scene, camera, uniforms, quality } = host;
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true, samples: quality.msaa });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { tScene: { value: target.texture }, uExposure: uniforms.uExposure },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const quadScene = new Scene();
  quadScene.add(quad);
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    renderScale: 1,
    render(_frame: FrameState): void {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
    },
    setSize(width: number, height: number, pixelRatio: number): void {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      const w = Math.max(1, Math.floor(width * pixelRatio));
      const h = Math.max(1, Math.floor(height * pixelRatio));
      target.setSize(w, h);
      uniforms.uResolution.value.set(w, h);
    },
    dispose(): void {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
