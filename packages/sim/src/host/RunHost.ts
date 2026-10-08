import { StateView } from '@colyseus/schema';
import {
  type ClientMessages,
  type GameEvent,
  type JoinOptions,
  type ServerMessages,
  ENEMY_TYPES,
  EnemyState,
  InventoryState,
  PROTOCOL_VERSION,
  PlayerFlag,
  PlayerState,
  ProjectileState,
  RunState,
  ViewTag,
  SIM_DT,
  inputFromWire,
} from '@dead-tracks/shared';
import { Sim, type SimPlayer } from '../Sim.ts';
import type { Inventory } from '../combat/inventory.ts';
import type { SimEnemy } from '../ai/EnemySystem.ts';

/** Clients receive enemies within this radius (§6.8 interest management). */
const VIEW_RADIUS = 150;
const VIEW_MAX = 80;

/** A connected client as seen by the host, independent of transport. */
export interface HostClient {
  readonly id: string;
  view?: StateView;
  send<K extends keyof ServerMessages>(type: K, msg: ServerMessages[K]): void;
}

export interface RunHostOptions {
  seed: number;
  code: string;
}

/**
 * Glue between the transport-free Sim and the synced RunState schema.
 * The Colyseus RunRoom (multiplayer) and the solo Web Worker both wrap this,
 * so the two paths run identical game code (§6.5).
 */
export class RunHost {
  readonly state = new RunState();
  private readonly clients = new Map<string, HostClient>();
  /** Enemy ids each client currently sees. */
  private readonly visible = new Map<string, Set<string>>();
  private viewTick = 0;

  private constructor(
    readonly sim: Sim,
    opts: RunHostOptions,
  ) {
    this.state.protocol = PROTOCOL_VERSION;
    this.state.seed = this.sim.seed;
    this.state.code = opts.code;
    this.writeState();
  }

  static async create(opts: RunHostOptions): Promise<RunHost> {
    return new RunHost(await Sim.create({ seed: opts.seed }), opts);
  }

  get playerCount(): number {
    return this.clients.size;
  }

  join(client: HostClient, opts: JoinOptions): void {
    if (opts.protocol !== PROTOCOL_VERSION) {
      throw new Error(`protocol mismatch: client ${opts.protocol}, host ${PROTOCOL_VERSION}`);
    }
    this.clients.set(client.id, client);
    const name = (opts.name ?? '').trim().slice(0, 20) || `Drifter ${this.clients.size}`;
    this.sim.addPlayer(client.id, name);
    const ps = new PlayerState();
    ps.name = name;
    ps.inv = new InventoryState();
    this.state.players.set(client.id, ps);
    this.writeState();
    this.attachView(client);
    client.send('welcome', {
      selfId: client.id,
      seed: this.sim.seed,
      code: this.state.code,
      protocol: PROTOCOL_VERSION,
    });
  }

  /** The client's connection dropped; its slot is held (§6.8: 60 s). */
  drop(client: HostClient): void {
    this.sim.setConnected(client.id, false);
  }

  /** The same client came back within the reconnection window. */
  reconnect(client: HostClient): void {
    this.clients.set(client.id, client);
    this.attachView(client);
    this.sim.setConnected(client.id, true);
    client.send('welcome', {
      selfId: client.id,
      seed: this.sim.seed,
      code: this.state.code,
      protocol: PROTOCOL_VERSION,
    });
  }

  /** Every client gets a view: its own inventory, and enemies near it. */
  private attachView(client: HostClient): void {
    client.view ??= new StateView();
    const ps = this.state.players.get(client.id);
    if (ps) client.view.add(ps, ViewTag.Owner);
    this.visible.set(client.id, new Set());
    this.updateViews(true);
  }

  leave(client: HostClient): void {
    this.clients.delete(client.id);
    this.visible.delete(client.id);
    this.sim.removePlayer(client.id);
    this.state.players.delete(client.id);
  }

  /** Handles an untrusted message from a client. */
  message(client: HostClient, type: string, payload: unknown): void {
    switch (type as keyof ClientMessages) {
      case 'input': {
        const input = inputFromWire(payload);
        if (input) this.sim.pushInput(client.id, input);
        break;
      }
      case 'cmd': {
        if (payload && typeof payload === 'object' && 't' in payload) {
          this.sim.command(client.id, payload as ClientMessages['cmd']);
        }
        break;
      }
      case 'ping': {
        if (typeof payload === 'number') client.send('pong', payload);
        break;
      }
      case 'viewDelay': {
        if (typeof payload === 'number') this.sim.setViewDelay(client.id, payload);
        break;
      }
    }
  }

  /** Advances the simulation one fixed tick and writes the result into the schema. */
  step(dt = SIM_DT): void {
    this.sim.step(dt);
    this.writeState();
    this.updateViews(false);
    this.flushEvents();
  }

  /** Interest management (§6.8): each client sees the nearest enemies within 150 m. */
  private updateViews(force: boolean): void {
    this.viewTick++;
    if (!force && this.viewTick % 3 !== 0) return;
    const enemies = [...this.sim.enemySystem.enemies.values()];
    for (const client of this.clients.values()) {
      const view = client.view;
      const p = this.sim.players.get(client.id);
      const seen = this.visible.get(client.id);
      if (!view || !p || !seen) continue;
      const near: Array<{ e: SimEnemy; d: number }> = [];
      for (const e of enemies) {
        const d = Math.hypot(e.wx - p.wx, e.wz - p.wz);
        if (d <= VIEW_RADIUS) near.push({ e, d });
      }
      near.sort((a, b) => a.d - b.d);
      const want = new Set(near.slice(0, VIEW_MAX).map((n) => n.e.id));
      for (const id of seen) {
        if (!want.has(id)) {
          const es = this.state.enemies.get(id);
          if (es) view.remove(es);
          seen.delete(id);
        }
      }
      for (const id of want) {
        if (seen.has(id)) continue;
        const es = this.state.enemies.get(id);
        if (!es) continue;
        view.add(es);
        seen.add(id);
      }
    }
  }

  private writeState(): void {
    const { sim, state } = this;
    state.tick = sim.tick;
    state.time = sim.time;
    state.dayPhase = sim.dayPhase;
    state.day = sim.day;
    state.test.angle = sim.test.angle;
    state.test.color = sim.test.color;
    state.test.nudges = sim.test.nudges;
    const tr = sim.train;
    const ts = state.train;
    ts.s = tr.s;
    ts.speed = tr.speed;
    ts.throttle = tr.throttle;
    ts.brake = tr.brake;
    ts.reverser = tr.reverser;
    ts.fuel = tr.fuel;
    ts.coal = tr.coal;
    ts.pressure = tr.pressure;
    ts.driver = tr.driver;
    state.night = sim.nightType;
    this.writeEnemies();
    this.writeProjectiles();
    for (const p of sim.players.values()) {
      const ps = state.players.get(p.id);
      if (!ps) continue;
      this.writeSurvival(p, ps);
      const m = p.motor;
      ps.frame = m.frame;
      ps.x = m.x;
      ps.y = m.y;
      ps.z = m.z;
      ps.vx = m.vx;
      ps.vy = m.vy;
      ps.vz = m.vz;
      ps.yaw = m.yaw;
      ps.pitch = m.pitch;
      ps.flags =
        (m.grounded ? PlayerFlag.Grounded : 0) |
        (m.sprinting ? PlayerFlag.Sprinting : 0) |
        (m.driving ? PlayerFlag.Driving : 0) |
        (p.connected ? 0 : PlayerFlag.Away);
      ps.ack = p.ack;
      ps.hp = Math.round(p.hp);
      ps.stamina = m.stamina;
      ps.airTime = m.airTime;
      ps.mantle = m.mantle;
      ps.mx = m.mx;
      ps.my = m.my;
      ps.mz = m.mz;
    }
  }

  private writeSurvival(p: SimPlayer, ps: PlayerState): void {
    ps.life = p.life;
    ps.bleed = p.bleed;
    ps.revive = p.revive;
    ps.held = p.inv.slots[p.inv.selected] ?? '';
    if (ps.inv) writeInventory(p.inv, ps.inv);
  }

  private writeEnemies(): void {
    const { sim, state } = this;
    const tick = sim.tick;
    for (const e of sim.enemySystem.enemies.values()) {
      let es = state.enemies.get(e.id);
      if (!es) {
        es = new EnemyState();
        es.type = ENEMY_TYPES.indexOf(e.type);
        state.enemies.set(e.id, es);
      } else {
        // Farther enemies update less often (§6.10, §7 bandwidth): clients interpolate.
        const every = e.nearest < 15 ? 2 : e.nearest < 45 ? 3 : e.nearest < 90 ? 4 : 8;
        if (e.anim === es.anim && e.gore === es.gore && (tick + Number(e.id)) % every !== 0)
          continue;
      }
      es.frame = e.frame;
      es.x = e.x;
      es.z = e.z;
      // On the ground clients take the height from the terrain; only send it on the train.
      if (e.frame !== 0) es.y = e.y;
      // Small turns aren't worth the bytes.
      if (Math.abs(Math.atan2(Math.sin(e.yaw - es.yaw), Math.cos(e.yaw - es.yaw))) > 0.07)
        es.yaw = e.yaw;
      es.anim = e.anim;
      es.hp = Math.max(0, Math.round((255 * e.hp) / e.def.hp));
      es.gore = e.gore;
    }
    for (const id of [...state.enemies.keys()]) {
      if (!sim.enemySystem.enemies.has(id)) {
        state.enemies.delete(id);
        for (const seen of this.visible.values()) seen.delete(id);
      }
    }
  }

  private writeProjectiles(): void {
    const { sim, state } = this;
    for (const pr of sim.combat.projectiles.values()) {
      let ps = state.projectiles.get(pr.id);
      if (!ps) {
        ps = new ProjectileState();
        ps.kind = pr.kind;
        state.projectiles.set(pr.id, ps);
      }
      ps.x = pr.x;
      ps.y = pr.y;
      ps.z = pr.z;
    }
    for (const id of [...state.projectiles.keys()]) {
      if (!sim.combat.projectiles.has(id)) state.projectiles.delete(id);
    }
  }

  dispose(): void {
    this.sim.dispose();
  }

  private flushEvents(): void {
    const out = this.sim.drainEvents();
    if (out.length === 0) return;
    const broadcast: GameEvent[] = [];
    const direct = new Map<string, GameEvent[]>();
    for (const { to, ev } of out) {
      if (to === undefined) broadcast.push(ev);
      else {
        let list = direct.get(to);
        if (!list) direct.set(to, (list = []));
        list.push(ev);
      }
    }
    for (const client of this.clients.values()) {
      const mine = direct.get(client.id);
      const events = mine ? broadcast.concat(mine) : broadcast;
      if (events.length > 0) client.send('events', events);
    }
  }
}

function writeInventory(inv: Inventory, out: InventoryState): void {
  for (let i = 0; i < inv.slots.length; i++) {
    if (out.slots[i] !== inv.slots[i]) out.slots[i] = inv.slots[i] ?? '';
    if (out.mags[i] !== inv.mags[i]) out.mags[i] = inv.mags[i] ?? 0;
  }
  out.selected = inv.selected;
  out.pistol = inv.pistol;
  out.rifle = inv.rifle;
  out.shells = inv.shells;
  out.bandage = inv.bandage;
  out.tonic = inv.tonic;
  out.dynamite = inv.dynamite;
  out.holywater = inv.holywater;
  out.cash = inv.cash;
  out.reload = Math.round(inv.reload * 20) / 20;
}
