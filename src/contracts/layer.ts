// Layers, the per-frame state, the shared uniforms and the frame pipeline
// (architecture.md sections 3.3 to 3.5 and 8.2). three is imported for types only.
import type {
  IUniform, Matrix4, PerspectiveCamera, Scene, Texture, Vector2, Vector3, Vector4, WebGLRenderer,
} from 'three';
import type { CityPlan } from './city';
import type { QualitySettings } from './quality';

export type LayerId = 'sky' | 'ground' | 'buildings' | 'streetlife' | 'airtraffic' | 'beams' | 'holograms';

/** Draw order of layers at init; later entries may assume earlier ones exist but never import them. */
export const LAYER_ORDER: readonly LayerId[] = ['sky', 'ground', 'buildings', 'streetlife', 'airtraffic', 'beams', 'holograms'];

/**
 * Uniform objects created once by the engine and shared BY REFERENCE: spread this into a material's
 * uniforms (`{ ...ctx.uniforms, uMine: { value: 1 } }`) and never clone the material.
 * The matching GLSL declarations are in SC_COMMON (./glsl.ts); do not redeclare them.
 */
export interface SharedUniforms {
  /** Seconds in [0, LOOP_SECONDS). Cosmetic animation only. */
  readonly uTime: IUniform<number>;
  /** time / LOOP_SECONDS in [0, 1). Use for lane motion: fract(laps * uLoop + phase). */
  readonly uLoop: IUniform<number>;
  /** x: pulse, 1 on the beat decaying to 0. y: bar phase 0..1 (4 beats). z: beat index 0..15. w: energy 0..1. */
  readonly uBeat: IUniform<Vector4>;
  /** Camera position: x and z wrapped into 0..TILE, y the altitude. */
  readonly uCam: IUniform<Vector3>;
  /** Far fade: x where heights start to sink, y where they reach zero. */
  readonly uFar: IUniform<Vector2>;
  /** x: uniform density, y: extra density at ground level, z: height falloff, w: cap. */
  readonly uFog: IUniform<Vector4>;
  readonly uFogWarm: IUniform<Vector3>;
  readonly uFogCool: IUniform<Vector3>;
  /** Unit vector towards the sun. */
  readonly uSunDir: IUniform<Vector3>;
  readonly uSkyTop: IUniform<Vector3>;
  readonly uSkyMid: IUniform<Vector3>;
  readonly uSkyHorizon: IUniform<Vector3>;
  readonly uSunTop: IUniform<Vector3>;
  readonly uSunBottom: IUniform<Vector3>;
  readonly uAmbient: IUniform<Vector3>;
  /** Eight linear RGB colours, already tinted by the mood. Read with sc_neon(index). */
  readonly uPalette: IUniform<Vector3[]>;
  /** Multiplier for neon emission; apply to L2 and L3 light. */
  readonly uGlow: IUniform<number>;
  readonly uStars: IUniform<number>;
  /** 0 dry .. 1 soaked. */
  readonly uWet: IUniform<number>;
  /** 1 normally; lower when the viewer prefers reduced motion. Scale strobes and fast flicker by it. */
  readonly uMotion: IUniform<number>;
  /** Drawing-buffer size of the scene target, pixels. */
  readonly uResolution: IUniform<Vector2>;
  /** CELLS x CELLS RGBA8, one texel per cell (CELL_FIELD in ./city.ts). Sample with texelFetch. */
  readonly uCellTex: IUniform<Texture>;
  /** The mirrored scene. A 1x1 black texture when there is no reflection pass. */
  readonly uReflTex: IUniform<Texture>;
  /** Maps a render-space position on the ground to uv in uReflTex (after perspective divide). */
  readonly uReflMatrix: IUniform<Matrix4>;
  /** 0 when there is no reflection pass, else 1. */
  readonly uReflAmount: IUniform<number>;
  readonly uExposure: IUniform<number>;
  /** Scanline (CRT) strength for the grade, 0 is off. Read by src/post only; not declared in SC_COMMON. */
  readonly uCrt: IUniform<number>;
}

/** Plain numbers describing the current frame. Never retain it between frames. */
export interface FrameState {
  /** Seconds in [0, LOOP_SECONDS). */
  time: number;
  /** Seconds since the previous frame, clamped. 0 when time is frozen. */
  dt: number;
  /** time / LOOP_SECONDS. */
  loop: number;
  /** Beats since the loop start, fractional. */
  beat: number;
  /** Frames rendered so far. */
  frame: number;
  /** Camera position, wrapped tile coordinates. */
  camX: number;
  camY: number;
  camZ: number;
  camYaw: number;
  camPitch: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
}

export interface LayerContext {
  /** Add your objects here. Set frustumCulled = false and matrixAutoUpdate = false on each. */
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  /** Read-only: it sits at (0, y, 0) and only rotates. */
  readonly camera: PerspectiveCamera;
  readonly plan: CityPlan;
  readonly uniforms: SharedUniforms;
  readonly quality: QualitySettings;
  /** A seed for this layer's own random choices. */
  readonly seed: number;
}

export interface Layer {
  readonly id: LayerId | string;
  /** Build everything and add it to ctx.scene. Called once, before the first frame. */
  init(ctx: LayerContext): void | Promise<void>;
  /** Per-frame CPU work, allocation-free. Most layers leave it empty. */
  update(frame: FrameState): void;
  dispose(): void;
}

/** What src/layers/<id>/index.ts must export. */
export interface LayerModule {
  createLayer(): Layer;
}

export interface PipelineHost {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly uniforms: SharedUniforms;
  readonly quality: QualitySettings;
}

export interface FramePipeline {
  /** Draw one frame to the canvas. */
  render(frame: FrameState): void;
  /** Called on resize. width and height are CSS pixels. */
  setSize(width: number, height: number, pixelRatio: number): void;
  /** Compile every program before the first frame. Optional. */
  warmUp?(): Promise<void>;
  /** Current adaptive render scale, for the stats panel. */
  readonly renderScale: number;
  dispose(): void;
}

/** What src/post/index.ts must export. */
export interface PipelineModule {
  createPipeline(host: PipelineHost): FramePipeline;
}
