// The sky (plan T03, architecture.md section 5.4): gradient, striped sun, stars, wireframe mountains,
// horizon haze and distant lights, all in one fragment shader on one camera-centred dome.
//
// One draw call, no per-frame work: everything is driven by the shared uniforms, which the engine
// eases between moods. The dome stays on three layer 0, so the reflection pass draws it too.
import { BoxGeometry, DoubleSide, Mesh, ShaderMaterial } from 'three';
import { RENDER_ORDER } from '../../contracts/constants';
import type { FrameState, Layer, LayerContext } from '../../contracts/layer';
import { SKY_FRAGMENT, SKY_VERTEX } from './shaders';

export function createLayer(): Layer {
  let release: (() => void) | null = null;
  return {
    id: 'sky',
    init(ctx: LayerContext): void {
      // A cube round the camera. Only the direction of each vertex matters, not its distance.
      const geometry = new BoxGeometry(2, 2, 2);
      geometry.deleteAttribute('normal');
      geometry.deleteAttribute('uv');
      const material = new ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: { ...ctx.uniforms },
        defines: { SKY_DETAIL: ctx.quality.tier === 'low' ? 0 : 1 },
        // Seen from inside, and by the mirrored camera of the reflection pass.
        side: DoubleSide,
        // At the far plane, after the opaque geometry: it fills only what the city leaves open.
        depthTest: true,
        depthWrite: false,
      });
      const dome = new Mesh(geometry, material);
      dome.renderOrder = RENDER_ORDER.sky;
      dome.frustumCulled = false;
      dome.matrixAutoUpdate = false;
      ctx.scene.add(dome);
      release = (): void => {
        ctx.scene.remove(dome);
        geometry.dispose();
        material.dispose();
      };
    },
    update(_frame: FrameState): void {},
    dispose(): void {
      release?.();
      release = null;
    },
  };
}
