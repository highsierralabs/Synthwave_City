// window.__sc for scripts/smoke.mjs: the same info() and measure() the dev harness exposes.
import type { CityPlan } from '../contracts/city';
import type { Engine } from '../engine/engine';

export function installDebugApi(engine: Engine, plan: CityPlan, canvas: HTMLCanvasElement, planMs: number): void {
  const probe = document.createElement('canvas');
  probe.width = 256;
  probe.height = 144;
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  const api = {
    engine,
    /** Draw a frame and return simple image statistics. Reads back in the same task as the draw. */
    measure(): { mean: number; clipped: number; black: number } {
      engine.renderNow();
      ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
      let sum = 0, clipped = 0, black = 0;
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
        sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (r >= 250 && g >= 250 && b >= 250) clipped++;
        if (r <= 3 && g <= 3 && b <= 3) black++;
      }
      return { mean: sum / pixels, clipped: clipped / pixels, black: black / pixels };
    },
    info(): Record<string, unknown> {
      const gl = engine.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        layers: engine.layerIds,
        pipeline: engine.pipelineKind,
        boxes: plan.boxCount,
        lanes: plan.lanes.length,
        sites: plan.sites.length,
        planMs: Math.round(planMs),
        drawCalls: engine.stats.drawCalls,
        triangles: engine.stats.triangles,
        fps: Math.round(engine.stats.fps),
        cpuMs: Number(engine.stats.cpuMs.toFixed(2)),
        renderScale: engine.stats.renderScale,
        tier: engine.quality.tier,
        errors: [...engine.errors],
      };
    },
  };
  (window as unknown as { __sc: typeof api }).__sc = api;
}
