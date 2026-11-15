// Air traffic (plan T07): streams of flying craft in the sky lanes above the avenues, each a dark
// hull with engine glow, lamps, a strobe and a trail of light, plus six hero ships on slow routes.
//
// Everything moves in the vertex shaders from uLoop (architecture.md 4.3), so update() is empty.
// Six draw calls: three hull shapes, the craft lights and trails, the hero hulls, the hero lights.
import {
  AdditiveBlending, BufferAttribute, DoubleSide, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute,
  Mesh, ShaderMaterial,
} from 'three';
import { RENDER_ORDER } from '../../contracts/constants';
import type { FrameState, Layer, LayerContext } from '../../contracts/layer';
import {
  CRAFT_STRIDE, HERO_LIMITS, HERO_STRIDE, SHAPE_COUNT, packCraft, planHeroes,
} from './pack';
import {
  CRAFT_LIGHT_VERT, HERO_FRAG, HERO_LIGHT_VERT, HERO_VERT, HULL_DRAW_DISTANCE, HULL_FRAG, HULL_VERT, LIGHT_FRAG,
} from './shaders';
import {
  CRAFT_LIGHTS, CRAFT_LIGHT_TABLE, CRAFT_TRAIL_TABLE, GLOW, buildCraftHull, buildHeroHull, heroLights, type HullMesh,
} from './shapes';

/** Where along a trail its cross-sections sit, 0 at the engine to 1 at the tip. */
const TRAIL_ROWS: readonly number[] = [0, 0.14, 0.48, 1];

interface Disposable { dispose(): void }

function hullGeometry(mesh: HullMesh, withType: boolean): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('aPart', new BufferAttribute(mesh.parts, 1));
  if (withType) geometry.setAttribute('aType', new BufferAttribute(mesh.types, 1));
  return geometry;
}

/** Bind the four vec4 craft attributes (or the two hero ones) from one interleaved instance buffer. */
function bindInstances(geometry: InstancedBufferGeometry, data: Float32Array, stride: number, names: readonly string[]): void {
  const buffer = new InstancedInterleavedBuffer(data, stride, 1);
  for (let i = 0; i < names.length; i++) geometry.setAttribute(names[i]!, new InterleavedBufferAttribute(buffer, 4, i * 4));
  geometry.instanceCount = data.length / stride;
}

const CRAFT_ATTRIBUTES = ['aLane', 'aMove', 'aBob', 'aLook'] as const;
const HERO_ATTRIBUTES = ['aRoute', 'aRun'] as const;

/** The per-craft light geometry: CRAFT_LIGHTS sprite quads, then one trail ribbon. */
function craftLightGeometry(): InstancedBufferGeometry {
  const verts: number[] = [];
  const index: number[] = [];
  for (let k = 0; k < CRAFT_LIGHTS; k++) {
    const base = verts.length / 3;
    verts.push(-1, -1, k, 1, -1, k, 1, 1, k, -1, 1, k);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const first = verts.length / 3;
  for (let r = 0; r < TRAIL_ROWS.length; r++) {
    verts.push(-1, TRAIL_ROWS[r]!, CRAFT_LIGHTS, 1, TRAIL_ROWS[r]!, CRAFT_LIGHTS);
    if (r === 0) continue;
    const a = first + (r - 1) * 2;
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(new Uint16Array(index), 1));
  geometry.setAttribute('aVert', new BufferAttribute(new Float32Array(verts), 3));
  return geometry;
}

/** The hero light geometry: one quad per light of every type; the shader keeps a ship's own. */
function heroLightGeometry(): InstancedBufferGeometry {
  const lights = heroLights();
  const local = new Float32Array(lights.length * 4 * 3);
  const spec = new Float32Array(lights.length * 4 * 4);
  const quad = new Float32Array(lights.length * 4 * 3);
  const index = new Uint16Array(lights.length * 6);
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i]!;
    // Sprites and the pool span -1..1 both ways; ribbons span -1..1 across and 0..1 along.
    const ribbon = l.mode === GLOW.cone || l.mode === GLOW.plume;
    const y0 = ribbon ? 0 : -1;
    const corners = [-1, y0, 1, y0, 1, 1, -1, 1];
    for (let v = 0; v < 4; v++) {
      const o = i * 4 + v;
      local.set([l.x, l.y, l.z], o * 3);
      spec.set([l.size, l.color, l.mode, l.phase], o * 4);
      quad.set([corners[v * 2]!, corners[v * 2 + 1]!, l.type], o * 3);
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setAttribute('aLocal', new BufferAttribute(local, 3));
  geometry.setAttribute('aSpec', new BufferAttribute(spec, 4));
  geometry.setAttribute('aQuad', new BufferAttribute(quad, 3));
  return geometry;
}

export function createLayer(): Layer {
  let release: (() => void) | null = null;
  return {
    id: 'airtraffic',
    init(ctx: LayerContext): void {
      const { plan, uniforms, scene, quality } = ctx;
      const disposables: Disposable[] = [];
      const meshes: Mesh[] = [];
      const add = (geometry: InstancedBufferGeometry, material: ShaderMaterial, order: number): void => {
        const mesh = new Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = order;
        scene.add(mesh);
        meshes.push(mesh);
        disposables.push(geometry);
      };
      const additive = (vertexShader: string, extra: Record<string, { value: unknown }>): ShaderMaterial => {
        const material = new ShaderMaterial({
          vertexShader,
          fragmentShader: LIGHT_FRAG,
          uniforms: { ...uniforms, ...extra },
          blending: AdditiveBlending,
          // Ribbons turn to face the camera and show either face.
          side: DoubleSide,
          transparent: true,
          depthWrite: false,
          depthTest: true,
        });
        disposables.push(material);
        return material;
      };

      // ---- small craft
      const craft = packCraft(plan.lanes, quality.density, ctx.seed);
      if (craft.count > 0) {
        const hullMaterial = new ShaderMaterial({
          vertexShader: HULL_VERT,
          fragmentShader: HULL_FRAG,
          uniforms: { ...uniforms, uHullFar: { value: HULL_DRAW_DISTANCE } },
        });
        disposables.push(hullMaterial);
        for (let s = 0; s < SHAPE_COUNT; s++) {
          const from = craft.shapeStart[s]!;
          const to = craft.shapeStart[s + 1]!;
          if (to === from) continue;
          const geometry = hullGeometry(buildCraftHull(s), false);
          bindInstances(geometry, craft.data.subarray(from * CRAFT_STRIDE, to * CRAFT_STRIDE), CRAFT_STRIDE, CRAFT_ATTRIBUTES);
          add(geometry, hullMaterial, RENDER_ORDER.opaque);
        }
        const lightGeometry = craftLightGeometry();
        bindInstances(lightGeometry, craft.data, CRAFT_STRIDE, CRAFT_ATTRIBUTES);
        const lightMaterial = additive(CRAFT_LIGHT_VERT, {
          uLights: { value: new Float32Array(CRAFT_LIGHT_TABLE) },
          uTrail: { value: new Float32Array(CRAFT_TRAIL_TABLE) },
        });
        add(lightGeometry, lightMaterial, RENDER_ORDER.sprites);
      }

      // ---- hero ships
      const heroes = planHeroes(plan.cells, plan.landmarks, ctx.seed);
      if (heroes.count > 0) {
        const bob = new Float32Array(HERO_LIMITS.length * 2);
        for (let t = 0; t < HERO_LIMITS.length; t++) bob.set([HERO_LIMITS[t]!.bobAmp, HERO_LIMITS[t]!.bobCycles], t * 2);
        const heroUniforms = { uHeroBob: { value: bob } };
        const heroMaterial = new ShaderMaterial({
          vertexShader: HERO_VERT,
          fragmentShader: HERO_FRAG,
          uniforms: { ...uniforms, ...heroUniforms },
        });
        disposables.push(heroMaterial);
        const heroGeometry = hullGeometry(buildHeroHull(), true);
        bindInstances(heroGeometry, heroes.data, HERO_STRIDE, HERO_ATTRIBUTES);
        add(heroGeometry, heroMaterial, RENDER_ORDER.opaque);

        const heroLightGeo = heroLightGeometry();
        bindInstances(heroLightGeo, heroes.data, HERO_STRIDE, HERO_ATTRIBUTES);
        const heroLightMaterial = additive(HERO_LIGHT_VERT, heroUniforms);
        // A small pull towards the camera keeps the pool of light off the road's depth.
        heroLightMaterial.polygonOffset = true;
        heroLightMaterial.polygonOffsetFactor = -1;
        heroLightMaterial.polygonOffsetUnits = -2;
        add(heroLightGeo, heroLightMaterial, RENDER_ORDER.sprites);
      }

      release = (): void => {
        for (const mesh of meshes) scene.remove(mesh);
        for (const d of disposables) d.dispose();
        release = null;
      };
    },
    update(_frame: FrameState): void {},
    dispose(): void {
      if (release) release();
    },
  };
}
