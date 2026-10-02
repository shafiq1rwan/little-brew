export type Speed = 0 | 1 | 2 | 3;

export interface Steppable {
  step(dt: number): void;
}

/**
 * Converts real (wall-clock) frame time into fixed simulation steps.
 * - Pause (speed 0) accumulates nothing, so every system freezes together.
 * - Speed multiplies the time fed in; the step size never changes, so 3x is exactly
 *   three times as many identical steps as 1x.
 * - Real frame time is clamped (e.g. after a backgrounded tab resumes) so the café never
 *   fast-forwards through minutes of play in one frame.
 */
export class GameClock {
  speed: Speed = 1;
  private accumulator = 0;

  constructor(
    private readonly target: Steppable,
    readonly stepSec: number,
    readonly maxFrameSec = 0.25,
  ) {}

  get paused(): boolean {
    return this.speed === 0;
  }

  /** Feed real elapsed seconds; returns the number of simulation steps taken. */
  advance(realDtSec: number): number {
    if (!(realDtSec > 0)) return 0;
    const dt = Math.min(realDtSec, this.maxFrameSec);
    this.accumulator += dt * this.speed;
    let steps = 0;
    while (this.accumulator >= this.stepSec - 1e-9) {
      this.target.step(this.stepSec);
      this.accumulator -= this.stepSec;
      steps++;
    }
    return steps;
  }

  /** Drop any partial step (e.g. on tab resume). */
  resetAccumulator(): void {
    this.accumulator = 0;
  }
}
