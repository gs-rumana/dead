import {
  type Command,
  type GameEvent,
  type InputFrame,
  DAY,
  DAY_CYCLE,
  Rng,
  SIM_DT,
} from '@dead-tracks/shared';

export interface SimOptions {
  seed: number;
}

export interface SimPlayer {
  id: string;
  name: string;
  frame: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  flags: number;
  ack: number;
  hp: number;
  stamina: number;
  /** Inputs waiting to be applied, oldest first. */
  inputs: InputFrame[];
  lastInput: InputFrame | null;
}

export interface OutEvent {
  /** Recipient player id, or undefined for everyone. */
  to?: string;
  ev: GameEvent;
}

const TEST_COLORS = [0xd9a441, 0x6fa86b, 0xb9563f, 0x4f7cac, 0xc9c1b1];

/**
 * The authoritative game (§6.5). Plain TypeScript with no networking:
 * the server's RunRoom and the solo worker both drive it through RunHost.
 */
export class Sim {
  readonly seed: number;
  readonly rng: Rng;
  tick = 0;
  time = 0;
  readonly players = new Map<string, SimPlayer>();
  readonly test = { angle: 0, color: TEST_COLORS[0] as number, nudges: 0 };
  readonly events: OutEvent[] = [];

  constructor(opts: SimOptions) {
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
  }

  /** Day/night cycle position in [0, 1); 0 is dawn. */
  get dayPhase(): number {
    const t = this.time + DAY.startOffset * DAY.dayLength;
    return (t % DAY_CYCLE) / DAY_CYCLE;
  }

  get day(): number {
    return Math.floor((this.time + DAY.startOffset * DAY.dayLength) / DAY_CYCLE) + 1;
  }

  addPlayer(id: string, name: string): SimPlayer {
    const n = this.players.size;
    const p: SimPlayer = {
      id,
      name,
      frame: 0,
      x: (n - 1.5) * 1.5,
      y: 0,
      z: 4,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: Math.PI,
      pitch: 0,
      flags: 0,
      ack: 0,
      hp: 100,
      stamina: 100,
      inputs: [],
      lastInput: null,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  pushInput(id: string, input: InputFrame): void {
    const p = this.players.get(id);
    if (!p) return;
    if (input.seq <= p.ack) return;
    // Bound the queue so a flooding client can't grow memory.
    if (p.inputs.length > 30) p.inputs.shift();
    p.inputs.push(input);
  }

  command(id: string, cmd: Command): void {
    if (!this.players.has(id)) return;
    if (cmd.t === 'nudge') {
      this.test.nudges = (this.test.nudges + 1) & 0xffff;
      this.test.color = TEST_COLORS[this.test.nudges % TEST_COLORS.length] as number;
    }
  }

  step(dt = SIM_DT): void {
    this.tick++;
    this.time += dt;
    this.test.angle = (this.test.angle + dt * 0.8) % (Math.PI * 2);
    for (const p of this.players.values()) this.stepPlayer(p, dt);
  }

  private stepPlayer(p: SimPlayer, dt: number): void {
    // M0: one queued input per tick, simple flat-ground movement.
    const input = p.inputs.shift() ?? p.lastInput;
    if (!input) return;
    p.lastInput = input;
    p.ack = Math.max(p.ack, input.seq);
    p.yaw = input.yaw;
    p.pitch = input.pitch;
    const speed = 4.6;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    // Forward is -Z at yaw 0 (three.js convention).
    p.vx = (input.mx * cos - input.my * sin) * speed;
    p.vz = (-input.mx * sin - input.my * cos) * speed;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
  }

  drainEvents(): OutEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
