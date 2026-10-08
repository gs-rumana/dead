import type { TrainState } from '@dead-tracks/shared';

/**
 * Client estimate of the train's route position (§6.8: vehicles are sent as
 * (track, s, speed) and clients extrapolate and smooth, so there is no jitter).
 */
export class TrainClock {
  s = 0;
  speed = 0;
  private patchS = 0;
  private patchSpeed = 0;
  private patchTime = 0;
  private ready = false;

  onPatch(t: TrainState, now: number): void {
    this.patchS = t.s;
    this.patchSpeed = t.speed;
    this.patchTime = now;
    if (!this.ready) {
      this.s = t.s;
      this.speed = t.speed;
      this.ready = true;
    }
  }

  update(dt: number, now: number, rttMs: number): number {
    if (!this.ready) return this.s;
    const ahead = (now - this.patchTime) / 1000 + rttMs / 2000;
    const target = this.patchS + this.patchSpeed * Math.min(ahead, 0.5);
    this.speed += (this.patchSpeed - this.speed) * Math.min(1, dt * 6);
    this.s += this.speed * dt;
    const err = target - this.s;
    if (Math.abs(err) > 25) this.s = target;
    else this.s += err * Math.min(1, dt * 4);
    return this.s;
  }
}
