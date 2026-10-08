import {
  type CarPose,
  type Command,
  CONSIST,
  DAY,
  DAY_CYCLE,
  DRIVER_SPOT,
  FLATCAR_DECK,
  Frame,
  type GameEvent,
  type InputFrame,
  type MotorContext,
  type MotorState,
  PLAYER,
  PhysicsSpace,
  Rng,
  Route,
  SIM_DT,
  TRAIN_LENGTH,
  Terrain,
  Btn,
  computeCarPoses,
  findInteractable,
  initPhysics,
  makeCarPoses,
  makeMotorState,
  stepMotor,
  toWorldFrame,
  trainToWorld,
  worldToTrain,
} from '@dead-tracks/shared';
import { TrainSim } from './train.ts';

export interface SimOptions {
  seed: number;
}

export interface SimPlayer {
  id: string;
  name: string;
  motor: MotorState;
  hp: number;
  /** Inputs waiting to be applied, oldest first. */
  inputs: InputFrame[];
  lastInput: InputFrame | null;
  /** Last input sequence applied. */
  ack: number;
  /** False while the connection is dropped and the slot is held. */
  connected: boolean;
}

export interface OutEvent {
  /** Recipient player id, or undefined for everyone. */
  to?: string;
  ev: GameEvent;
}

const TEST_COLORS = [0xd9a441, 0x6fa86b, 0xb9563f, 0x4f7cac, 0xc9c1b1];
const TRAIN_START_S = 40;

/**
 * The authoritative game (§6.5). Plain TypeScript with no networking:
 * the server's RunRoom and the solo worker both drive it through RunHost.
 */
export class Sim {
  readonly seed: number;
  readonly rng: Rng;
  readonly route: Route;
  readonly terrain: Terrain;
  readonly space: PhysicsSpace;
  readonly train: TrainSim;
  readonly poses: CarPose[] = makeCarPoses();
  readonly motorCtx: MotorContext;
  tick = 0;
  time = 0;
  readonly players = new Map<string, SimPlayer>();
  readonly test = { angle: 0, color: TEST_COLORS[0] as number, nudges: 0 };
  readonly events: OutEvent[] = [];
  /** Development only: keep the firebox full. */
  devInfiniteFuel = false;

  /** Rapier must be loaded first; use Sim.create(). */
  private constructor(opts: SimOptions, space: (t: Terrain) => PhysicsSpace) {
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.route = new Route(this.seed);
    this.terrain = new Terrain(this.route);
    this.space = space(this.terrain);
    this.train = new TrainSim(TRAIN_START_S);
    this.motorCtx = { space: this.space, poses: this.poses, trainSpeed: 0 };
    this.updateTrainPose();
  }

  static async create(opts: SimOptions): Promise<Sim> {
    const R = await initPhysics();
    return new Sim(opts, (t) => new PhysicsSpace(R, t));
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
    const motor = makeMotorState();
    motor.frame = Frame.Train;
    const flat = CONSIST[2]!;
    motor.x = (n % 2 === 0 ? -0.6 : 0.6) * (n < 2 ? 1 : 0.4);
    motor.y = FLATCAR_DECK + 0.02;
    motor.z = flat.zc - 3 + n * 1.6;
    motor.grounded = true;
    const p: SimPlayer = {
      id,
      name,
      motor,
      hp: PLAYER.maxHp,
      inputs: [],
      lastInput: null,
      ack: 0,
      connected: true,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: string): void {
    if (this.train.driver === id) this.train.driver = '';
    this.players.delete(id);
  }

  /** Connection dropped: hold the slot, stop driving, idle in place (§6.8). */
  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    p.inputs.length = 0;
    if (!connected) {
      p.lastInput = null;
      p.motor.vx = p.motor.vz = 0;
      if (p.motor.driving) {
        p.motor.driving = false;
        if (this.train.driver === id) this.train.driver = '';
      }
    }
  }

  pushInput(id: string, input: InputFrame): void {
    const p = this.players.get(id);
    if (!p) return;
    const last = p.inputs.length > 0 ? (p.inputs[p.inputs.length - 1] as InputFrame).seq : p.ack;
    if (input.seq <= last) return;
    // Bound the queue so a flooding client can't grow memory.
    if (p.inputs.length > 30) p.inputs.shift();
    p.inputs.push(input);
  }

  command(id: string, cmd: Command): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (cmd.t) {
      case 'nudge':
        this.test.nudges = (this.test.nudges + 1) & 0xffff;
        this.test.color = TEST_COLORS[this.test.nudges % TEST_COLORS.length] as number;
        break;
      case 'respawn':
        this.respawnOnTrain(p);
        break;
      case 'dev':
        this.devCommand(p, cmd.action, cmd.value);
        break;
    }
  }

  /** Development tuning panel actions (§12). */
  private devCommand(p: SimPlayer, action: string, value = 0): void {
    switch (action) {
      case 'coal':
        this.train.coal += value || 20;
        break;
      case 'fuel':
        this.train.fuel = 240;
        this.train.pressure = 1;
        break;
      case 'skip': {
        this.train.s += value || 1000;
        this.updateTrainPose();
        break;
      }
      case 'time':
        // Jump to a day phase in [0, 1).
        this.time += ((((value - this.dayPhase) % 1) + 1) % 1) * DAY_CYCLE;
        break;
      case 'drive':
        this.train.throttle = value;
        break;
      case 'turbo':
        this.train.devSpeedScale = Math.max(1, Math.min(value || 1, 8));
        break;
      case 'infinite-fuel':
        this.devInfiniteFuel = value !== 0;
        break;
      case 'respawn':
        this.respawnOnTrain(p);
        break;
      case 'cab': {
        // Stand in the cab facing the controls.
        const m = p.motor;
        m.frame = Frame.Train;
        m.x = 0.5;
        m.y = 1.42;
        m.z = CONSIST[0]!.zc + 4.0;
        m.vx = m.vy = m.vz = 0;
        m.mantle = 0;
        break;
      }
      case 'ground': {
        // Step off beside the locomotive.
        const w = trainToWorld(this.poses, -3.5, 0, CONSIST[0]!.zc, { x: 0, y: 0, z: 0 });
        const m = p.motor;
        m.frame = Frame.World;
        m.x = w.x;
        m.z = w.z;
        m.y = this.terrain.height(w.x, w.z) + 0.1;
        m.vx = m.vy = m.vz = 0;
        m.mantle = 0;
        m.driving = false;
        if (this.train.driver === p.id) this.train.driver = '';
        this.space.streamTiles([{ x: m.x, z: m.z }]);
        break;
      }
    }
  }

  private respawnOnTrain(p: SimPlayer): void {
    const m = p.motor;
    m.frame = Frame.Train;
    m.x = 0;
    m.y = FLATCAR_DECK + 0.05;
    m.z = CONSIST[2]!.zc;
    m.vx = m.vy = m.vz = 0;
    m.mantle = 0;
    m.driving = false;
    if (this.train.driver === p.id) this.train.driver = '';
  }

  step(dt = SIM_DT): void {
    this.tick++;
    this.time += dt;
    this.test.angle = (this.test.angle + dt * 0.8) % (Math.PI * 2);
    this.motorCtx.trainSpeed = this.train.speed;

    // 1–2. Inputs and players (§6.10 tick order).
    for (const p of this.players.values()) this.stepPlayer(p, dt);

    // 3. Vehicles.
    const driver = this.train.driver ? this.players.get(this.train.driver) : undefined;
    if (this.train.driver && !driver) this.train.driver = '';
    if (this.train.drive(driver?.lastInput ?? null, dt)) this.events.push({ ev: { e: 'whistle' } });
    if (this.devInfiniteFuel) {
      this.train.fuel = Math.max(this.train.fuel, 200);
      this.train.pressure = 1;
    }
    this.train.step(dt, this.route);
    this.updateTrainPose();
    this.resolveTrainContacts();

    // Physics streaming around players on the ground.
    const pts: Array<{ x: number; z: number }> = [];
    for (const p of this.players.values()) {
      if (p.motor.frame === Frame.World) pts.push({ x: p.motor.x, z: p.motor.z });
    }
    this.space.streamTiles(pts);
  }

  private updateTrainPose(): void {
    computeCarPoses(this.route, this.train.s, this.poses);
    const front = this.poses[0] as CarPose;
    this.space.maybeRebase(front.cx, front.cz);
    this.space.setTrainPoses(this.poses);
    this.space.refresh();
  }

  private stepPlayer(p: SimPlayer, dt: number): void {
    // Catch up when inputs back up; never simulate a player without input (§6.8).
    const budget = p.inputs.length > 3 ? 3 : 1;
    for (let i = 0; i < budget; i++) {
      const input = p.inputs.shift();
      if (!input) return;
      this.applyInput(p, input, dt);
    }
  }

  private applyInput(p: SimPlayer, input: InputFrame, dt: number): void {
    const m = p.motor;
    const pressed = input.buttons & ~m.prevButtons;
    if (pressed & Btn.Interact) this.interact(p, input);
    if (m.frame === Frame.World) this.space.streamTiles([{ x: m.x, z: m.z }]);
    stepMotor(this.motorCtx, m, input, dt);
    if (m.driving) {
      m.x = DRIVER_SPOT.x;
      m.y = DRIVER_SPOT.y;
      m.z = DRIVER_SPOT.z;
    }
    p.lastInput = input;
    p.ack = input.seq;
  }

  private interact(p: SimPlayer, input: InputFrame): void {
    const m = p.motor;
    if (m.driving) {
      m.driving = false;
      if (this.train.driver === p.id) this.train.driver = '';
      return;
    }
    const target = findInteractable(
      m.frame,
      m.x,
      m.y,
      m.z,
      input.frame === m.frame ? input.yaw : m.yaw,
      input.pitch,
    );
    if (!target) return;
    if (target.id === 'controls' && !this.train.driver) {
      this.train.driver = p.id;
      m.driving = true;
      m.vx = m.vy = m.vz = 0;
    } else if (target.id === 'firebox') {
      if (this.train.stoke()) this.events.push({ ev: { e: 'stoke', by: p.id } });
      else if (this.train.coal <= 0)
        this.events.push({ to: p.id, ev: { e: 'toast', text: 'The tender is out of coal' } });
    }
  }

  /** Players standing in the train's path get pushed aside (damage comes with combat, M3). */
  private resolveTrainContacts(): void {
    const t = { x: 0, y: 0, z: 0 };
    for (const p of this.players.values()) {
      const m = p.motor;
      if (m.frame !== Frame.World || m.mantle > 0) continue;
      worldToTrain(this.poses, m.x, m.y, m.z, t);
      if (t.z < -0.6 || t.z > TRAIN_LENGTH + 0.6 || t.y > 4.3 || t.y < -1.5) continue;
      if (Math.abs(t.x) >= 1.7) continue;
      const side = t.x >= 0 ? 1 : -1;
      const w = trainToWorld(this.poses, side * 1.85, Math.max(t.y, 0), t.z, { x: 0, y: 0, z: 0 });
      m.x = w.x;
      m.z = w.z;
      m.y = Math.max(m.y, this.terrain.height(w.x, w.z));
    }
  }

  /** Train-space or world position of a player in world coordinates. */
  worldPosition(p: SimPlayer): { x: number; y: number; z: number } {
    const m = p.motor;
    if (m.frame === Frame.World) return { x: m.x, y: m.y, z: m.z };
    return trainToWorld(this.poses, m.x, m.y, m.z, { x: 0, y: 0, z: 0 });
  }

  drainEvents(): OutEvent[] {
    return this.events.splice(0, this.events.length);
  }

  dispose(): void {
    this.space.dispose();
  }
}

export { toWorldFrame };
