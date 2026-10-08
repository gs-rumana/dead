import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Synced run state (§6.8). The host writes it from the simulation every tick;
 * clients decode it from Colyseus patches (multiplayer) or worker patches (solo).
 */

export const PlayerState = schema(
  {
    name: t.string(),
    /** Frame enum (see Frame). */
    frame: t.uint8(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    vx: t.float32(),
    vy: t.float32(),
    vz: t.float32(),
    yaw: t.float32(),
    pitch: t.float32(),
    /** Bit flags: see PlayerFlag. */
    flags: t.uint16(),
    /** Last input sequence the host applied for this player. */
    ack: t.uint32(),
    hp: t.uint8(),
    stamina: t.uint8(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const PlayerFlag = {
  Grounded: 1 << 0,
  Sprinting: 1 << 1,
  Driving: 1 << 2,
  Aiming: 1 << 3,
} as const;

export const TrainState = schema(
  {
    /** Distance along the main line of the locomotive's front buffer, in metres. */
    s: t.float64(),
    /** Signed speed along the track (m/s); negative when reversing. */
    speed: t.float32(),
    throttle: t.float32(),
    brake: t.float32(),
    /** 1 forward, -1 reverse. */
    reverser: t.int8(),
    /** Seconds of cruising fuel in the firebox. */
    fuel: t.float32(),
    /** Coal units left in the tender. */
    coal: t.uint16(),
    /** Boiler pressure 0..1. */
    pressure: t.float32(),
    /** Session id of the player at the controls, or "". */
    driver: t.string(),
  },
  'TrainState',
);
export type TrainState = SchemaType<typeof TrainState>;

/** M0 sync probe: a spinning object driven by the host; any client can recolor it. */
export const TestObject = schema(
  {
    angle: t.float32(),
    color: t.uint32(),
    nudges: t.uint16(),
  },
  'TestObject',
);
export type TestObject = SchemaType<typeof TestObject>;

export const RunState = schema(
  {
    protocol: t.uint8(),
    seed: t.uint32(),
    code: t.string(),
    tick: t.uint32(),
    /** Seconds since the run started. */
    time: t.float64(),
    /** Position in the day/night cycle in [0, 1). 0 = dawn. */
    dayPhase: t.float32(),
    day: t.uint8(),
    train: TrainState,
    test: TestObject,
    players: t.map(PlayerState),
  },
  'RunState',
);
export type RunState = SchemaType<typeof RunState>;
