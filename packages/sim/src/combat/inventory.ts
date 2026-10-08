import { type ClassId, type GunDef, PERKS, WEAPONS, type WeaponId } from '@dead-tracks/shared';

export const HOTBAR = 6;

/** A player's private inventory (§4.8). Mirrors InventoryState on the wire. */
export interface Inventory {
  slots: string[];
  mags: number[];
  selected: number;
  pistol: number;
  rifle: number;
  shells: number;
  bandage: number;
  tonic: number;
  dynamite: number;
  holywater: number;
  cash: number;
  /** Seconds until the current reload step completes. */
  reload: number;
  /** Seconds before the selected weapon can be used (equip, fire rate). */
  cooldown: number;
  /** Backpack slots holding small valuables (§4.8). */
  pack: string[];
}

export function starterInventory(solo: boolean, cls: ClassId = 'drifter'): Inventory {
  // Drifter kit (§4.11): revolver and shovel; one bandage each, a tonic when solo (§4.9).
  const inv: Inventory = {
    slots: ['revolver', 'shovel', 'dynamite', '', '', ''],
    mags: [6, 0, 0, 0, 0, 0],
    selected: 0,
    pistol: 24,
    rifle: 0,
    shells: 0,
    bandage: 1,
    tonic: solo ? 1 : 0,
    dynamite: 1,
    holywater: 0,
    cash: 15,
    reload: 0,
    cooldown: 0,
    pack: [],
  };
  switch (cls) {
    case 'medic':
      inv.bandage += 2;
      break;
    case 'engineer':
      inv.slots = ['coachgun', 'hatchet', 'dynamite', '', '', ''];
      inv.mags = [2, 0, 0, 0, 0, 0];
      inv.pistol = 0;
      inv.shells = 12;
      break;
    case 'gunslinger':
      // Two revolvers: one 12-round "gun" with a deeper pouch.
      inv.mags[0] = PERKS.gunslingerMag;
      inv.pistol = 36;
      break;
    case 'prospector':
      inv.slots = ['shovel', 'dynamite', '', '', '', ''];
      inv.mags = [0, 0, 0, 0, 0, 0];
      inv.pistol = 0;
      inv.cash += 10;
      break;
    case 'preacher':
      inv.slots = ['revolver', 'shovel', 'dynamite', 'holywater', '', ''];
      inv.holywater = 2;
      break;
  }
  return inv;
}

export function heldItem(inv: Inventory): string {
  return inv.slots[inv.selected] ?? '';
}

export function heldGun(inv: Inventory): GunDef | null {
  const w = WEAPONS[heldItem(inv) as WeaponId];
  return w && w.kind === 'gun' ? w : null;
}

export function reserveFor(inv: Inventory, gun: GunDef): number {
  return inv[gun.ammo];
}

export function takeReserve(inv: Inventory, gun: GunDef, n: number): number {
  const have = inv[gun.ammo];
  const take = Math.min(have, n);
  inv[gun.ammo] = have - take;
  return take;
}

/** Puts an item in the first empty hotbar slot. Returns the slot or -1. */
export function addToHotbar(inv: Inventory, item: WeaponId): number {
  if (inv.slots.includes(item)) return inv.slots.indexOf(item);
  const i = inv.slots.indexOf('');
  if (i < 0) return -1;
  inv.slots[i] = item;
  const w = WEAPONS[item];
  inv.mags[i] = w.kind === 'gun' ? w.magazine : 0;
  return i;
}
