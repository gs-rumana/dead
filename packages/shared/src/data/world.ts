export const WORLD = {
  /** HUD kilometres in the run (§4.1). */
  routeKm: 80,
  /** World metres per HUD km (§4.1: starts at 250 m). */
  metersPerKm: 250,
  /** Render and physics origin rebase distance (§6.7). */
  rebaseDistance: 1000,
} as const;

export const ROUTE_LENGTH = WORLD.routeKm * WORLD.metersPerKm;

export const DAY = {
  /** Seconds of daylight, dusk included (§4.5). */
  dayLength: 360,
  nightLength: 240,
  /** Start a run this far into the first day (0..1 of the day). */
  startOffset: 0.08,
} as const;

export const DAY_CYCLE = DAY.dayLength + DAY.nightLength;
