/** Bumped whenever client and server stop being compatible. */
export const PROTOCOL_VERSION = 1;

/** Authoritative simulation rate (§6.8). */
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
/** State patch rate (§6.8). */
export const PATCH_HZ = 20;
export const PATCH_MS = 1000 / PATCH_HZ;

export const MAX_PARTY = 4;
export const DEFAULT_PORT = 2567;
export const RUN_ROOM = 'run';

/** Player reference frames: positions are stored relative to the frame they stand in (§6.8). */
export const Frame = {
  World: 0,
  Train: 1,
  /** Handcars use Frame.Handcar + index. */
  Handcar: 2,
} as const;
