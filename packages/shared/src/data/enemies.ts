/** Enemy tuning (§4.6). */
export type EnemyType = 'walker' | 'runner' | 'brute' | 'outlaw' | 'werewolf' | 'vampire';

export interface EnemyDef {
  type: EnemyType;
  hp: number;
  speed: number;
  /** Speed while chasing. */
  chaseSpeed: number;
  damage: number;
  attackRange: number;
  attackInterval: number;
  /** How far they notice players by sight. */
  sight: number;
  /** Climb onto the train (§4.3). */
  boards: boolean;
  /** Scale of the body (brutes are big). */
  scale: number;
  /** Selling price and fuel value of the body (§4.10, §4.3). */
  bodyValue: number;
  bodyFuel: number;
  /** Spawn weight by phase [day, night]. */
  weight: [number, number];
  /** First night this type can appear (0 = any time). */
  fromNight: number;
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  walker: {
    type: 'walker',
    hp: 65,
    speed: 1.1,
    chaseSpeed: 1.9,
    damage: 12,
    attackRange: 1.4,
    attackInterval: 1.3,
    sight: 35,
    boards: true,
    scale: 1,
    bodyValue: 6,
    bodyFuel: 20,
    weight: [1, 1],
    fromNight: 0,
  },
  runner: {
    type: 'runner',
    hp: 45,
    speed: 2,
    chaseSpeed: 6.6,
    damage: 9,
    attackRange: 1.3,
    attackInterval: 0.8,
    sight: 50,
    boards: true,
    scale: 0.95,
    bodyValue: 8,
    bodyFuel: 16,
    weight: [0.25, 0.6],
    fromNight: 0,
  },
  brute: {
    type: 'brute',
    hp: 420,
    speed: 1,
    chaseSpeed: 2.6,
    damage: 34,
    attackRange: 2,
    attackInterval: 1.8,
    sight: 40,
    boards: true,
    scale: 1.35,
    bodyValue: 30,
    bodyFuel: 60,
    weight: [0, 0.18],
    fromNight: 2,
  },
  outlaw: {
    type: 'outlaw',
    hp: 90,
    speed: 1.6,
    chaseSpeed: 3.5,
    damage: 14,
    attackRange: 40,
    attackInterval: 1.6,
    sight: 70,
    boards: false,
    scale: 1,
    bodyValue: 0,
    bodyFuel: 20,
    weight: [0, 0],
    fromNight: 0,
  },
  werewolf: {
    type: 'werewolf',
    hp: 260,
    speed: 3,
    chaseSpeed: 8.5,
    damage: 26,
    attackRange: 1.8,
    attackInterval: 0.9,
    sight: 80,
    boards: true,
    scale: 1.2,
    bodyValue: 60,
    bodyFuel: 40,
    weight: [0, 0],
    fromNight: 0,
  },
  vampire: {
    type: 'vampire',
    hp: 200,
    speed: 3,
    chaseSpeed: 7,
    damage: 18,
    attackRange: 1.6,
    attackInterval: 0.7,
    sight: 80,
    boards: true,
    scale: 1.05,
    bodyValue: 70,
    bodyFuel: 30,
    weight: [0, 0],
    fromNight: 0,
  },
};

/** Spawn director (§4.6). */
export const DIRECTOR = {
  /** Hard cap of active enemies per room. */
  maxEnemies: 80,
  /** Base enemies kept around the party by day and by night. */
  dayBudget: 10,
  nightBudget: 42,
  /** Extra budget per additional player. */
  perPlayer: 0.35,
  /** Growth per HUD km travelled (later is harder). */
  perKm: 0.012,
  /** Noise adds budget for a while (gunshots, whistle). */
  noiseBudget: 8,
  noiseDecay: 0.12,
  spawnMin: 45,
  spawnMax: 95,
  /** Despawn when this far from every player. */
  despawn: 190,
  spawnInterval: 0.6,
} as const;

/** AI update rates by distance from the nearest player (§6.10). */
export const AI_LOD = { full: 80, reduced: 150, reducedHz: 5 } as const;
