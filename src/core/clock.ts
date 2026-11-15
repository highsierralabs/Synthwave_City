// The loop clock (architecture.md section 4.3): time in [0, LOOP_SECONDS), wrapped in double
// precision, driven by requestAnimationFrame timestamps. No Date.now, no performance.now.
import { BEATS_PER_LOOP, LOOP_SECONDS } from '../contracts/constants';

/** Longest step the clock takes in one frame. A hidden tab or a breakpoint does not fast-forward the city. */
export const MAX_DT = 0.1;

export class LoopClock {
  /** Seconds in [0, LOOP_SECONDS). */
  time = 0;
  /** Seconds advanced by the last call. */
  dt = 0;
  private last: number | null = null;
  private frozen = false;

  constructor(startTime = 0) {
    this.time = ((startTime % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  }

  /** Advance from a requestAnimationFrame timestamp in milliseconds. */
  advance(timestampMs: number): void {
    if (this.frozen) {
      this.dt = 0;
      this.last = timestampMs;
      return;
    }
    let dt = this.last === null ? 0 : (timestampMs - this.last) / 1000;
    this.last = timestampMs;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;
    this.step(dt);
  }

  /** Advance by a number of seconds directly (tests, fixed-step runs). */
  step(dt: number): void {
    this.dt = dt;
    let t = this.time + dt;
    if (t >= LOOP_SECONDS) t -= LOOP_SECONDS * Math.floor(t / LOOP_SECONDS);
    this.time = t;
  }

  /** Jump to a time and stop there (screenshots). */
  freezeAt(time: number): void {
    this.time = ((time % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
    this.dt = 0;
    this.frozen = true;
  }

  unfreeze(): void {
    this.frozen = false;
    this.last = null;
  }

  /** Forget the last timestamp, so the next advance takes a zero step (after a pause or a hidden tab). */
  resync(): void {
    this.last = null;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /** time / LOOP_SECONDS in [0, 1). */
  get loop(): number {
    return this.time / LOOP_SECONDS;
  }

  /** Beats since the loop start, fractional. Wraps seamlessly because BEATS_PER_LOOP is whole. */
  get beat(): number {
    return (this.time / LOOP_SECONDS) * BEATS_PER_LOOP;
  }
}
