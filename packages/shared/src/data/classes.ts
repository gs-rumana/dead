/** Classes (§4.11): one free, five bought with bonds. Perk numbers live here (§12). */
export type ClassId = 'drifter' | 'medic' | 'engineer' | 'gunslinger' | 'prospector' | 'preacher';

export const CLASS_IDS: ClassId[] = ['drifter', 'medic', 'engineer', 'gunslinger', 'prospector', 'preacher'];

export interface ClassDef {
  id: ClassId;
  name: string;
  /** Bonds to unlock (0 = free). */
  cost: number;
  perks: string[];
  kit: string;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  drifter: {
    id: 'drifter',
    name: 'Drifter',
    cost: 0,
    perks: ['Balanced: no strengths, no weaknesses'],
    kit: 'Revolver, shovel',
  },
  medic: {
    id: 'medic',
    name: 'Medic',
    cost: 15,
    perks: ['Revives 50% faster', 'Bandages and tonics heal 50% more'],
    kit: 'Revolver, 2 bandages',
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    cost: 20,
    perks: [
      'The furnace burns 20% slower with an Engineer aboard',
      'Fortifies and repairs twice as fast',
      'Pumps the handcar 25% harder',
    ],
    kit: 'Coach gun, hatchet',
  },
  gunslinger: {
    id: 'gunslinger',
    name: 'Gunslinger',
    cost: 25,
    perks: ['Reloads 30% faster', 'Tighter hip fire', '+25% headshot damage'],
    kit: 'Two revolvers (12 rounds)',
  },
  prospector: {
    id: 'prospector',
    name: 'Prospector',
    cost: 25,
    perks: ['Spots valuables nearby', 'Sells loot for 15% more', 'Moves faster while carrying'],
    kit: 'Shovel, lantern',
  },
  preacher: {
    id: 'preacher',
    name: 'Preacher',
    cost: 30,
    perks: ['+50% damage against werewolves and vampires'],
    kit: 'Revolver, 2 holy water',
  },
};

/** Perk tuning. */
export const PERKS = {
  medicRevive: 1.5,
  medicHeal: 1.5,
  engineerBurn: 0.8,
  engineerFortify: 2,
  engineerPump: 1.25,
  gunslingerReload: 0.7,
  gunslingerHipSpread: 0.7,
  gunslingerHeadshot: 1.25,
  gunslingerMag: 12,
  prospectorSell: 1.15,
  prospectorCarry: 1.2,
  prospectorSpot: 25,
  preacherHoly: 1.5,
} as const;

export function isClassId(v: unknown): v is ClassId {
  return typeof v === 'string' && (CLASS_IDS as string[]).includes(v);
}

/** Shared gun numbers per class (client prediction and host checks must agree). */
export function hipSpreadFor(cls: ClassId, gun: { hipSpread: number }): number {
  return gun.hipSpread * (cls === 'gunslinger' ? PERKS.gunslingerHipSpread : 1);
}

export function magazineFor(cls: ClassId, gun: { id: string; magazine: number }): number {
  return cls === 'gunslinger' && gun.id === 'revolver' ? PERKS.gunslingerMag : gun.magazine;
}

export function reloadTimeFor(cls: ClassId, gun: { reloadTime: number }): number {
  return gun.reloadTime * (cls === 'gunslinger' ? PERKS.gunslingerReload : 1);
}
