import { Btn, HANDCAR, type InputFrame, type Route, clamp } from '@dead-tracks/shared';

/** A handcar on a spur (§4.4): pumped by whoever sits at the lever. */
export class HandcarSim {
  s: number = HANDCAR.parkS;
  speed = 0;
  readonly seats: string[] = ['', '', '', ''];
  trolley = false;

  constructor(
    readonly index: number,
    readonly spur: Route,
  ) {}

  get riders(): number {
    return this.seats.filter((x) => x).length;
  }

  freeSeat(): number {
    return this.seats.indexOf('');
  }

  /** inputs: each seated player's latest input and stamina; returns stamina spent per seat. */
  step(
    dt: number,
    inputs: Array<{ seat: number; input: InputFrame | null; stamina: number; power?: number }>,
  ): number[] {
    let pump = 0;
    let pumpers = 0;
    let brake = false;
    const spent = [0, 0, 0, 0];
    let effort = 0;
    for (const { seat, input, stamina, power = 1 } of inputs) {
      if (!input) continue;
      if (input.buttons & Btn.Jump) brake = true;
      const dir = input.my > 0.25 ? 1 : input.my < -0.25 ? -1 : 0;
      // Pumping also works with the dedicated pump button.
      const pumping = dir !== 0 || (input.buttons & Btn.Pump) !== 0;
      if (!pumping || stamina <= 0.5) continue;
      // Riders on the back seats face backwards: their "forward" is -s.
      const facing = seat >= 2 ? -1 : 1;
      pump += (dir || 1) * facing;
      pumpers++;
      effort += power;
      spent[seat] = HANDCAR.pumpStamina * dt;
    }
    // Top speed follows the pumping effort (an Engineer counts for 1.25, §4.11).
    const e = Math.min(effort, 4);
    const lo = Math.floor(e);
    const top =
      (HANDCAR.speeds[lo] ?? 0) +
      ((HANDCAR.speeds[Math.min(4, lo + 1)] ?? 0) - (HANDCAR.speeds[lo] ?? 0)) * (e - lo);
    const want = pumpers ? Math.sign(pump) * top : 0;
    if (brake) this.speed = approach(this.speed, 0, HANDCAR.brakeDecel * dt);
    else if (pumpers && Math.abs(pump) > 0) {
      const target = want * (this.trolley ? 0.85 : 1);
      this.speed = approach(this.speed, target, HANDCAR.accel * dt);
    } else this.speed = approach(this.speed, 0, HANDCAR.coastDecel * dt);
    this.s += this.speed * dt;
    // Buffers at both ends of the spur.
    const min = 4;
    const max = this.spur.end - 4;
    if (this.s < min || this.s > max) {
      this.s = clamp(this.s, min, max);
      this.speed = 0;
    }
    return spent;
  }
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}
