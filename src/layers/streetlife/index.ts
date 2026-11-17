// The street life layer (plan T06): ground traffic and crowds.
//
// Nothing here is stored per car. A lane's cars are a pure function of (lane, index, loop phase)
// (./pack.ts), so the GPU draws a fixed grid of "the k-th car from the camera in this lane of the
// j-th road from the camera" and the vertex shader works out which car that is. Past the handover
// distance the same function is evaluated per pixel on one quad per road, which turns every car
// into a pair of dashes: that is the far traffic. People are placed the same way, per block face on
// the sidewalks, and per cell in the alleys and on the plazas.
//
// Six draw calls in the main pass and no work in update:
//   bodies (opaque, reflected), lamp sprites (additive, reflected), light on the road (additive),
//   far traffic (additive), crowds on the sidewalks and between the buildings (opaque).
import {
  BufferAttribute, CustomBlending, DataTexture, DoubleSide, FloatType, FrontSide, InstancedBufferAttribute,
  InstancedBufferGeometry, Mesh, NearestFilter, NoColorSpace, OneFactor, RGBAFormat, ShaderMaterial, Vector2, Vector4, ZeroFactor,
  type IUniform,
} from 'three';
import { CELLS, RENDER_ORDER, SC_LAYER_NO_REFLECT } from '../../contracts/constants';
import type { FrameState, Layer, LayerContext } from '../../contracts/layer';
import { buildCarMesh } from './mesh';
import {
  BLOCK_SLOTS, CROWD_END, CROWD_PER_FACE, CROWD_START, HANDOVER_END, HANDOVER_START, buildAlleyTable, buildBlockField,
  buildCarField, buildCrowdField, buildLaneTable, trafficDensity,
} from './pack';
import {
  BLOCK_VERT, CAR_FRAG, CAR_VERT, FAR_FRAG, FAR_VERT, LAMP_FRAG, LAMP_VERT, POOL_FRAG, POOL_VERT, WALKER_FRAG, WALKER_VERT,
} from './shaders';

interface Disposable { dispose(): void }
type Uniforms = Record<string, IUniform>;

/** `count` quads in one geometry; each vertex is (x, y, quad number), x and y from the corner lists. */
function quads(count: number, x0: number, x1: number, y0: number, y1: number): InstancedBufferGeometry {
  const position = new Float32Array(count * 12);
  const index = new Uint16Array(count * 6);
  for (let i = 0; i < count; i++) {
    position.set([x0, y0, i, x1, y0, i, x0, y1, i, x1, y1, i], i * 12);
    const a = i * 4;
    index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

function additive(vertexShader: string, fragmentShader: string, uniforms: Uniforms, onRoad: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    // Add colour, leave the alpha of the frame alone (architecture.md section 5.5).
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    // A quad lying on the road is wound for one travel direction only; draw both faces.
    side: onRoad ? DoubleSide : FrontSide,
    // It is also coplanar with the ground layer; pull it towards the camera in depth.
    polygonOffset: onRoad,
    polygonOffsetFactor: onRoad ? -2 : 0,
    polygonOffsetUnits: onRoad ? -8 : 0,
  });
}

export function createLayer(): Layer {
  let release: (() => void) | null = null;
  return {
    id: 'streetlife',
    init(ctx: LayerContext): void {
      const { scene, plan, quality, seed } = ctx;
      const disposables: Disposable[] = [];
      const meshes: Mesh[] = [];

      const table = buildLaneTable(plan.lanes, trafficDensity(quality.density), seed);
      const laneTex = new DataTexture(table.data, table.width, table.height, RGBAFormat, FloatType);
      laneTex.magFilter = NearestFilter;
      laneTex.minFilter = NearestFilter;
      laneTex.colorSpace = NoColorSpace;
      laneTex.generateMipmaps = false;
      laneTex.needsUpdate = true;
      disposables.push(laneTex);

      // The alleys between the buildings, found from the boxes of the plan.
      const alleys = buildAlleyTable(plan);
      const alleyTex = new DataTexture(alleys.data, alleys.width, alleys.height, RGBAFormat, FloatType);
      alleyTex.magFilter = NearestFilter;
      alleyTex.minFilter = NearestFilter;
      alleyTex.colorSpace = NoColorSpace;
      alleyTex.generateMipmaps = false;
      alleyTex.needsUpdate = true;
      disposables.push(alleyTex);

      // Real cars never reach the far fade, whatever the tier.
      const handoverEnd = Math.min(HANDOVER_END, quality.fadeStart * 0.8);
      const handoverStart = handoverEnd * (HANDOVER_START / HANDOVER_END);
      const perFace = quality.crowds ? Math.round(CROWD_PER_FACE * quality.density) : 0;
      const perCell = quality.crowds ? Math.round(BLOCK_SLOTS * quality.density) : 0;
      const uniforms: Uniforms = {
        ...ctx.uniforms,
        uLaneTex: { value: laneTex },
        uHandover: { value: new Vector2(handoverStart, handoverEnd) },
        // Lamp sprites: smallest half-size in pixels, and how far one held at that size dims.
        uLamp: { value: new Vector2(2.4, 0.45) },
        // Far traffic: smallest sigma of a lamp in pixels, then the gains of the pool, the tail smear and the
        // underglow, chosen so each carries the energy of its near quad.
        uDash: { value: new Vector4(0.9, 0.29, 0.14, 0.6) },
        uAlleyTex: { value: alleyTex },
        uCrowd: { value: new Vector4(CROWD_START, CROWD_END, perFace, perCell) },
      };

      const add = (geometry: InstancedBufferGeometry, material: ShaderMaterial, instances: number, order: number, reflected: boolean): void => {
        geometry.instanceCount = instances;
        const mesh = new Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = order;
        if (!reflected) mesh.layers.set(SC_LAYER_NO_REFLECT);
        scene.add(mesh);
        meshes.push(mesh);
        disposables.push(geometry, material);
      };

      // ---- near cars: one instance buffer shared by the bodies, the lamps and the light on the road
      const field = buildCarField(table, handoverEnd);
      const slot = new InstancedBufferAttribute(field.slots, 4);
      if (field.count > 0 && table.records.length > 0) {
        const car = buildCarMesh();
        const body = new InstancedBufferGeometry();
        body.setAttribute('position', new BufferAttribute(car.position, 3));
        body.setAttribute('aAlt', new BufferAttribute(car.alt, 3));
        body.setAttribute('aBike', new BufferAttribute(car.bike, 3));
        body.setAttribute('aPart', new BufferAttribute(car.part, 1));
        body.setIndex(new BufferAttribute(car.index, 1));
        body.setAttribute('aSlot', slot);
        add(body, new ShaderMaterial({ vertexShader: CAR_VERT, fragmentShader: CAR_FRAG, uniforms }), field.count, RENDER_ORDER.opaque, true);

        // Two headlights, two tail lights, one roof beacon.
        const lamps = quads(5, -1, 1, -1, 1);
        lamps.setAttribute('aSlot', slot);
        add(lamps, additive(LAMP_VERT, LAMP_FRAG, uniforms, false), field.count, RENDER_ORDER.sprites, true);

        // Headlight pool, tail smear, underglow.
        const pools = quads(3, -1, 1, -1, 1);
        pools.setAttribute('aSlot', slot);
        add(pools, additive(POOL_VERT, POOL_FRAG, uniforms, true), field.count, RENDER_ORDER.sprites, false);
      }

      // ---- far traffic: one quad per road
      if (table.records.length > 0) {
        const roads = new Float32Array(CELLS * 2 * 2);
        for (let i = 0; i < CELLS * 2; i++) {
          roads[i * 2] = i < CELLS ? 0 : 1;
          roads[i * 2 + 1] = i % CELLS;
        }
        const far = quads(1, -1, 1, -1, 1);
        far.setAttribute('aRoad', new InstancedBufferAttribute(roads, 2));
        add(far, additive(FAR_VERT, FAR_FRAG, uniforms, true), CELLS * 2, RENDER_ORDER.sprites, false);
      }

      // ---- crowds
      const walkers = buildCrowdField(perFace);
      if (walkers.length > 0) {
        const crowd = quads(1, -1, 1, 0, 1);
        crowd.setAttribute('aWalker', new InstancedBufferAttribute(walkers, 4));
        add(crowd, new ShaderMaterial({ vertexShader: WALKER_VERT, fragmentShader: WALKER_FRAG, uniforms }), walkers.length / 4, RENDER_ORDER.opaque, false);
      }

      // ---- people between the buildings: alleys and plazas
      const blockWalkers = buildBlockField(perCell);
      if (blockWalkers.length > 0) {
        const block = quads(1, -1, 1, 0, 1);
        block.setAttribute('aBlock', new InstancedBufferAttribute(blockWalkers, 4));
        add(block, new ShaderMaterial({ vertexShader: BLOCK_VERT, fragmentShader: WALKER_FRAG, uniforms }), blockWalkers.length / 4, RENDER_ORDER.opaque, false);
      }

      release = (): void => {
        for (const mesh of meshes) scene.remove(mesh);
        for (const d of disposables) d.dispose();
      };
    },
    // Every vehicle and every walker is placed in a vertex shader from uLoop; there is nothing to do here.
    update(_frame: FrameState): void {},
    dispose(): void {
      release?.();
      release = null;
    },
  };
}
