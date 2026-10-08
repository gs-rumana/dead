/** Items in the world (§4.8): bulky things are carried in both hands, small ones go in the backpack. */
export type ItemKind =
  // Bulky (two-handed)
  | 'coal'
  | 'crate'
  | 'chair'
  | 'table'
  | 'cabinet'
  | 'barrel'
  | 'strongbox'
  | 'corpse'
  | 'plate'
  | 'wire'
  | 'lumber'
  // Small (backpack)
  | 'gold_bar'
  | 'gold_nugget'
  | 'silver_watch'
  | 'jewelry'
  | 'cash'
  | 'bounty'
  | 'trolley_kit'
  | 'ammo_pistol'
  | 'ammo_rifle'
  | 'ammo_shells'
  | 'bandage'
  | 'tonic'
  | 'dynamite'
  | 'holywater'
  // Weapons and tools (hotbar)
  | 'revolver'
  | 'rifle'
  | 'coachgun'
  | 'shovel'
  | 'hatchet';

export type ItemClass = 'bulky' | 'valuable' | 'ammo' | 'med' | 'throwable' | 'weapon';

export interface ItemDef {
  kind: ItemKind;
  name: string;
  cls: ItemClass;
  /** Cruise-seconds of fuel when burned (0 = won't burn). */
  fuel: number;
  /** Price at a trading post (§4.10); stations and the wagon pay less. */
  value: number;
  /** Rounds per box, for ammo. */
  rounds?: number;
  /** Walking speed multiplier while carrying (bulky only). */
  carrySpeed?: number;
}

const d = (
  kind: ItemKind,
  name: string,
  cls: ItemClass,
  fuel: number,
  value: number,
  extra: Partial<ItemDef> = {},
): ItemDef => ({
  kind,
  name,
  cls,
  fuel,
  value,
  ...extra,
});

export const ITEMS: Record<ItemKind, ItemDef> = {
  coal: d('coal', 'Coal sack', 'bulky', 45, 6, { carrySpeed: 0.7 }),
  crate: d('crate', 'Crate', 'bulky', 20, 4, { carrySpeed: 0.8 }),
  chair: d('chair', 'Chair', 'bulky', 14, 3, { carrySpeed: 0.9 }),
  table: d('table', 'Table', 'bulky', 24, 5, { carrySpeed: 0.75 }),
  cabinet: d('cabinet', 'Cabinet', 'bulky', 30, 8, { carrySpeed: 0.65 }),
  barrel: d('barrel', 'Barrel', 'bulky', 22, 4, { carrySpeed: 0.75 }),
  strongbox: d('strongbox', 'Strongbox', 'bulky', 0, 45, { carrySpeed: 0.7 }),
  corpse: d('corpse', 'Body', 'bulky', 20, 6, { carrySpeed: 0.65 }),
  plate: d('plate', 'Steel plate', 'bulky', 0, 12, { carrySpeed: 0.7 }),
  wire: d('wire', 'Barbed wire', 'bulky', 0, 8, { carrySpeed: 0.85 }),
  lumber: d('lumber', 'Lumber', 'bulky', 20, 3, { carrySpeed: 0.8 }),
  gold_bar: d('gold_bar', 'Gold bar', 'valuable', 0, 60),
  gold_nugget: d('gold_nugget', 'Gold nugget', 'valuable', 0, 16),
  silver_watch: d('silver_watch', 'Silver watch', 'valuable', 0, 12),
  jewelry: d('jewelry', 'Jewelry', 'valuable', 0, 24),
  cash: d('cash', 'Cash', 'valuable', 0, 10),
  /** An outlaw's badge: only the sheriff pays for it (§4.6 bounties). */
  bounty: d('bounty', "Outlaw's badge", 'valuable', 0, 30),
  /** A cargo trolley for the handcar (§4.4): bought or found, hitched at a junction. */
  trolley_kit: d('trolley_kit', 'Trolley', 'bulky', 0, 30, { carrySpeed: 0.6 }),
  ammo_pistol: d('ammo_pistol', 'Pistol rounds', 'ammo', 0, 6, { rounds: 12 }),
  ammo_rifle: d('ammo_rifle', 'Rifle rounds', 'ammo', 0, 10, { rounds: 8 }),
  ammo_shells: d('ammo_shells', 'Shotgun shells', 'ammo', 0, 8, { rounds: 6 }),
  bandage: d('bandage', 'Bandage', 'med', 0, 6),
  tonic: d('tonic', 'Tonic', 'med', 0, 20),
  dynamite: d('dynamite', 'Dynamite', 'throwable', 0, 12),
  holywater: d('holywater', 'Holy water', 'throwable', 0, 14),
  revolver: d('revolver', 'Revolver', 'weapon', 0, 25),
  rifle: d('rifle', 'Lever rifle', 'weapon', 0, 60),
  coachgun: d('coachgun', 'Coach gun', 'weapon', 0, 50),
  shovel: d('shovel', 'Shovel', 'weapon', 0, 6),
  hatchet: d('hatchet', 'Hatchet', 'weapon', 0, 8),
};

export const PACK_SLOTS = 8;

export function isBulky(kind: ItemKind): boolean {
  return ITEMS[kind]?.cls === 'bulky';
}

export type ShopKind =
  'station' | 'wagon' | 'gunsmith' | 'doctor' | 'general' | 'trading' | 'sheriff';

/** What each kind of shop pays, as a fraction of trading-post value (§4.4, §4.10). */
export const SELL_RATE: Record<ShopKind, number> = {
  station: 0.55,
  wagon: 0.75,
  gunsmith: 0.6,
  doctor: 0.5,
  general: 0.6,
  trading: 1,
  sheriff: 0,
};

/** Who buys what: bounties only at the sheriff (§4.6), everything else anywhere that trades. */
export function sellPrice(shop: ShopKind, kind: ItemKind): number {
  if (kind === 'bounty') return shop === 'sheriff' ? ITEMS.bounty.value : 0;
  return Math.round(ITEMS[kind].value * SELL_RATE[shop]);
}

export interface StockLine {
  kind: ItemKind;
  price: number;
}

/** Station general store stock (§4.4: coal, bandages, basic ammo, plates). */
export const STATION_STOCK: StockLine[] = [
  { kind: 'coal', price: 9 },
  { kind: 'bandage', price: 10 },
  { kind: 'ammo_pistol', price: 8 },
  { kind: 'ammo_shells', price: 12 },
  { kind: 'plate', price: 22 },
  { kind: 'wire', price: 14 },
  { kind: 'dynamite', price: 20 },
];

/** Town shops (§4.4). */
export const TOWN_STOCK: Record<
  'gunsmith' | 'doctor' | 'general' | 'trading' | 'sheriff',
  StockLine[]
> = {
  gunsmith: [
    { kind: 'revolver', price: 35 },
    { kind: 'rifle', price: 65 },
    { kind: 'coachgun', price: 55 },
    { kind: 'ammo_pistol', price: 7 },
    { kind: 'ammo_rifle', price: 11 },
    { kind: 'ammo_shells', price: 9 },
    { kind: 'dynamite', price: 18 },
  ],
  doctor: [
    { kind: 'bandage', price: 8 },
    { kind: 'tonic', price: 22 },
  ],
  general: [
    { kind: 'coal', price: 8 },
    { kind: 'plate', price: 20 },
    { kind: 'wire', price: 12 },
    { kind: 'holywater', price: 16 },
    { kind: 'hatchet', price: 9 },
    { kind: 'trolley_kit', price: 45 },
  ],
  trading: [],
  sheriff: [],
};

/** The doctor patches you up to full health for a fee (§4.4). */
export const DOCTOR_HEAL_PRICE = 15;

/** The merchant wagon rolls a few lines from this list (§4.4). */
export const WAGON_POOL: StockLine[] = [
  { kind: 'rifle', price: 70 },
  { kind: 'coachgun', price: 60 },
  { kind: 'hatchet', price: 10 },
  { kind: 'ammo_rifle', price: 12 },
  { kind: 'ammo_shells', price: 10 },
  { kind: 'tonic', price: 28 },
  { kind: 'holywater', price: 18 },
  { kind: 'dynamite', price: 18 },
  { kind: 'coal', price: 10 },
];

/** Loot tables: weighted kinds for containers and spots. */
export const LOOT = {
  drawer: [
    ['cash', 4],
    ['ammo_pistol', 3],
    ['bandage', 2],
    ['silver_watch', 2],
    ['jewelry', 1],
    ['', 3],
  ],
  cabinet: [
    ['ammo_pistol', 3],
    ['ammo_shells', 2],
    ['bandage', 2],
    ['tonic', 1],
    ['dynamite', 1],
    ['cash', 3],
    ['', 2],
  ],
  safe: [
    ['gold_bar', 2],
    ['gold_nugget', 3],
    ['jewelry', 3],
    ['cash', 3],
  ],
  body: [
    ['cash', 3],
    ['ammo_pistol', 2],
    ['', 5],
    ['bandage', 1],
    ['gold_nugget', 1],
  ],
  outlaw: [['bounty', 10]],
  saloon: [
    ['cash', 4],
    ['gold_nugget', 2],
    ['silver_watch', 2],
    ['jewelry', 1],
    ['ammo_pistol', 2],
  ],
  shelf: [
    ['ammo_pistol', 2],
    ['ammo_rifle', 1],
    ['bandage', 2],
    ['dynamite', 1],
    ['', 4],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [ItemKind | '', number]>>;
export type LootTable = keyof typeof LOOT;

/** Fortification (§4.3): plates block boarding, wire hurts climbers. */
export const FORT = {
  plateHp: 100,
  wireHp: 60,
  /** Damage per second wire deals to an enemy climbing through it. */
  wireDps: 12,
  /** Brutes break fortifications at this damage per hit. */
  bruteDamage: 34,
} as const;
