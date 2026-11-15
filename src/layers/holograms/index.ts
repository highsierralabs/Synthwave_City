// Holograms (plan T09): floating ad panels with their projectors, wire solids over the plazas and
// ticker rings round the megatowers. Three draw calls, all additive; nothing here runs per frame.
//
// Review aid: add  &holoAtlas=1  (whole atlas), =top, =bottom or =raw to any harness URL to lay the
// ad atlas over the page.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, DoubleSide,
  InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, LinearMipmapLinearFilter, Mesh,
  RepeatWrapping, SRGBColorSpace, ShaderMaterial,
} from 'three';
import { RENDER_ORDER } from '../../contracts/constants';
import type { FrameState, Layer, LayerContext } from '../../contracts/layer';
import { drawAtlas, previewAtlas } from './atlas';
import { atlasLayout } from './layout';
import { packPanels, packTickers, pickObjects } from './pack';
import { PANEL_FRAG, PANEL_VERT, TICKER_FRAG, TICKER_VERT, WIRE_FRAG, WIRE_VERT } from './shaders';
import { buildWireMesh } from './wire';

interface Disposable { dispose(): void }

/** Three quads per panel: the image, the fan of light under it, the projector lamp. z is the part. */
function panelGeometry(): InstancedBufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  for (let part = 0; part < 3; part++) {
    position.push(-0.5, -0.5, part, 0.5, -0.5, part, 0.5, 0.5, part, -0.5, 0.5, part);
    const o = part * 4;
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setIndex(index);
  return geometry;
}

/** Four quads per ring: position = (side 0..3, along the side 0..1, up the band 0..1). */
function tickerGeometry(): InstancedBufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  for (let side = 0; side < 4; side++) {
    position.push(side, 0, 0, side, 1, 0, side, 1, 1, side, 0, 1);
    const o = side * 4;
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setIndex(index);
  return geometry;
}

function atlasFlag(): string | null {
  try {
    return new URLSearchParams(location.search).get('holoAtlas');
  } catch {
    return null;
  }
}

/** Lay a review copy of the atlas over the page. */
function showAtlas(mode: string, canvas: HTMLCanvasElement, preview: HTMLCanvasElement, caption: string): HTMLElement {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#05030c;overflow:hidden';
  const shown = mode === 'raw' ? canvas : preview;
  if (mode === 'top' || mode === 'bottom') {
    shown.style.cssText = `position:absolute;left:0;width:100vw;height:100vw;${mode === 'top' ? 'top:0' : 'bottom:0'}`;
  } else {
    shown.style.cssText = 'position:absolute;left:50%;top:0;height:100vh;width:100vh;transform:translateX(-50%)';
  }
  const label = document.createElement('div');
  label.textContent = caption;
  label.style.cssText = 'position:absolute;right:8px;bottom:6px;font:12px ui-monospace,monospace;color:#9fe;background:#000a;padding:2px 6px';
  overlay.append(shown, label);
  document.body.append(overlay);
  return overlay;
}

export function createLayer(): Layer {
  let release: (() => void) | null = null;
  return {
    id: 'holograms',
    init(ctx: LayerContext): void {
      const { plan, uniforms, scene, renderer, quality } = ctx;
      const disposables: Disposable[] = [];
      const meshes: Mesh[] = [];
      const cells = atlasLayout();

      // ---- the ad atlas: drawn once, uploaded once
      const t0 = performance.now();
      const canvas = document.createElement('canvas');
      drawAtlas(canvas, cells, ctx.seed);
      const atlasMs = performance.now() - t0;
      console.info(`holograms: ad atlas drawn in ${atlasMs.toFixed(0)} ms`);
      const atlas = new CanvasTexture(canvas);
      atlas.colorSpace = SRGBColorSpace;
      atlas.wrapS = RepeatWrapping; // ticker strips span the full width and scroll round
      atlas.wrapT = ClampToEdgeWrapping;
      atlas.generateMipmaps = true;
      atlas.minFilter = LinearMipmapLinearFilter;
      atlas.magFilter = LinearFilter;
      atlas.anisotropy = renderer.capabilities.getMaxAnisotropy();
      disposables.push(atlas);

      const add = (geometry: BufferGeometry, vertexShader: string, fragmentShader: string): void => {
        const material = new ShaderMaterial({
          vertexShader,
          fragmentShader,
          uniforms: { ...uniforms, uAtlas: { value: atlas } },
          transparent: true,
          blending: AdditiveBlending,
          depthTest: true,
          depthWrite: false,
          side: DoubleSide,
        });
        const mesh = new Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = RENDER_ORDER.holograms;
        scene.add(mesh);
        meshes.push(mesh);
        disposables.push(geometry, material);
      };

      // ---- panels
      const panels = packPanels(plan.sites, cells, quality.density);
      if (panels.count > 0) {
        const geometry = panelGeometry();
        geometry.setAttribute('aPos', new InstancedBufferAttribute(panels.pos, 3));
        geometry.setAttribute('aSize', new InstancedBufferAttribute(panels.size, 4));
        geometry.setAttribute('aLook', new InstancedBufferAttribute(panels.look, 4));
        geometry.setAttribute('aFit', new InstancedBufferAttribute(panels.fit, 2));
        geometry.setAttribute('aRectA', new InstancedBufferAttribute(panels.rectA, 4));
        geometry.setAttribute('aRectB', new InstancedBufferAttribute(panels.rectB, 4));
        geometry.instanceCount = panels.count;
        add(geometry, PANEL_VERT, PANEL_FRAG);
      }

      // ---- wire solids
      const objects = pickObjects(plan.sites, quality.density);
      if (objects.length > 0) {
        const wire = buildWireMesh(objects);
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(wire.position, 3));
        geometry.setAttribute('aBary', new BufferAttribute(wire.bary, 3));
        geometry.setAttribute('aAnchor', new BufferAttribute(wire.anchor, 3));
        geometry.setAttribute('aSpin', new BufferAttribute(wire.spin, 4));
        geometry.setAttribute('aLook', new BufferAttribute(wire.look, 4));
        geometry.setAttribute('aStyle', new BufferAttribute(wire.style, 4));
        add(geometry, WIRE_VERT, WIRE_FRAG);
      }

      // ---- ticker rings
      const tickers = packTickers(plan.sites, cells, quality.density);
      if (tickers.count > 0) {
        const geometry = tickerGeometry();
        geometry.setAttribute('aPos', new InstancedBufferAttribute(tickers.pos, 3));
        geometry.setAttribute('aExt', new InstancedBufferAttribute(tickers.ext, 4));
        geometry.setAttribute('aLook', new InstancedBufferAttribute(tickers.look, 4));
        geometry.setAttribute('aRect', new InstancedBufferAttribute(tickers.rect, 4));
        geometry.instanceCount = tickers.count;
        add(geometry, TICKER_VERT, TICKER_FRAG);
      }

      // ---- the atlas dump, for review
      let overlay: HTMLElement | null = null;
      const flag = atlasFlag();
      if (flag !== null && flag !== '0') {
        const caption = `ad atlas ${canvas.width} x ${canvas.height}, drawn in ${atlasMs.toFixed(0)} ms; ${panels.count} panels, ${objects.length} solids, ${tickers.count} tickers`;
        overlay = showAtlas(flag, canvas, previewAtlas(canvas, cells), caption);
      }

      release = (): void => {
        for (const mesh of meshes) scene.remove(mesh);
        for (const d of disposables) d.dispose();
        overlay?.remove();
      };
    },
    update(_frame: FrameState): void {},
    dispose(): void {
      release?.();
      release = null;
    },
  };
}
