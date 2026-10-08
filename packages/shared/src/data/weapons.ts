/** Weapon tuning (§4.7). */
export type WeaponId =
  'revolver' | 'rifle' | 'coachgun' | 'shovel' | 'hatchet' | 'dynamite' | 'holywater';
export type AmmoId = 'pistol' | 'rifle' | 'shells';

export interface GunDef {
  kind: 'gun';
  id: WeaponId;
  name: string;
  ammo: AmmoId;
  magazine: number;
  /** Reload one round at a time (revolver, coach gun) or the whole magazine. */
  reloadPerRound: boolean;
  reloadTime: number;
  /** Seconds between shots. */
  fireInterval: number;
  damage: number;
  pellets: number;
  range: number;
  /** Spread cone half-angle (radians) from the hip and when aiming. */
  hipSpread: number;
  aimSpread: number;
  /** Bullet drop: gravity applied to the ray (m/s²); 0 = straight. */
  drop: number;
  speed: number;
  recoil: number;
  /** Noise radius that attracts enemies (§4.6). */
  noise: number;
}

export interface MeleeDef {
  kind: 'melee';
  id: WeaponId;
  name: string;
  damage: number;
  range: number;
  /** Half-angle of the swing cone. */
  arc: number;
  interval: number;
  stamina: number;
  noise: number;
}

export interface ThrowDef {
  kind: 'throw';
  id: WeaponId;
  name: string;
  damage: number;
  radius: number;
  fuse: number;
  throwSpeed: number;
  noise: number;
  /** Damage multiplier against werewolves and vampires. */
  holyBonus: number;
}

export type WeaponDef = GunDef | MeleeDef | ThrowDef;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  revolver: {
    kind: 'gun',
    id: 'revolver',
    name: 'Revolver',
    ammo: 'pistol',
    magazine: 6,
    reloadPerRound: true,
    reloadTime: 0.45,
    fireInterval: 0.32,
    damage: 34,
    pellets: 1,
    range: 80,
    hipSpread: 0.035,
    aimSpread: 0.004,
    drop: 0,
    speed: 0,
    recoil: 0.05,
    noise: 70,
  },
  rifle: {
    kind: 'gun',
    id: 'rifle',
    name: 'Lever rifle',
    ammo: 'rifle',
    magazine: 8,
    reloadPerRound: true,
    reloadTime: 0.5,
    fireInterval: 0.75,
    damage: 70,
    pellets: 1,
    range: 220,
    hipSpread: 0.05,
    aimSpread: 0.0015,
    drop: 3.5,
    speed: 180,
    recoil: 0.08,
    noise: 110,
  },
  coachgun: {
    kind: 'gun',
    id: 'coachgun',
    name: 'Coach gun',
    ammo: 'shells',
    magazine: 2,
    reloadPerRound: true,
    reloadTime: 0.6,
    fireInterval: 0.28,
    damage: 16,
    pellets: 9,
    range: 32,
    hipSpread: 0.07,
    aimSpread: 0.05,
    drop: 0,
    speed: 0,
    recoil: 0.12,
    noise: 90,
  },
  shovel: {
    kind: 'melee',
    id: 'shovel',
    name: 'Shovel',
    damage: 40,
    range: 2.1,
    arc: 0.7,
    interval: 0.75,
    stamina: 9,
    noise: 8,
  },
  hatchet: {
    kind: 'melee',
    id: 'hatchet',
    name: 'Hatchet',
    damage: 32,
    range: 1.8,
    arc: 0.6,
    interval: 0.48,
    stamina: 7,
    noise: 8,
  },
  dynamite: {
    kind: 'throw',
    id: 'dynamite',
    name: 'Dynamite',
    damage: 160,
    radius: 6,
    fuse: 3,
    throwSpeed: 16,
    noise: 150,
    holyBonus: 1,
  },
  holywater: {
    kind: 'throw',
    id: 'holywater',
    name: 'Holy water',
    damage: 45,
    radius: 3.5,
    fuse: 0,
    throwSpeed: 15,
    noise: 10,
    holyBonus: 3,
  },
};

export const HEADSHOT_MULTIPLIER = 2;
export const LIMB_MULTIPLIER = 0.7;
