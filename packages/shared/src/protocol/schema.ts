import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Synced run state (§6.8). The host writes it from the simulation every tick;
 * clients decode it from Colyseus patches (multiplayer) or worker patches (solo).
 */

/** View tags (§6.8): what each client is allowed to see. */
export const ViewTag = {
  /** The owner of a player sees their own inventory. */
  Owner: 1,
} as const;

/** Private per-player inventory (§4.8): only the owner receives it. */
export const InventoryState = schema(
  {
    /** Six hotbar slots holding item ids ('' when empty). */
    slots: t.array('string'),
    /** Rounds loaded in each slot's gun. */
    mags: t.array('uint8'),
    selected: t.uint8(),
    pistol: t.uint16(),
    rifle: t.uint16(),
    shells: t.uint16(),
    bandage: t.uint8(),
    tonic: t.uint8(),
    dynamite: t.uint8(),
    holywater: t.uint8(),
    cash: t.uint32(),
    /** Seconds until the current reload step finishes; 0 = not reloading. */
    reload: t.float32(),
  },
  'InventoryState',
);
export type InventoryState = SchemaType<typeof InventoryState>;

/** Life states (§4.9). */
export const Life = { Alive: 0, Downed: 1, Dead: 2 } as const;

export const PlayerState = schema(
  {
    name: t.string(),
    /** Frame enum (see Frame). */
    frame: t.uint8(),
    /** Feet position: absolute world metres, or train space (§6.7). float64 keeps mm precision at 20 km. */
    x: t.float64(),
    y: t.float64(),
    z: t.float64(),
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
    stamina: t.float32(),
    airTime: t.float32(),
    /** Mantle (ledge climb) time left and target, in the player's frame. */
    mantle: t.float32(),
    mx: t.float64(),
    my: t.float32(),
    mz: t.float64(),
    life: t.uint8(),
    /** Seconds left to bleed out while downed. */
    bleed: t.float32(),
    /** Revive progress 0..1 while a teammate works on this player. */
    revive: t.float32(),
    /** Item id held in hand (others render it). */
    held: t.string(),
    inv: t.ref(InventoryState).view(ViewTag.Owner),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const PlayerFlag = {
  Grounded: 1 << 0,
  Sprinting: 1 << 1,
  Driving: 1 << 2,
  Aiming: 1 << 3,
  /** Connection dropped; slot held for reconnection, character idle and protected (§6.8). */
  Away: 1 << 4,
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

/** Enemy kinds on the wire (index into ENEMY_TYPES). */
export const ENEMY_TYPES = ['walker', 'runner', 'brute', 'outlaw', 'werewolf', 'vampire'] as const;

/** Enemy animation states. */
export const Anim = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  Attack: 3,
  Hit: 4,
  Dead: 5,
  Climb: 6,
  Crouch: 7,
} as const;

/** One enemy (§4.6). Clients only receive enemies near them (StateView, §6.8). */
export const EnemyState = schema(
  {
    type: t.uint8(),
    frame: t.uint8(),
    /** World: absolute metres (float32 keeps ~2 mm at 20 km). Train: train space. */
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    yaw: t.angle({ bits: 8 }),
    anim: t.uint8(),
    /** Health 0..255 as a fraction of max. */
    hp: t.uint8(),
    /** Bit mask of lost body parts (gore, §4.7). */
    gore: t.uint8(),
  },
  'EnemyState',
);
export type EnemyState = SchemaType<typeof EnemyState>;

/** A thrown or flying object (dynamite, holy water). */
export const ProjectileState = schema(
  {
    kind: t.string(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
  },
  'ProjectileState',
);
export type ProjectileState = SchemaType<typeof ProjectileState>;

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
    enemies: t.map(EnemyState).view(),
    projectiles: t.map(ProjectileState),
    /** Night type for this cycle (§4.5): 0 clear, 1 full moon, 2 blood moon, 3 storm, 4 fog. */
    night: t.uint8(),
  },
  'RunState',
);
export type RunState = SchemaType<typeof RunState>;
