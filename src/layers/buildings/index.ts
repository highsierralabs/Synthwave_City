// The buildings layer (plan T05): every box of the city plan as one instance of a unit box or a unit
// cylinder, with the whole facade drawn by the fragment shader, plus the aviation lights.
// Three draw calls, nothing per frame on the CPU.
import {
  AdditiveBlending, BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial,
} from 'three';
import { RENDER_ORDER } from '../../contracts/constants';
import type { FrameState, Layer, LayerContext } from '../../contracts/layer';
import { unitBox, unitCylinder, type ShapeData } from './geometry';
import {
  LIGHT_KIND_SIZE, LIGHT_SITE_SIZE, POS_SIZE, SEED_SIZE, SIZE_SIZE, STYLE_SIZE, packBoxes, packRoofLights,
  type BoxInstances,
} from './pack';
import { BUILDINGS_FRAG } from './shaders/fragment';
import { LIGHTS_FRAG, LIGHTS_VERT } from './shaders/lights';
import { BUILDINGS_VERT } from './shaders/vertex';

/** Sides of the cylinder used for round towers. */
const CYLINDER_SEGMENTS = 28;

function boxGeometry(shape: ShapeData, instances: BoxInstances): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(shape.index, 1));
  geometry.setAttribute('position', new BufferAttribute(shape.position, 3));
  geometry.setAttribute('normal', new BufferAttribute(shape.normal, 3));
  geometry.setAttribute('aFace', new BufferAttribute(shape.face, 3));
  geometry.setAttribute('aPos', new InstancedBufferAttribute(instances.pos, POS_SIZE));
  geometry.setAttribute('aSize', new InstancedBufferAttribute(instances.size, SIZE_SIZE));
  geometry.setAttribute('aStyle', new InstancedBufferAttribute(instances.style, STYLE_SIZE));
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(instances.seed, SEED_SIZE));
  geometry.instanceCount = instances.count;
  return geometry;
}

export function createLayer(): Layer {
  let dispose = (): void => {};
  return {
    id: 'buildings',
    init(ctx: LayerContext): void {
      const { plan, uniforms, scene } = ctx;
      const disposables: { dispose(): void }[] = [];
      const meshes: Mesh[] = [];
      const add = (mesh: Mesh, renderOrder: number): void => {
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = renderOrder;
        scene.add(mesh);
        meshes.push(mesh);
      };

      // One material for both shapes: the vertex shader tells them apart by the round flag.
      const packed = packBoxes(plan);
      const material = new ShaderMaterial({
        vertexShader: BUILDINGS_VERT, fragmentShader: BUILDINGS_FRAG, uniforms: { ...uniforms },
      });
      disposables.push(material);
      if (packed.square.count > 0) {
        const geometry = boxGeometry(unitBox(), packed.square);
        disposables.push(geometry);
        add(new Mesh(geometry, material), RENDER_ORDER.opaque);
      }
      if (packed.round.count > 0) {
        const geometry = boxGeometry(unitCylinder(CYLINDER_SEGMENTS), packed.round);
        disposables.push(geometry);
        add(new Mesh(geometry, material), RENDER_ORDER.opaque);
      }

      const lights = packRoofLights(plan.sites);
      if (lights.count > 0) {
        const geometry = new InstancedBufferGeometry();
        geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
        geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
        geometry.setAttribute('aSite', new InstancedBufferAttribute(lights.site, LIGHT_SITE_SIZE));
        geometry.setAttribute('aKind', new InstancedBufferAttribute(lights.kind, LIGHT_KIND_SIZE));
        geometry.instanceCount = lights.count;
        const lightMaterial = new ShaderMaterial({
          vertexShader: LIGHTS_VERT, fragmentShader: LIGHTS_FRAG, uniforms: { ...uniforms },
          blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: true,
        });
        disposables.push(geometry, lightMaterial);
        add(new Mesh(geometry, lightMaterial), RENDER_ORDER.sprites);
      }

      dispose = (): void => {
        for (const mesh of meshes) scene.remove(mesh);
        for (const d of disposables) d.dispose();
        dispose = (): void => {};
      };
    },
    update(_frame: FrameState): void {},
    dispose(): void {
      dispose();
    },
  };
}
