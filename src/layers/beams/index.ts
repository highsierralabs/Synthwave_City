// The beams layer (plan T08): searchlights sweeping from roofs and plazas, beacon pillars over the
// megatowers and plazas, and laser fans above downtown.
//
// Everything is packed once in init (./pack.ts) and animated in the vertex shader (./shaders.ts),
// so update does nothing. Four draw calls in the main pass: ribbons and emitter flares, each once
// for the beams that stay out of the reflection pass (searchlights, lasers) and once for the
// pillars, which are mirrored in the wet streets.
import {
  BufferAttribute, CustomBlending, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, OneFactor,
  ShaderMaterial, ZeroFactor,
} from 'three';
import { RENDER_ORDER, SC_LAYER_NO_REFLECT } from '../../contracts/constants';
import type { FrameState, Layer, LayerContext } from '../../contracts/layer';
import { BEAM_STRIDE, packBeams, type BeamSet } from './pack';
import { BEAM_FRAG, BEAM_VERT, FLARE_FRAG, FLARE_VERT } from './shaders';

/** Segments along a ribbon. The ribbon twists to face the camera, so one long quad would shear. */
const SEGMENTS = 16;

interface Disposable { dispose(): void }

/** A strip from y = 0 to 1, x = -1 to 1. */
function ribbonGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  const position = new Float32Array((SEGMENTS + 1) * 2 * 3);
  const index = new Uint16Array(SEGMENTS * 6);
  for (let i = 0; i <= SEGMENTS; i++) {
    // Rows sit closer together near the emitter, where the beam is brightest and narrowest.
    const u = i / SEGMENTS;
    const t = u * (0.4 + 0.6 * u);
    position.set([-1, t, 0, 1, t, 0], i * 6);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 2;
    index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
  }
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

/** A quad, x and y from -1 to 1. */
function spriteGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1));
  return geometry;
}

/** The per-instance attributes of a set, shared by its ribbon and its flare geometry. */
function instanceAttributes(set: BeamSet): Record<string, InstancedBufferAttribute> {
  return {
    aOrigin: new InstancedBufferAttribute(set.origin, BEAM_STRIDE.origin),
    aShape: new InstancedBufferAttribute(set.shape, BEAM_STRIDE.shape),
    aLook: new InstancedBufferAttribute(set.look, BEAM_STRIDE.look),
    aTilt: new InstancedBufferAttribute(set.tilt, BEAM_STRIDE.tilt),
    aAzim: new InstancedBufferAttribute(set.azim, BEAM_STRIDE.azim),
    aFan: new InstancedBufferAttribute(set.fan, BEAM_STRIDE.fan),
    aRoll: new InstancedBufferAttribute(set.roll, BEAM_STRIDE.roll),
  };
}

function additive(vertexShader: string, fragmentShader: string, uniforms: LayerContext['uniforms']): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { ...uniforms },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    // Add colour, leave the alpha of the frame alone (architecture.md section 5.5).
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
}

export function createLayer(): Layer {
  let release: (() => void) | null = null;
  return {
    id: 'beams',
    init(ctx: LayerContext): void {
      const { scene, uniforms, plan, quality, seed } = ctx;
      const packed = packBeams(plan.sites, quality.density, seed);
      const disposables: Disposable[] = [];
      const meshes: Mesh[] = [];

      const beamMaterial = additive(BEAM_VERT, BEAM_FRAG, uniforms);
      const flareMaterial = additive(FLARE_VERT, FLARE_FRAG, uniforms);
      disposables.push(beamMaterial, flareMaterial);

      const add = (set: BeamSet, reflected: boolean): void => {
        if (set.count === 0) return;
        const attributes = instanceAttributes(set);
        const build = (geometry: InstancedBufferGeometry, material: ShaderMaterial, order: number): void => {
          for (const name of Object.keys(attributes)) geometry.setAttribute(name, attributes[name]!);
          geometry.instanceCount = set.count;
          const mesh = new Mesh(geometry, material);
          mesh.frustumCulled = false;
          mesh.matrixAutoUpdate = false;
          mesh.renderOrder = order;
          if (!reflected) mesh.layers.set(SC_LAYER_NO_REFLECT);
          scene.add(mesh);
          meshes.push(mesh);
          disposables.push(geometry);
        };
        build(ribbonGeometry(), beamMaterial, RENDER_ORDER.beams);
        build(spriteGeometry(), flareMaterial, RENDER_ORDER.sprites);
      };
      add(packed.sky, false);
      add(packed.pillars, true);

      release = (): void => {
        for (const mesh of meshes) scene.remove(mesh);
        for (const d of disposables) d.dispose();
      };
    },
    update(_frame: FrameState): void {},
    dispose(): void {
      release?.();
      release = null;
    },
  };
}
