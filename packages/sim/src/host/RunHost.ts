import type { StateView } from '@colyseus/schema';
import {
  type ClientMessages,
  type GameEvent,
  type JoinOptions,
  type ServerMessages,
  PROTOCOL_VERSION,
  PlayerFlag,
  PlayerState,
  RunState,
  SIM_DT,
  inputFromWire,
} from '@dead-tracks/shared';
import { Sim } from '../Sim.ts';

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
    this.state.players.set(client.id, ps);
    this.writeState();
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
    this.sim.setConnected(client.id, true);
    client.send('welcome', {
      selfId: client.id,
      seed: this.sim.seed,
      code: this.state.code,
      protocol: PROTOCOL_VERSION,
    });
  }

  leave(client: HostClient): void {
    this.clients.delete(client.id);
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
    }
  }

  /** Advances the simulation one fixed tick and writes the result into the schema. */
  step(dt = SIM_DT): void {
    this.sim.step(dt);
    this.writeState();
    this.flushEvents();
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
    for (const p of sim.players.values()) {
      const ps = state.players.get(p.id);
      if (!ps) continue;
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
