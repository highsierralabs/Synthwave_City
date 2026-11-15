// The reflection pass (plan T02, M3): the scene seen from a camera mirrored in the road plane y = 0.
//
// Shaders place geometry relative to the camera in x and z, and the mirror camera has the same x
// and z, so layers need no changes. Objects on SC_LAYER_NO_REFLECT are left out.
import {
  HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Matrix4, PerspectiveCamera, Vector3, WebGLRenderTarget,
} from 'three';
import type { PipelineHost } from '../contracts/layer';

const BIAS = new Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);

export interface ReflectionPass {
  readonly target: WebGLRenderTarget;
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createReflectionPass(host: PipelineHost): ReflectionPass {
  const { renderer, scene, camera, uniforms } = host;
  const target = new WebGLRenderTarget(4, 4, {
    type: HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
  });
  const mirror = new PerspectiveCamera();
  mirror.matrixAutoUpdate = true;
  // Default layer mask: layer 0 only, so SC_LAYER_NO_REFLECT objects are skipped.
  const forward = new Vector3();
  const up = new Vector3();
  const look = new Vector3();

  uniforms.uReflTex.value = target.texture;
  uniforms.uReflAmount.value = 1;

  return {
    target,
    render(): void {
      // Mirror the pose: reflect position, forward and up in the plane y = 0.
      const e = camera.matrixWorld.elements;
      up.set(e[4]!, -e[5]!, e[6]!);
      forward.set(-e[8]!, e[9]!, -e[10]!);
      mirror.position.set(camera.position.x, -camera.position.y, camera.position.z);
      mirror.up.copy(up);
      look.copy(mirror.position).add(forward);
      mirror.lookAt(look);
      mirror.fov = camera.fov;
      mirror.aspect = camera.aspect;
      mirror.near = camera.near;
      mirror.far = camera.far;
      mirror.updateProjectionMatrix();
      mirror.updateMatrixWorld(true);

      uniforms.uReflMatrix.value.copy(BIAS).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, mirror);
      renderer.setRenderTarget(null);
    },
    setSize(width: number, height: number): void {
      target.setSize(Math.max(4, Math.floor(width)), Math.max(4, Math.floor(height)));
    },
    dispose(): void {
      target.dispose();
    },
  };
}
