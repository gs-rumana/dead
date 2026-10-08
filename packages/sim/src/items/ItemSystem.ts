import {
  CARGO_SLOTS,
  CONSIST,
  ENEMIES,
  type EnemyType,
  FORT,
  FORT_POINTS,
  Frame,
  HANDCAR,
  HANDCAR_SLOTS,
  handcarToWorld,
  ITEMS,
  type ItemKind,
  LOOT,
  type LootTable,
  PACK_SLOTS,
  PLATFORM_TOP,
  type Piece,
  SELL_RATE,
  DOCTOR_HEAL_PRICE,
  sellPrice,
  type Structure,
  TRAIN,
  WEAPONS,
  type WeaponId,
  hashInts,
  isBulky,
  pieceWorld,
  trainToWorld,
  trainInteractables,
  worldToTrain,
} from '@dead-tracks/shared';
import { Rng } from '@dead-tracks/shared';
import { addToHotbar } from '../combat/inventory.ts';
import type { Sim, SimPlayer } from '../Sim.ts';

/** A thing lying in the world, on the train, or in someone's hands (§4.8). */
export interface SimItem {
  id: string;
  kind: ItemKind;
  frame: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  flying: boolean;
  /** Player carrying it ('' if none). */
  holder: string;
  /** Cargo slot index, or -1. */
  slot: number;
  /** Cash amount for cash bundles. */
  amount: number;
  searched: boolean;
  /** For bodies: what it was. */
  body: EnemyType | '';
  /** World position (cached). */
  wx: number;
  wy: number;
  wz: number;
  born: number;
}

/** Interaction targets the client names in a 'use' command. */
export type UseTarget = string;

const ACTIVATE_RANGE = 170;
const USE_RANGE = 3.2;
const MAX_BODIES = 40;

/**
 * Items, containers, doors, shops, cargo, the furnace and fortifications (§4.3,
 * §4.8, §4.10). Placement comes from the deterministic World; everything that
 * changes lives here and is synced.
 */
export class ItemSystem {
  readonly items = new Map<string, SimItem>();
  /** Dynamic structure state: "st:piece" → 0/1 (door open, searched, broken). */
  readonly props = new Map<string, number>();
  /** Fortification per point: 0 none, 1 plate, 2 wire; and health. */
  readonly forts: number[] = FORT_POINTS.map(() => 0);
  readonly fortHp: number[] = FORT_POINTS.map(() => 0);
  private readonly activated = new Set<string>();
  private nextId = 1;
  private activateT = 0;
  private boughtCount = 0;

  constructor(private readonly sim: Sim) {}

  spawn(
    kind: ItemKind,
    frame: number,
    x: number,
    y: number,
    z: number,
    yaw = 0,
    extra: Partial<SimItem> = {},
  ): SimItem {
    const it: SimItem = {
      id: extra.id ?? `i${this.nextId++}`,
      kind,
      frame,
      x,
      y,
      z,
      yaw,
      vx: 0,
      vy: 0,
      vz: 0,
      flying: false,
      holder: '',
      slot: -1,
      amount: kind === 'cash' ? 10 : 0,
      searched: false,
      body: '',
      wx: x,
      wy: y,
      wz: z,
      born: this.sim.time,
      ...extra,
    };
    this.items.set(it.id, it);
    this.updateWorld(it);
    return it;
  }

  remove(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.holder) {
      const p = this.sim.players.get(it.holder);
      if (p) this.clearCarry(p);
    }
    this.items.delete(id);
  }

  // ---------------- per tick ----------------

  step(dt: number): void {
    this.activateT -= dt;
    if (this.activateT <= 0) {
      this.activateT = 1;
      this.activateNearby();
    }
    for (const it of this.items.values()) {
      if (it.holder) this.followHolder(it);
      else if (it.flying) this.fly(it, dt);
      this.updateWorld(it);
    }
  }

  /** Spawn the loose loot of structures players come near (once per run). */
  private activateNearby(): void {
    for (const p of this.sim.players.values()) {
      for (const st of this.sim.world.structuresNear(p.wx, p.wz, ACTIVATE_RANGE)) {
        if (this.activated.has(st.id)) continue;
        this.activated.add(st.id);
        st.spawns.forEach((sp, i) => {
          const w = pieceWorld(st, { x: sp.x, y: sp.y, z: sp.z } as Piece);
          this.spawn(sp.kind, Frame.World, w.x, w.y, w.z, st.yaw + sp.ry, { id: `${st.id}.${i}` });
        });
      }
    }
  }

  private updateWorld(it: SimItem): void {
    if (it.frame >= Frame.Handcar) {
      const pose = this.sim.handcarPoses[it.frame - Frame.Handcar];
      if (pose) {
        const w = handcarToWorld(pose, it.x, it.y, it.z, { x: 0, y: 0, z: 0 });
        it.wx = w.x;
        it.wy = w.y;
        it.wz = w.z;
      }
      return;
    }
    if (it.frame === Frame.World) {
      it.wx = it.x;
      it.wy = it.y;
      it.wz = it.z;
    } else {
      const w = trainToWorld(this.sim.poses, it.x, it.y, it.z, { x: 0, y: 0, z: 0 });
      it.wx = w.x;
      it.wy = w.y;
      it.wz = w.z;
    }
  }

  private followHolder(it: SimItem): void {
    const p = this.sim.players.get(it.holder);
    if (!p) {
      it.holder = '';
      return;
    }
    const m = p.motor;
    // Held in both hands in front of the chest, in the holder's frame.
    it.frame = m.frame;
    it.x = m.x - Math.sin(m.yaw) * 0.5;
    it.y = m.y + 0.95;
    it.z = m.z - Math.cos(m.yaw) * 0.5;
    it.yaw = m.yaw;
  }

  private fly(it: SimItem, dt: number): void {
    const sim = this.sim;
    it.vy -= 9.81 * dt;
    const nx = it.x + it.vx * dt;
    const ny = it.y + it.vy * dt;
    const nz = it.z + it.vz * dt;
    if (it.frame === Frame.Train) {
      // Land on whatever is below in train space, or fall off into the world.
      const hit = sim.space.rayTrain(
        nx,
        it.y + 0.3,
        nz,
        0,
        -1,
        0,
        0.3 + Math.max(0, it.y - ny) + 0.05,
      );
      if (hit) {
        it.x = nx;
        it.z = nz;
        it.y = it.y + 0.3 - hit.toi;
        this.settle(it);
        return;
      }
      it.x = nx;
      it.y = ny;
      it.z = nz;
      if (
        Math.abs(it.x) > 1.7 ||
        it.y < -0.3 ||
        it.z < -1 ||
        it.z > CONSIST[CONSIST.length - 1]!.z1 + 1
      ) {
        const w = trainToWorld(sim.poses, it.x, it.y, it.z, { x: 0, y: 0, z: 0 });
        it.frame = Frame.World;
        it.x = w.x;
        it.y = w.y;
        it.z = w.z;
        // Keep the train's speed as it falls off.
        const pose = sim.poses[0]!;
        it.vx += -pose.bx * sim.train.speed;
        it.vz += -pose.bz * sim.train.speed;
      }
      return;
    }
    const ground = sim.terrain.height(nx, nz);
    const surface = sim.space.rayGround(
      nx,
      it.y + 0.4,
      nz,
      0,
      -1,
      0,
      0.4 + Math.max(0, it.y - ny) + 0.05,
    );
    const floor = surface ? it.y + 0.4 - surface.toi : ground;
    if (ny <= Math.max(floor, ground)) {
      it.x = nx;
      it.z = nz;
      it.y = Math.max(floor, ground);
      this.settle(it);
      return;
    }
    it.x = nx;
    it.y = ny;
    it.z = nz;
  }

  private settle(it: SimItem): void {
    it.flying = false;
    it.vx = it.vy = it.vz = 0;
  }

  // ---------------- commands ----------------

  /** E on a named target (§4.8 world interactions). */
  use(p: SimPlayer, target: UseTarget, hold: boolean): void {
    if (p.life !== 0 || p.motor.driving) return;
    const [kind, a, b] = target.split(':') as [string, string?, string?];
    switch (kind) {
      case 'item':
        if (a) this.useItem(p, a, hold);
        break;
      case 'door':
        if (a && b) this.toggleDoor(p, a, Number(b));
        break;
      case 'search':
        if (a && b && hold) this.search(p, a, Number(b));
        break;
      case 'lever':
      case 'brazier':
        if (a && b) this.sim.landmarks.trigger(p, a, Number(b));
        break;
      case 'unlock':
        if (a && b) this.sim.landmarks.unlock(p, a, Number(b));
        break;
      case 'cargo':
        this.stow(p);
        break;
      case 'firebox':
        this.burn(p);
        break;
      case 'fort':
        if (a) this.fortify(p, Number(a));
        break;
      case 'shop':
        if (a && p.carry) this.sellCarried(p, a);
        break;
    }
  }

  private near(p: SimPlayer, x: number, y: number, z: number, range = USE_RANGE): boolean {
    return Math.hypot(p.wx - x, p.wy + 1 - y, p.wz - z) <= range;
  }

  private useItem(p: SimPlayer, id: string, hold: boolean): void {
    const it = this.items.get(id);
    if (!it || it.holder || !this.near(p, it.wx, it.wy, it.wz)) return;
    // Hold E on a body to search it (§4.8: bodies can be searched).
    if (it.kind === 'corpse' && hold) {
      if (it.searched) return;
      it.searched = true;
      this.giveLoot(p, 'body', hashInts(this.sim.seed, 0xb0d, Number(id.replace(/\D/g, '')) || 0));
      return;
    }
    if (isBulky(it.kind)) {
      if (p.carry) return;
      it.holder = p.id;
      it.slot = -1;
      it.flying = false;
      p.carry = it.id;
      p.motor.carry = ITEMS[it.kind].carrySpeed ?? 0.75;
      return;
    }
    if (this.pickupSmall(p, it.kind, it.amount)) this.items.delete(id);
  }

  /** Small items go straight into the backpack or the right pool (§4.8). Returns false if no room. */
  pickupSmall(p: SimPlayer, kind: ItemKind, amount = 0): boolean {
    const inv = p.inv;
    const def = ITEMS[kind];
    switch (def.cls) {
      case 'ammo': {
        const n = def.rounds ?? 6;
        if (kind === 'ammo_pistol') inv.pistol += n;
        else if (kind === 'ammo_rifle') inv.rifle += n;
        else inv.shells += n;
        return true;
      }
      case 'med':
        if (kind === 'bandage') inv.bandage++;
        else inv.tonic++;
        return true;
      case 'throwable':
        if (kind === 'dynamite') inv.dynamite++;
        else inv.holywater++;
        addToHotbar(inv, kind as WeaponId);
        return true;
      case 'weapon':
        return addToHotbar(inv, kind as WeaponId) >= 0;
      case 'valuable':
        if (kind === 'cash') {
          inv.cash += amount || 10;
          return true;
        }
        if (inv.pack.length >= PACK_SLOTS) {
          this.sim.toast(p.id, 'Your backpack is full');
          return false;
        }
        inv.pack.push(kind);
        return true;
      default:
        return false;
    }
  }

  private clearCarry(p: SimPlayer): void {
    p.carry = '';
    p.motor.carry = 1;
  }

  /** G drops what you carry; holding G throws it (§4.8). */
  drop(p: SimPlayer, throwIt: boolean): void {
    const it = p.carry ? this.items.get(p.carry) : undefined;
    if (!it) {
      this.clearCarry(p);
      return;
    }
    this.clearCarry(p);
    it.holder = '';
    const m = p.motor;
    const fx = -Math.sin(m.yaw);
    const fz = -Math.cos(m.yaw);
    // Seated players drop things into the world beside them.
    const onHandcar = m.frame >= Frame.Handcar;
    it.frame = onHandcar ? Frame.World : m.frame;
    it.x = (onHandcar ? p.wx : m.x) + fx * 0.7;
    it.y = (onHandcar ? p.wy : m.y) + (throwIt ? 1.3 : 0.9);
    it.z = (onHandcar ? p.wz : m.z) + fz * 0.7;
    const speed = throwIt ? 7.5 : 1;
    it.vx = fx * speed + (m.frame === Frame.World ? m.vx : 0);
    it.vy = throwIt ? 3 : 0;
    it.vz = fz * speed + (m.frame === Frame.World ? m.vz : 0);
    it.flying = true;
  }

  /** Snap the carried item into the nearest free cargo slot (§4.8). */
  private stow(p: SimPlayer): void {
    const it = p.carry ? this.items.get(p.carry) : undefined;
    if (!it) return;
    const t = worldToTrain(this.sim.poses, p.wx, p.wy, p.wz, { x: 0, y: 0, z: 0 });
    if (Math.abs(t.x) > 4 || t.z < CONSIST[2]!.z0 - 4 || t.z > CONSIST[2]!.z1 + 4) return;
    let best = -1;
    let bestD = Infinity;
    CARGO_SLOTS.forEach((s, i) => {
      if (this.slotTaken(i)) return;
      const d = Math.hypot(s.x - t.x, s.z - t.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) {
      this.sim.toast(p.id, 'The cargo slots are full');
      return;
    }
    const s = CARGO_SLOTS[best]!;
    this.clearCarry(p);
    it.holder = '';
    it.frame = Frame.Train;
    it.slot = best;
    it.x = s.x;
    it.y = s.y;
    it.z = s.z;
    it.yaw = 0;
    it.flying = false;
  }

  /** Load the carried item onto a handcar slot, or hitch a trolley (§4.4). */
  loadHandcar(p: SimPlayer, i: number): void {
    const it = p.carry ? this.items.get(p.carry) : undefined;
    const hc = this.sim.handcars[i];
    if (!it || !hc) return;
    if (it.kind === 'trolley_kit') {
      if (hc.trolley) {
        this.sim.toast(p.id, 'This handcar already has a trolley');
        return;
      }
      hc.trolley = true;
      this.remove(it.id);
      this.sim.toast(p.id, 'Trolley hitched: two more cargo spaces');
      return;
    }
    const frame = Frame.Handcar + i;
    const max = HANDCAR.slots + (hc.trolley ? HANDCAR.trolleySlots : 0);
    let slot = -1;
    for (let k = 0; k < max; k++) {
      let taken = false;
      for (const o of this.items.values())
        if (o.frame === frame && o.slot === k && !o.holder) taken = true;
      if (!taken) {
        slot = k;
        break;
      }
    }
    if (slot < 0) {
      this.sim.toast(
        p.id,
        hc.trolley
          ? 'The handcar and trolley are full'
          : 'The handcar is full; a trolley would hold more',
      );
      return;
    }
    const pos = HANDCAR_SLOTS[slot]!;
    this.clearCarry(p);
    it.holder = '';
    it.frame = frame;
    it.slot = slot;
    it.x = pos.x;
    it.y = HANDCAR.deck;
    it.z = pos.z;
    it.yaw = 0;
    it.flying = false;
  }

  slotTaken(i: number): boolean {
    for (const it of this.items.values())
      if (it.slot === i && it.frame === Frame.Train && !it.holder) return true;
    return false;
  }

  /** Throw the carried item into the firebox (§4.3). */
  private burn(p: SimPlayer): void {
    const it = p.carry ? this.items.get(p.carry) : undefined;
    if (!it) return;
    const fire = trainInteractables().find((f) => f.id === 'firebox')!;
    const fw = trainToWorld(this.sim.poses, fire.x, fire.y, fire.tz, { x: 0, y: 0, z: 0 });
    if (!this.near(p, fw.x, fw.y, fw.z, 3)) return;
    const fuel = it.kind === 'corpse' && it.body ? ENEMIES[it.body].bodyFuel : ITEMS[it.kind].fuel;
    if (fuel <= 0) {
      this.sim.toast(p.id, `${ITEMS[it.kind].name} won't burn`);
      return;
    }
    const train = this.sim.train;
    if (train.fuel > TRAIN.fireboxMax - 5) {
      this.sim.toast(p.id, 'The firebox is full');
      return;
    }
    train.fuel = Math.min(TRAIN.fireboxMax, train.fuel + fuel);
    this.remove(it.id);
    this.sim.events.push({ ev: { e: 'stoke', by: p.id } });
  }

  /** Bolt a plate or string wire at a fortification point (§4.3). */
  private fortify(p: SimPlayer, point: number): void {
    const it = p.carry ? this.items.get(p.carry) : undefined;
    const fp = FORT_POINTS[point];
    if (!it || !fp || (it.kind !== 'plate' && it.kind !== 'wire')) return;
    const w = trainToWorld(this.sim.poses, fp.x, fp.y, fp.z, { x: 0, y: 0, z: 0 });
    if (!this.near(p, w.x, w.y, w.z, 4)) return;
    this.forts[point] = it.kind === 'plate' ? 1 : 2;
    this.fortHp[point] = it.kind === 'plate' ? FORT.plateHp : FORT.wireHp;
    this.remove(it.id);
    this.sim.events.push({
      ev: { e: 'toast', to: p.id, text: it.kind === 'plate' ? 'Plate bolted on' : 'Wire strung' },
    });
  }

  /** The fortification covering a train-space side position, if any. */
  fortAt(x: number, z: number): number {
    for (let i = 0; i < FORT_POINTS.length; i++) {
      const f = FORT_POINTS[i]!;
      if (this.forts[i] && Math.sign(f.x) === Math.sign(x) && z >= f.z0 && z <= f.z1) return i;
    }
    return -1;
  }

  damageFort(i: number, dmg: number): void {
    this.fortHp[i] = Math.max(0, (this.fortHp[i] ?? 0) - dmg);
    if (this.fortHp[i] === 0) this.forts[i] = 0;
  }

  // ---------------- structures ----------------

  private findPiece(stId: string, pieceId: number): { st: Structure; piece: Piece } | null {
    const st = this.sim.world.structure(stId);
    const piece = st?.pieces[pieceId];
    return st && piece ? { st, piece } : null;
  }

  private toggleDoor(p: SimPlayer, stId: string, pieceId: number): void {
    const f = this.findPiece(stId, pieceId);
    if (!f || f.piece.kind !== 'door') return;
    const w = pieceWorld(f.st, f.piece);
    if (!this.near(p, w.x, w.y, w.z, 3)) return;
    const key = `${stId}:${pieceId}`;
    const state = this.props.get(key) ? 0 : 1;
    this.props.set(key, state);
    this.sim.space.setPieceState(key, state);
  }

  breakBoard(stId: string, pieceId: number): void {
    const key = `${stId}:${pieceId}`;
    if (this.props.get(key)) return;
    this.props.set(key, 1);
    this.sim.space.setPieceState(key, 1);
  }

  /** Boards within reach of a swing or a blast break (§4.8). */
  breakBoardsNear(x: number, y: number, z: number, r: number): void {
    for (const st of this.sim.world.structuresNear(x, z, r + 2)) {
      for (const piece of st.pieces) {
        if (piece.kind !== 'board') continue;
        const w = pieceWorld(st, piece);
        if (Math.hypot(w.x - x, w.y - y, w.z - z) <= r + 0.6) this.breakBoard(st.id, piece.id);
      }
    }
  }

  private search(p: SimPlayer, stId: string, pieceId: number): void {
    const f = this.findPiece(stId, pieceId);
    if (!f || !f.piece.loot) return;
    const w = pieceWorld(f.st, f.piece);
    if (!this.near(p, w.x, w.y, w.z, 3)) return;
    const key = `${stId}:${pieceId}`;
    if (this.props.get(key)) return;
    this.props.set(key, 1);
    if (this.sim.landmarks.isKeyPiece(stId, pieceId)) {
      // Grayson Ranch: the cellar key (§4.6).
      if (!this.pickupSmall(p, 'cellar_key'))
        this.spawn('cellar_key', p.motor.frame, p.motor.x, p.motor.y + 0.2, p.motor.z, 0, { flying: true });
      this.sim.broadcast('Someone found the cellar key!');
    }
    this.giveLoot(
      p,
      f.piece.loot,
      hashInts(this.sim.seed, 0x5ea, pieceId, stId.length * 997 + stId.charCodeAt(1)),
    );
  }

  private giveLoot(p: SimPlayer, table: LootTable, seed: number): void {
    const rng = new Rng(seed);
    const entries = LOOT[table];
    const rolls = table === 'safe' ? 3 : 1 + rng.int(0, 1);
    const found: string[] = [];
    for (let i = 0; i < rolls; i++) {
      const kind = rng.weighted(
        entries.map((e) => e[0]),
        entries.map((e) => e[1]),
      ) as ItemKind | '';
      if (!kind) continue;
      const amount = kind === 'cash' ? 5 + rng.int(0, 20) : 0;
      if (this.pickupSmall(p, kind, amount))
        found.push(kind === 'cash' ? `$${amount}` : ITEMS[kind].name);
      else {
        // No room: drop it at their feet.
        this.spawn(kind, p.motor.frame, p.motor.x, p.motor.y + 0.2, p.motor.z, 0, {
          amount,
          flying: true,
        });
      }
    }
    this.sim.toast(p.id, found.length ? `Found ${found.join(', ')}` : 'Nothing useful');
  }

  // ---------------- economy (§4.10) ----------------

  private shopNear(p: SimPlayer, stId: string): Structure | null {
    const st = this.sim.world.structure(stId);
    if (!st?.shop) return null;
    const piece = st.pieces[st.shop.piece]!;
    const w = pieceWorld(st, piece);
    return this.near(p, w.x, w.y, w.z, 5) ? st : null;
  }

  buy(p: SimPlayer, stId: string, kind: ItemKind | 'heal'): void {
    const st = this.shopNear(p, stId);
    if (kind === 'heal') {
      // The doctor patches you up (§4.4).
      if (st?.shop?.kind !== 'doctor' || p.hp >= 100) return;
      if (p.inv.cash < DOCTOR_HEAL_PRICE) {
        this.sim.toast(p.id, 'Not enough cash');
        return;
      }
      p.inv.cash -= DOCTOR_HEAL_PRICE;
      p.hp = 100;
      this.sim.toast(p.id, 'The doctor patches you up');
      return;
    }
    const line = st?.shop?.stock.find((l) => l.kind === kind);
    if (!st || !line) return;
    if (p.inv.cash < line.price) {
      this.sim.toast(p.id, 'Not enough cash');
      return;
    }
    if (isBulky(kind)) {
      p.inv.cash -= line.price;
      // Bulky goods are set out on the platform by the door (or beside the wagon).
      const counter = st.pieces[st.shop!.piece]!;
      const n = this.boughtCount++;
      const local =
        st.kind === 'wagon'
          ? { x: counter.x - counter.hx - 1.5, y: 0.3, z: -1.5 + (n % 4) * 1.0 }
          : st.kind === 'town'
            ? { x: counter.x - 3.2, y: counter.y - counter.hy + 0.3, z: ((n % 3) - 1) * 1.0 }
            : { x: 4.7, y: PLATFORM_TOP + 0.3, z: 2.2 + (n % 4) * 1.1 };
      const w = pieceWorld(st, local as Piece);
      this.spawn(kind, Frame.World, w.x, w.y, w.z, st.yaw, { flying: true });
      this.sim.toast(p.id, `${ITEMS[kind].name} is waiting outside`);
      return;
    }
    if (this.pickupSmall(p, kind)) p.inv.cash -= line.price;
  }

  sell(p: SimPlayer, stId: string, packIndex: number): void {
    const st = this.shopNear(p, stId);
    if (!st?.shop) return;
    const shop = st.shop.kind;
    const sellOne = (i: number) => {
      const kind = p.inv.pack[i] as ItemKind | undefined;
      if (!kind) return 0;
      const price = sellPrice(shop, kind);
      if (price <= 0) return 0;
      p.inv.pack.splice(i, 1);
      if (kind === 'bounty') this.sim.forts.bounties++;
      return price;
    };
    let total = 0;
    if (packIndex < 0) {
      for (let i = p.inv.pack.length - 1; i >= 0; i--) total += sellOne(i);
    } else total += sellOne(packIndex);
    if (!total)
      this.sim.toast(
        p.id,
        shop === 'sheriff' ? 'The sheriff only pays for bounties' : 'Nothing here they want',
      );
    p.inv.cash += total;
    if (total) this.sim.toast(p.id, `Sold for $${total}`);
  }

  private sellCarried(p: SimPlayer, stId: string): void {
    const st = this.shopNear(p, stId);
    const it = p.carry ? this.items.get(p.carry) : undefined;
    if (!st?.shop || !it) return;
    const value =
      it.kind === 'corpse' && it.body ? ENEMIES[it.body].bodyValue : ITEMS[it.kind].value;
    const price = Math.round(value * SELL_RATE[st.shop.kind]);
    if (price <= 0) return;
    p.inv.cash += price;
    this.remove(it.id);
    this.sim.toast(p.id, `Sold ${ITEMS[it.kind].name} for $${price}`);
  }

  /** Drop some cash as a bundle a teammate can pick up (§4.10). */
  dropCash(p: SimPlayer, amount: number): void {
    const n = Math.min(Math.floor(amount), p.inv.cash);
    if (n <= 0) return;
    p.inv.cash -= n;
    const m = p.motor;
    this.spawn(
      'cash',
      m.frame,
      m.x - Math.sin(m.yaw) * 0.6,
      m.y + 0.5,
      m.z - Math.cos(m.yaw) * 0.6,
      0,
      { amount: n, flying: true },
    );
  }

  /** An enemy on the train shoves a nearby piece of cargo off the side (§4.3). */
  knockCargo(x: number, z: number): void {
    for (const it of this.items.values()) {
      if (it.frame !== Frame.Train || it.holder || Math.hypot(it.x - x, it.z - z) > 4) continue;
      it.slot = -1;
      it.flying = true;
      const side = it.x >= 0 ? 1 : -1;
      it.vx = side * 3.5;
      it.vy = 2.5;
      it.vz = 0;
      return;
    }
  }

  /** A dead enemy becomes a body to burn, sell or search (§4.3, §4.10). */
  addBody(type: EnemyType, frame: number, x: number, y: number, z: number, yaw: number): void {
    let bodies = 0;
    let oldest: SimItem | null = null;
    for (const it of this.items.values()) {
      if (it.kind !== 'corpse' || it.holder || it.slot >= 0) continue;
      bodies++;
      if (!oldest || it.born < oldest.born) oldest = it;
    }
    if (bodies >= MAX_BODIES && oldest) this.items.delete(oldest.id);
    this.spawn('corpse', frame, x, y, z, yaw, { body: type });
  }

  static weaponOf(kind: ItemKind): WeaponId | null {
    return kind in WEAPONS ? (kind as WeaponId) : null;
  }
}
