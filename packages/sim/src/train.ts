import {
  Btn,
  type InputFrame,
  ROUTE_END,
  ROUTE_START,
  type Route,
  TRAIN,
  TRAIN_LENGTH,
  clamp,
} from '@dead-tracks/shared';

/** The locomotive's state and physics (§4.3). The train is never destroyed. */
export class TrainSim {
  s: number;
  speed = 0;
  throttle = 0;
  brake = 0;
  reverser = 1;
  fuel: number = TRAIN.startFuel;
  coal: number = TRAIN.startCoal;
  pressure = 0.6;
  driver = '';
  private prevDriverButtons = 0;
  stokeCooldown = 0;
  /** Development only: multiplies top speed and traction for soak tests. */
  devSpeedScale = 1;
  /** A shut gate ahead (Fort Haven): the train can't pass this s. */
  limitS = Infinity;
  /** Fuel burn multiplier (an Engineer aboard burns 20% less, §4.11). */
  burnScale = 1;

  constructor(startS: number) {
    this.s = startS;
  }

  /** Applies the driver's input. Returns true if the whistle was blown. */
  drive(input: InputFrame | null, dt: number): boolean {
    if (!input) {
      this.prevDriverButtons = 0;
      return false;
    }
    const pressed = input.buttons & ~this.prevDriverButtons;
    this.prevDriverButtons = input.buttons;
    if (input.my > 0.2)
      this.throttle = clamp(this.throttle + TRAIN.throttleRate * dt * input.my, 0, 1);
    else if (input.my < -0.2)
      this.throttle = clamp(this.throttle + TRAIN.throttleRate * dt * input.my, 0, 1);
    const braking = (input.buttons & (Btn.Brake | Btn.Jump)) !== 0;
    this.brake = clamp(this.brake + (braking ? 1 : -1) * TRAIN.brakeRate * dt, 0, 1);
    if (pressed & Btn.Reload && Math.abs(this.speed) < 0.5) this.reverser = -this.reverser;
    return (pressed & Btn.Whistle) !== 0;
  }

  step(dt: number, route: Route): void {
    const maxDir =
      (this.reverser > 0 ? TRAIN.maxSpeed : TRAIN.maxReverseSpeed) * this.devSpeedScale;
    const along = this.speed * this.reverser;
    const traction =
      this.throttle *
      this.pressure *
      TRAIN.tractionAccel *
      this.devSpeedScale *
      Math.max(0, 1 - Math.max(0, along) / maxDir);
    const grade = route.gradeAt(this.s - TRAIN_LENGTH / 2);
    const driving = this.reverser * traction - TRAIN.gravity * grade;
    const resist =
      this.brake * TRAIN.brakeDecel + TRAIN.rollingDecel + TRAIN.drag * this.speed * this.speed;

    if (Math.abs(this.speed) < 0.02) {
      if (Math.abs(driving) <= resist) this.speed = 0;
      else this.speed += (driving - Math.sign(driving) * resist) * dt;
    } else {
      const before = this.speed;
      this.speed += (driving - Math.sign(this.speed) * resist) * dt;
      if (Math.sign(this.speed) !== Math.sign(before) && Math.abs(driving) <= resist)
        this.speed = 0;
    }
    // Hard limits.
    this.speed = clamp(
      this.speed,
      -TRAIN.maxReverseSpeed * 1.1 * this.devSpeedScale,
      TRAIN.maxSpeed * 1.05 * this.devSpeedScale,
    );

    this.s += this.speed * dt;
    // Buffer stops at both ends of the line.
    const minS = ROUTE_START + TRAIN_LENGTH + 5;
    const maxS = ROUTE_END - 20;
    if (this.s < minS) {
      this.s = minS;
      this.speed = Math.max(0, this.speed);
    } else if (this.s > Math.min(maxS, this.limitS)) {
      this.s = Math.min(maxS, this.limitS);
      this.speed = Math.min(0, this.speed);
    }

    // Fuel and boiler pressure.
    const work = this.throttle * (0.35 + (0.65 * Math.abs(this.speed)) / TRAIN.maxSpeed);
    const burn =
      TRAIN.burnAtCruise * (TRAIN.idleBurnFraction + (1 - TRAIN.idleBurnFraction) * work);
    this.fuel = Math.max(0, this.fuel - burn * this.burnScale * dt);
    if (this.fuel > 0) this.pressure = Math.min(1, this.pressure + TRAIN.pressureRise * dt);
    else this.pressure = Math.max(0, this.pressure - TRAIN.pressureFall * dt);
    this.stokeCooldown = Math.max(0, this.stokeCooldown - dt);
  }

  /** One shovel of coal from the tender into the firebox. */
  stoke(): boolean {
    if (this.coal <= 0 || this.stokeCooldown > 0 || this.fuel > TRAIN.fireboxMax - 5) return false;
    this.coal--;
    this.fuel = Math.min(TRAIN.fireboxMax, this.fuel + TRAIN.coalPerShovel);
    this.stokeCooldown = TRAIN.stokeCooldown;
    return true;
  }
}
