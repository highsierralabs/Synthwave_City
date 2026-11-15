// Adaptive render scale (plan T02, M4). Pure logic: feed it frame times, it says when to resize.
//
// Under vsync a frame can never be faster than the display, so "headroom" cannot be measured
// directly. The scale therefore steps down quickly when frames run long, and only tries a step up
// after a calm spell; a step up that fails is remembered, and the next attempt waits longer.

export interface AdaptiveOptions {
  min: number;
  max: number;
  /** Frame time to hold, ms. */
  targetMs?: number;
  step?: number;
}

export class AdaptiveScale {
  scale: number;
  private readonly min: number;
  private readonly max: number;
  private readonly targetMs: number;
  private readonly step: number;
  private ema = 0;
  private over = 0;
  private calm = 0;
  private cooldown = 0;
  private sinceStepUp = Infinity;
  private retryAfter = 6;

  constructor(options: AdaptiveOptions) {
    this.min = options.min;
    this.max = options.max;
    this.targetMs = options.targetMs ?? 16.7;
    this.step = options.step ?? 0.1;
    this.scale = options.max;
  }

  /** frameMs: time the last frame took. dt: seconds since the last call. Returns true when scale changed. */
  update(frameMs: number, dt: number): boolean {
    if (!(dt > 0) || !(frameMs > 0)) return false;
    this.ema = this.ema === 0 ? frameMs : this.ema + (frameMs - this.ema) * Math.min(1, dt * 4);
    this.sinceStepUp += dt;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return false;
    }
    if (this.ema > this.targetMs * 1.15) {
      this.over += dt;
      this.calm = 0;
    } else if (this.ema < this.targetMs * 1.04) {
      this.calm += dt;
      this.over = Math.max(0, this.over - dt);
    } else {
      this.calm = 0;
      this.over = Math.max(0, this.over - dt * 0.5);
    }
    if (this.over >= 1 && this.scale > this.min) {
      // A step up that had to be undone within a few seconds was a mistake: wait longer next time.
      if (this.sinceStepUp < 5) this.retryAfter = Math.min(240, this.retryAfter * 2);
      this.scale = Math.max(this.min, this.scale - this.step);
      this.settle();
      return true;
    }
    if (this.calm >= this.retryAfter && this.scale < this.max) {
      this.scale = Math.min(this.max, this.scale + this.step / 2);
      this.sinceStepUp = 0;
      this.settle();
      return true;
    }
    return false;
  }

  private settle(): void {
    this.over = 0;
    this.calm = 0;
    this.cooldown = 1.2;
    this.ema = 0;
  }
}
