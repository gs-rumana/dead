export const TRAIN = {
  /** Top speed on the main line (§4.3). */
  maxSpeed: 20,
  maxReverseSpeed: 5,
  /** Acceleration at full throttle and full pressure (m/s²). */
  tractionAccel: 0.9,
  /** Deceleration at full brake (m/s²). */
  brakeDecel: 2.6,
  /** Rolling resistance (m/s²) — makes the train coast to a stop without fuel. */
  rollingDecel: 0.08,
  /** Air drag coefficient: decel = drag * v². */
  drag: 0.0006,
  /** Grade effect: decel = gravity * grade. */
  gravity: 9.81,
  /** Fuel burn in "cruise seconds" per second at full throttle and top speed. */
  burnAtCruise: 1,
  /** A parked train still burns ~10% of the cruise rate (§4.3). */
  idleBurnFraction: 0.1,
  /** Seconds of cruise fuel one shovel of coal adds. */
  coalPerShovel: 30,
  /** Max fuel the firebox holds, in cruise seconds. */
  fireboxMax: 240,
  startCoal: 12,
  startFuel: 90,
  /** Pressure rise per second while the fire burns. */
  pressureRise: 0.08,
  pressureFall: 0.04,
  throttleRate: 0.6,
  brakeRate: 1.2,
  /** Seconds between shovels at the furnace. */
  stokeCooldown: 0.8,
} as const;
