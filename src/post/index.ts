// The frame pipeline (architecture.md section 5.6): reflection pass, scene, bloom, grade.
import { HalfFloatType, Vector2, type Uniform } from 'three';
import {
  BloomEffect, ChromaticAberrationEffect, EffectComposer, EffectPass, RenderPass,
} from 'postprocessing';
import type { FramePipeline, FrameState, PipelineHost } from '../contracts/layer';
import { AdaptiveScale } from './adaptive';
import { GradeEffect, type GradeSettings } from './grade';
import { createReflectionPass, type ReflectionPass } from './reflection';

/** Numbers T13 may retune. */
export const POST_TUNING = {
  bloomThreshold: 0.82,
  bloomSmoothing: 0.3,
  bloomIntensity: 1.15,
  bloomRadius: 0.78,
  bloomLevels: 7,
  chromaticAberration: 0.0011,
  grade: { curve: 0, hold: 0.45, vignette: 0.42, crt: 0, grain: 0.035 } satisfies GradeSettings,
};

/** Debug overrides from the page URL (dev harness only): tm=aces|neon, crt=0..1, bloom=number, ca=number. */
function urlNumber(name: string): number | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get(name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function createPipeline(host: PipelineHost): FramePipeline {
  const { renderer, scene, camera, uniforms, quality } = host;
  const tm = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('tm');

  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: quality.msaa });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    luminanceThreshold: POST_TUNING.bloomThreshold,
    luminanceSmoothing: POST_TUNING.bloomSmoothing,
    intensity: urlNumber('bloom') ?? POST_TUNING.bloomIntensity,
    mipmapBlur: true,
    radius: POST_TUNING.bloomRadius,
    levels: POST_TUNING.bloomLevels,
  });
  const ca = urlNumber('ca') ?? POST_TUNING.chromaticAberration;
  const aberration = new ChromaticAberrationEffect({ offset: new Vector2(ca, ca * 0.6), radialModulation: true, modulationOffset: 0.2 });
  const grade = new GradeEffect(uniforms.uExposure as unknown as Uniform, {
    ...POST_TUNING.grade,
    curve: tm === 'aces' ? 1 : POST_TUNING.grade.curve,
    crt: urlNumber('crt') ?? POST_TUNING.grade.crt,
  });
  const effects = new EffectPass(camera, aberration, bloom, grade);
  effects.dithering = true;
  composer.addPass(effects);

  let reflection: ReflectionPass | null = null;
  if (quality.reflectionScale > 0) reflection = createReflectionPass(host);

  const adaptive = new AdaptiveScale({ min: quality.minRenderScale, max: quality.maxRenderScale });
  let cssWidth = 1, cssHeight = 1, basePixelRatio = 1;
  const drawingSize = new Vector2();

  function applySize(): void {
    const pixelRatio = basePixelRatio * adaptive.scale;
    renderer.setPixelRatio(pixelRatio);
    composer.setSize(cssWidth, cssHeight, false);
    renderer.getDrawingBufferSize(drawingSize);
    uniforms.uResolution.value.copy(drawingSize);
    if (reflection) reflection.setSize(drawingSize.x * quality.reflectionScale, drawingSize.y * quality.reflectionScale);
  }

  return {
    get renderScale(): number {
      return adaptive.scale;
    },
    render(frame: FrameState): void {
      if (adaptive.update(frame.dt * 1000, frame.dt)) applySize();
      grade.set('uSeed', (frame.frame % 251) / 251);
      if (reflection) reflection.render();
      composer.render(frame.dt);
    },
    setSize(width: number, height: number, pixelRatio: number): void {
      cssWidth = width;
      cssHeight = height;
      basePixelRatio = pixelRatio;
      applySize();
    },
    async warmUp(): Promise<void> {
      // Compile with the composer target bound, or every program compiles again on the first frame
      // for the other output colour space (Agents.md).
      renderer.setRenderTarget(composer.inputBuffer);
      await renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(null);
    },
    dispose(): void {
      reflection?.dispose();
      composer.dispose();
    },
  };
}
