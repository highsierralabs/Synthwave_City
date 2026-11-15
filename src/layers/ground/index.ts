// The ground layer (plan T04): one disc under the camera whose shader draws the streets, markings,
// plazas and wet reflections of the whole tile, plus the street lamps.
//
// Three draw calls: the ground, the lamp posts (a small lattice that follows the camera in whole
// pattern steps) and the lamp glows (one sprite per lamp in the tile).
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, PlaneGeometry, ShaderMaterial, Vector2,
} from 'three';
import { CAMERA_FAR, RENDER_ORDER, SC_LAYER_NO_REFLECT, TILE } from '../../contracts/constants';
import type { FrameState, Layer, LayerContext } from '../../contracts/layer';
import {
  GROUND, LAMP, LAMP_PATTERN, LAMP_STRIDE, POST_LATTICE, buildDisc, buildLamps, buildPost, lampHead, lampSpacing,
  type MeshData,
} from './layout';
import { GROUND_FRAG, GROUND_VERT, POST_FRAG, POST_VERT, SPRITE_FRAG, SPRITE_VERT } from './shaders';

/** The disc reaches past the far plane in the corners of the widest view. */
const DISC_RADIUS = CAMERA_FAR * 1.75;

function toGeometry<T extends BufferGeometry>(geometry: T, data: MeshData): T {
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  return geometry;
}

export function createLayer(): Layer {
  let cleanup: (() => void) | null = null;
  return {
    id: 'ground',

    init(ctx: LayerContext): void {
      const { scene, uniforms, quality } = ctx;
      const spacing = lampSpacing(quality.density);

      // ---- the ground
      const discGeometry = toGeometry(new BufferGeometry(), buildDisc(DISC_RADIUS));
      const groundMaterial = new ShaderMaterial({
        vertexShader: GROUND_VERT,
        fragmentShader: GROUND_FRAG,
        uniforms: { ...uniforms, uLampSp: { value: spacing } },
        // Tiers without a reflection pass compile the shader without the mirror taps.
        defines: quality.reflectionScale > 0 ? { G_REFLECT: 1 } : {},
      });
      const ground = new Mesh(discGeometry, groundMaterial);
      ground.frustumCulled = false;
      ground.matrixAutoUpdate = false;
      // Not in its own reflection.
      ground.layers.set(SC_LAYER_NO_REFLECT);
      // Still in the opaque band, but after the other opaque layers: everything a building or a car
      // hides is then rejected by the depth test before this (expensive) shader runs.
      ground.renderOrder = RENDER_ORDER.opaque + 1;
      scene.add(ground);

      // ---- lamp posts: one pattern of lamps, repeated on a lattice round the camera
      const pattern = buildLamps(spacing, LAMP_PATTERN);
      const perPattern = pattern.length / LAMP_STRIDE;
      const copies = POST_LATTICE * 2;
      const postCount = perPattern * copies * copies;
      const aLamp = new Float32Array(postCount * 4);
      const aInfo = new Float32Array(postCount * 2);
      let n = 0;
      for (let cz = -POST_LATTICE; cz < POST_LATTICE; cz++) {
        for (let cx = -POST_LATTICE; cx < POST_LATTICE; cx++) {
          for (let i = 0; i < perPattern; i++) {
            const o = i * LAMP_STRIDE;
            aLamp[n * 4] = pattern[o + LAMP.x]! + cx * LAMP_PATTERN;
            aLamp[n * 4 + 1] = pattern[o + LAMP.z]! + cz * LAMP_PATTERN;
            aLamp[n * 4 + 2] = pattern[o + LAMP.dirX]!;
            aLamp[n * 4 + 3] = pattern[o + LAMP.dirZ]!;
            aInfo[n * 2] = pattern[o + LAMP.height]!;
            aInfo[n * 2 + 1] = pattern[o + LAMP.color]!;
            n++;
          }
        }
      }
      const post = buildPost();
      const postGeometry = toGeometry(new InstancedBufferGeometry(), post);
      postGeometry.setAttribute('aPart', new BufferAttribute(post.parts, 1));
      postGeometry.setAttribute('aAxis', new BufferAttribute(post.axes, 3));
      postGeometry.setAttribute('aLamp', new InstancedBufferAttribute(aLamp, 4));
      postGeometry.setAttribute('aInfo', new InstancedBufferAttribute(aInfo, 2));
      postGeometry.instanceCount = postCount;
      const postMaterial = new ShaderMaterial({
        vertexShader: POST_VERT,
        fragmentShader: POST_FRAG,
        uniforms: { ...uniforms, uPostFade: { value: new Vector2(GROUND.postFadeStart, GROUND.postFadeEnd) } },
        side: DoubleSide,
      });
      const posts = new Mesh(postGeometry, postMaterial);
      posts.frustumCulled = false;
      posts.matrixAutoUpdate = false;
      scene.add(posts);

      // ---- lamp glows: every lamp in the tile, so the streets carry points of light out to the far fade
      const lamps = buildLamps(spacing, TILE);
      const lampTotal = lamps.length / LAMP_STRIDE;
      const aHead = new Float32Array(lampTotal * 3);
      const aCol = new Float32Array(lampTotal);
      const head = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < lampTotal; i++) {
        lampHead(lamps, i, head);
        aHead[i * 3] = head.x;
        aHead[i * 3 + 1] = head.y;
        aHead[i * 3 + 2] = head.z;
        aCol[i] = lamps[i * LAMP_STRIDE + LAMP.color]!;
      }
      const quad = new PlaneGeometry(2, 2);
      const spriteGeometry = new InstancedBufferGeometry();
      spriteGeometry.setIndex(quad.getIndex());
      spriteGeometry.setAttribute('position', quad.getAttribute('position'));
      spriteGeometry.setAttribute('aHead', new InstancedBufferAttribute(aHead, 3));
      spriteGeometry.setAttribute('aCol', new InstancedBufferAttribute(aCol, 1));
      spriteGeometry.instanceCount = lampTotal;
      const spriteMaterial = new ShaderMaterial({
        vertexShader: SPRITE_VERT,
        fragmentShader: SPRITE_FRAG,
        uniforms: { ...uniforms },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const sprites = new Mesh(spriteGeometry, spriteMaterial);
      sprites.frustumCulled = false;
      sprites.matrixAutoUpdate = false;
      sprites.renderOrder = RENDER_ORDER.sprites;
      scene.add(sprites);

      cleanup = (): void => {
        scene.remove(ground, posts, sprites);
        for (const d of [discGeometry, groundMaterial, postGeometry, postMaterial, quad, spriteGeometry, spriteMaterial]) d.dispose();
      };
    },

    update(_frame: FrameState): void {},

    dispose(): void {
      cleanup?.();
      cleanup = null;
    },
  };
}
