import {
  Anim,
  Btn,
  type CarPose,
  type Command,
  CONSIST,
  DAY,
  DAY_CYCLE,
  DRIVER_SPOT,
  type EnemyType,
  ENEMIES,
  FLATCAR_DECK,
  type Feature,
  Frame,
  type GameEvent,
  type InputFrame,
  Life,
  type MotorContext,
  type MotorState,
  PLAYER,
  PhysicsSpace,
  Rng,
  Route,
  SIM_DT,
  World,
  type ItemKind,
  HANDCAR,
  HANDCAR_SEATS,
  type HandcarPose,
  handcarPose,
  handcarToWorld,
  makeHandcarPose,
  SURVIVAL,
  TRAIN_LENGTH,
  Terrain,
  computeCarPoses,
  findInteractable,
  initPhysics,
  makeCarPoses,
  makeMotorState,
  nextFeature,
  smoothstep,
  stepMotor,
  ENEMY_TYPES,
  toWorld,
  trainToWorld,
  worldToTrain,
} from '@dead-tracks/shared';
import { EnemySystem, type SimEnemy } from './ai/EnemySystem.ts';
import { Combat } from './combat/Combat.ts';
import { type Inventory, addToHotbar, starterInventory } from './combat/inventory.ts';
import { ItemSystem } from './items/ItemSystem.ts';
import { HandcarSim } from './vehicles/HandcarSim.ts';
import { WeatherSim } from './world/WeatherSim.ts';
import { FortSystem } from './world/FortSystem.ts';
import { LandmarkSystem } from './world/LandmarkSystem.ts';
import { TrainSim } from './train.ts';

export interface SimOptions {
  seed: number;
}

export interface SimPlayer {
  id: string;
  /** Small stable number for seeding shot spread. */
  num: number;
  name: string;
  motor: MotorState;
  hp: number;
  life: number;
  bleed: number;
  revive: number;
  /** Who revived this tick (progress decays when nobody is). */
  revivedBy: string;
  /** Route distance at which a dead player respawns (next station, §4.9). */
  respawnS: number;
  lastHurt: number;
  inv: Inventory;
  /** Seconds between what the client sees and now (for hit checks). */
  viewDelay: number;
  /** Inputs waiting to be applied, oldest first. */
  inputs: InputFrame[];
  lastInput: InputFrame | null;
  /** Last input sequence applied. */
  ack: number;
  /** False while the connection is dropped and the slot is held. */
  connected: boolean;
  /** World position this tick (cached). */
  wx: number;
  wy: number;
  wz: number;
  /** Item id carried in both hands ('' if none, §4.8). */
  carry: string;
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
  readonly world: World;
  readonly route: Route;
  readonly terrain: Terrain;
  readonly features: Feature[];
  readonly space: PhysicsSpace;
  readonly train: TrainSim;
  readonly poses: CarPose[] = makeCarPoses();
  readonly motorCtx: MotorContext;
  readonly enemySystem: EnemySystem;
  readonly combat: Combat;
  readonly items: ItemSystem;
  readonly weather: WeatherSim;
  readonly forts: FortSystem;
  readonly landmarks: LandmarkSystem;
  /** One handcar per spur, waiting on the siding at its junction (§4.4). */
  readonly handcars: HandcarSim[];
  readonly handcarPoses: HandcarPose[];
  tick = 0;
  time = 0;
  /** Night type for the current night (§4.5). */
  get nightType(): number {
    return this.weather.night;
  }
  /** The run ended (every player down at once, §4.1). */
  over = false;
  readonly players = new Map<string, SimPlayer>();
  readonly test = { angle: 0, color: TEST_COLORS[0] as number, nudges: 0 };
  readonly events: OutEvent[] = [];
  /** Development only: keep the firebox full. */
  devInfiniteFuel = false;
  /** Development only: players can't be hurt. */
  devGod = false;
  private playerCounter = 0;

  /** Rapier must be loaded first; use Sim.create(). */
  private constructor(opts: SimOptions, space: (t: Terrain) => PhysicsSpace) {
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.world = new World(this.seed);
    this.route = this.world.route;
    this.terrain = this.world.terrain;
    this.features = this.world.features;
    this.space = space(this.terrain);
    this.space.structureSource = (tx, tz) => this.world.structuresInTile(tx, tz);
    this.train = new TrainSim(TRAIN_START_S);
    this.motorCtx = { space: this.space, poses: this.poses, trainSpeed: 0 };
    this.enemySystem = new EnemySystem(this);
    this.combat = new Combat(this);
    this.items = new ItemSystem(this);
    this.weather = new WeatherSim(this);
    this.forts = new FortSystem(this);
    this.landmarks = new LandmarkSystem(this);
    this.handcars = this.world.spurs.map((spur, i) => new HandcarSim(i, spur));
    this.handcarPoses = this.handcars.map((h) => handcarPose(h.spur, h.s, makeHandcarPose()));
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

  get isNight(): boolean {
    return this.dayPhase >= DAY.dayLength / DAY_CYCLE;
  }

  /** 0 by day, ramping up through dusk (§4.5) to 1 at night, back down at dawn. */
  get nightFactor(): number {
    const f = this.dayPhase;
    const dusk = DAY.dayLength / DAY_CYCLE;
    if (f < dusk) return smoothstep(dusk - 0.08, dusk, f);
    return 1 - smoothstep(0.96, 1, f);
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
      num: ++this.playerCounter,
      name,
      motor,
      hp: PLAYER.maxHp,
      life: Life.Alive,
      bleed: 0,
      revive: 0,
      revivedBy: '',
      respawnS: 0,
      lastHurt: -999,
      inv: starterInventory(false),
      viewDelay: 0.1,
      inputs: [],
      lastInput: null,
      ack: 0,
      connected: true,
      wx: 0,
      wy: 0,
      wz: 0,
      carry: '',
    };
    this.players.set(id, p);
    this.updatePlayerWorld(p);
    // Solo runs start with a tonic (§4.9); it goes away if someone else joins.
    this.refreshSoloTonic();
    return p;
  }

  private refreshSoloTonic(): void {
    const solo = this.players.size === 1;
    for (const p of this.players.values()) {
      if (solo && p.inv.tonic === 0 && this.time < 5) p.inv.tonic = 1;
    }
  }

  /** A message for everyone. */
  broadcast(text: string): void {
    this.events.push({ ev: { e: 'toast', text } });
  }

  /** A message for one player (events channel). */
  toast(id: string, text: string): void {
    this.events.push({ to: id, ev: { e: 'toast', text } });
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (p?.carry) this.items.drop(p, false);
    if (p && p.motor.frame >= Frame.Handcar) this.leaveHandcar(p);
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
    if (!p || !cmd || typeof cmd !== 'object') return;
    switch (cmd.t) {
      case 'nudge':
        this.test.nudges = (this.test.nudges + 1) & 0xffff;
        this.test.color = TEST_COLORS[this.test.nudges % TEST_COLORS.length] as number;
        break;
      case 'fire':
        this.combat.fire(p, cmd);
        break;
      case 'melee':
        this.combat.melee(p, cmd.dx, cmd.dz);
        break;
      case 'throw':
        this.combat.throw(p, cmd.dx, cmd.dy, cmd.dz);
        break;
      case 'equip':
        this.combat.equip(p, cmd.slot | 0);
        break;
      case 'reload':
        this.combat.reload(p);
        break;
      case 'heal':
        this.heal(p);
        break;
      case 'use':
        if (typeof cmd.target === 'string') {
          const target = cmd.target.slice(0, 64);
          if (target.startsWith('handcar:')) this.useHandcar(p, Number(target.slice(8)));
          else if (target === 'winch') this.forts.useWinch(p.id);
          else this.items.use(p, target, !!cmd.hold);
        }
        break;
      case 'drop':
        this.items.drop(p, !!cmd.throw);
        break;
      case 'buy':
        if (typeof cmd.shop === 'string' && typeof cmd.kind === 'string')
          this.items.buy(p, cmd.shop, cmd.kind as ItemKind | 'heal');
        break;
      case 'sell':
        if (typeof cmd.shop === 'string') this.items.sell(p, cmd.shop, Number(cmd.slot) | 0);
        break;
      case 'dropcash':
        this.items.dropCash(p, Number(cmd.amount) || 0);
        break;
      case 'respawn':
        if (p.life === Life.Alive) this.respawnOnTrain(p);
        break;
      case 'dev':
        if (cmd.action === 'tp' && Number.isFinite(cmd.x) && Number.isFinite(cmd.z))
          this.devTeleport(p, cmd.x!, cmd.y ?? NaN, cmd.z!);
        else this.devCommand(p, cmd.action, cmd.value);
        break;
    }
  }

  /** Client-reported view delay (RTT/2 + interpolation), for lag compensation. */
  setViewDelay(id: string, seconds: number): void {
    const p = this.players.get(id);
    if (p && Number.isFinite(seconds)) p.viewDelay = Math.max(0, Math.min(0.5, seconds));
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
      case 'skip':
        this.train.s += value || 1000;
        this.updateTrainPose();
        break;
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
      case 'god':
        this.devGod = value !== 0;
        break;
      case 'finale':
        // Put the train just short of Fort Haven's gate.
        this.train.s = this.forts.gateS - 30;
        this.train.speed = 0;
        this.updateTrainPose();
        break;
      case 'weather':
        this.weather.force(value as 0);
        break;
      case 'night':
        this.weather.force(this.weather.current, value as 0);
        break;
      case 'respawn':
        this.respawnOnTrain(p);
        break;
      case 'arsenal': {
        for (const w of ['rifle', 'coachgun', 'hatchet', 'holywater'] as const)
          addToHotbar(p.inv, w);
        p.inv.pistol += 60;
        p.inv.rifle += 40;
        p.inv.shells += 30;
        p.inv.dynamite += 5;
        p.inv.holywater += 3;
        p.inv.bandage += 3;
        p.inv.tonic += 2;
        if (!p.inv.slots.includes('dynamite')) addToHotbar(p.inv, 'dynamite');
        break;
      }
      case 'item': {
        // Spawn an item at the player's feet (dev).
        const kinds: ItemKind[] = [
          'coal',
          'plate',
          'wire',
          'crate',
          'gold_bar',
          'jewelry',
          'chair',
        ];
        const kind = kinds[Math.max(0, Math.min(kinds.length - 1, value | 0))] as ItemKind;
        const m = p.motor;
        this.items.spawn(
          kind,
          m.frame,
          m.x - Math.sin(m.yaw) * 1.2,
          m.y + 0.3,
          m.z - Math.cos(m.yaw) * 1.2,
          0,
          { flying: true },
        );
        break;
      }
      case 'cash':
        p.inv.cash += value || 100;
        break;
      case 'handcar': {
        // Stand next to a junction's handcar.
        const pose = this.handcarPoses[value | 0];
        if (pose) this.devTeleport(p, pose.x + pose.rx * 1.8, NaN, pose.z + pose.rz * 1.8);
        break;
      }
      case 'landmark': {
        // Stand at the landmark's front gate; value 10+i opens its door.
        const l = this.landmarks.list[value % 10];
        if (!l) break;
        if (value >= 10) this.landmarks.devOpen(value % 10);
        else {
          const w = toWorld(l.st, -24, 0, 0);
          this.devTeleport(p, w.x, NaN, w.z);
        }
        break;
      }
      case 'town': {
        const spur = this.world.spurs[value | 0];
        if (spur) {
          const f = spur.frameAt(spur.end, {
            x: 0,
            y: 0,
            z: 0,
            heading: 0,
            grade: 0,
            tx: 0,
            ty: 0,
            tz: 0,
            rx: 0,
            rz: 0,
          });
          this.devTeleport(p, f.x + Math.sin(f.heading) * 25, NaN, f.z - Math.cos(f.heading) * 25);
        }
        break;
      }
      case 'spawn': {
        // Spawn a pack in front of the player.
        const yaw = p.motor.yaw + (p.motor.frame === Frame.Train ? this.poses[0]!.yaw : 0);
        const n = Math.max(1, Math.min(value || 5, 40));
        for (let i = 0; i < n; i++) {
          const d = 14 + this.rng.range(0, 10);
          const a = yaw + this.rng.range(-0.6, 0.6);
          this.enemySystem.spawn('walker', p.wx - Math.sin(a) * d, p.wz - Math.cos(a) * d);
        }
        break;
      }
      case 'monster': {
        // One enemy of a given type (ENEMY_TYPES index) 12 m in front, frozen in place.
        const type = ENEMY_TYPES[value] ?? 'walker';
        const yaw = p.motor.yaw + (p.motor.frame === Frame.Train ? this.poses[0]!.yaw : 0);
        const e = this.enemySystem.spawn(type, p.wx - Math.sin(yaw) * 9, p.wz - Math.cos(yaw) * 9);
        e.yaw = yaw + Math.PI;
        break;
      }
      case 'horde': {
        const n = Math.max(1, Math.min(value || 80, 80));
        const types: EnemyType[] = ['walker', 'walker', 'runner', 'brute'];
        for (let i = 0; i < n; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const d = this.rng.range(25, 70);
          const e = this.enemySystem.spawn(
            types[i % types.length]!,
            p.wx + Math.cos(a) * d,
            p.wz + Math.sin(a) * d,
          );
          e.state = 'alerted';
          e.goalX = p.wx;
          e.goalZ = p.wz;
          e.stateT = 30;
        }
        break;
      }
      case 'director':
        this.enemySystem.paused = value === 0;
        break;
      case 'clear':
        this.enemySystem.enemies.clear();
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

  /** Dev: put a player at a world position (on the ground there if y is missing). */
  private devTeleport(p: SimPlayer, x: number, y: number, z: number): void {
    const m = p.motor;
    m.frame = Frame.World;
    m.x = x;
    m.z = z;
    m.y = Number.isFinite(y) ? y : this.terrain.height(x, z) + 0.2;
    m.vx = m.vy = m.vz = 0;
    m.mantle = 0;
    m.driving = false;
    if (this.train.driver === p.id) this.train.driver = '';
    this.space.streamTiles([{ x, z }]);
    this.updatePlayerWorld(p);
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
    this.updatePlayerWorld(p);
  }

  step(dt = SIM_DT): void {
    this.tick++;
    this.time += dt;
    this.test.angle = (this.test.angle + dt * 0.8) % (Math.PI * 2);
    this.motorCtx.trainSpeed = this.train.speed;

    // 1–2. Inputs and players (§6.10 tick order).
    for (const p of this.players.values()) {
      this.stepPlayer(p, dt);
      this.combat.tickPlayer(p, dt);
    }

    // 3. Vehicles.
    const driver = this.train.driver ? this.players.get(this.train.driver) : undefined;
    if (this.train.driver && !driver) this.train.driver = '';
    if (this.train.drive(driver?.lastInput ?? null, dt)) {
      this.events.push({ ev: { e: 'whistle' } });
      const loco = this.poses[0]!;
      this.enemySystem.makeNoise(loco.cx, loco.cz, 160);
    }
    if (this.devInfiniteFuel) {
      this.train.fuel = Math.max(this.train.fuel, 200);
      this.train.pressure = 1;
    }
    this.train.limitS = this.forts.trainLimit;
    this.train.step(dt, this.route);
    this.updateTrainPose();
    this.stepHandcars(dt);
    this.resolveTrainContacts();
    for (const p of this.players.values()) this.updatePlayerWorld(p);

    // 4–6. Director, AI, combat.
    this.enemySystem.step(dt);
    this.enemySystem.trainContacts();
    this.combat.stepProjectiles(dt);
    // 7. Carrying and cargo.
    this.items.step(dt);

    // 9. Weather and time of day; the forts and the finale.
    this.weather.step(dt);
    this.forts.step(dt);
    this.landmarks.step();

    // Health, revives and respawns (§4.9).
    for (const p of this.players.values()) this.stepHealth(p, dt);
    this.checkRunOver();

    // Physics streaming around players on the ground.
    const pts: Array<{ x: number; z: number }> = [];
    for (const p of this.players.values()) {
      if (p.motor.frame === Frame.World) pts.push({ x: p.motor.x, z: p.motor.z });
    }
    for (const pr of this.combat.projectiles.values()) pts.push({ x: pr.x, z: pr.z });
    for (const it of this.items.items.values()) if (it.flying) pts.push({ x: it.wx, z: it.wz });
    this.space.streamTiles(pts);
  }

  private stepHandcars(dt: number): void {
    this.handcars.forEach((hc, i) => {
      const inputs: Array<{ seat: number; input: InputFrame | null; stamina: number }> = [];
      hc.seats.forEach((id, seat) => {
        const p = id ? this.players.get(id) : undefined;
        if (!p) {
          hc.seats[seat] = '';
          return;
        }
        inputs.push({
          seat,
          input: p.connected && p.life === Life.Alive ? p.lastInput : null,
          stamina: p.motor.stamina,
        });
      });
      const spent = hc.step(dt, inputs);
      hc.seats.forEach((id, seat) => {
        const p = id ? this.players.get(id) : undefined;
        if (!p) return;
        p.motor.stamina = Math.max(0, p.motor.stamina - (spent[seat] ?? 0));
        // Keep riders in their seats.
        const seatPos = HANDCAR_SEATS[seat]!;
        p.motor.x = seatPos.x;
        p.motor.y = HANDCAR.deck;
        p.motor.z = seatPos.z;
      });
      handcarPose(hc.spur, hc.s, this.handcarPoses[i]!);
    });
  }

  /** Sit on a handcar (§4.4), or load cargo / hitch a trolley if carrying. */
  useHandcar(p: SimPlayer, i: number): void {
    const hc = this.handcars[i];
    const pose = this.handcarPoses[i];
    if (!hc || !pose || p.life !== Life.Alive) return;
    if (Math.hypot(pose.x - p.wx, pose.z - p.wz) > 4) return;
    if (p.carry) {
      this.items.loadHandcar(p, i);
      return;
    }
    const seat = hc.freeSeat();
    if (seat < 0) {
      this.toast(p.id, 'The handcar is full');
      return;
    }
    hc.seats[seat] = p.id;
    const m = p.motor;
    m.frame = Frame.Handcar + i;
    m.x = HANDCAR_SEATS[seat]!.x;
    m.y = HANDCAR.deck;
    m.z = HANDCAR_SEATS[seat]!.z;
    m.vx = m.vy = m.vz = 0;
    m.mantle = 0;
    this.updatePlayerWorld(p);
  }

  /** Step off a handcar to the side of the seat. */
  leaveHandcar(p: SimPlayer): void {
    const m = p.motor;
    const i = m.frame - Frame.Handcar;
    const hc = this.handcars[i];
    const pose = this.handcarPoses[i];
    if (!hc || !pose) return;
    const seat = hc.seats.indexOf(p.id);
    if (seat >= 0) hc.seats[seat] = '';
    const side = (HANDCAR_SEATS[seat] ?? HANDCAR_SEATS[0]!).x > 0 ? 1 : -1;
    const w = handcarToWorld(pose, side * 1.6, 0, HANDCAR_SEATS[seat]?.z ?? 0, {
      x: 0,
      y: 0,
      z: 0,
    });
    m.frame = Frame.World;
    m.x = w.x;
    m.z = w.z;
    m.y = this.terrain.height(w.x, w.z) + 0.05;
    m.vx = m.vy = m.vz = 0;
    this.space.streamTiles([{ x: m.x, z: m.z }]);
    this.updatePlayerWorld(p);
  }

  private updateTrainPose(): void {
    computeCarPoses(this.route, this.train.s, this.poses);
    const front = this.poses[0] as CarPose;
    this.space.maybeRebase(front.cx, front.cz);
    this.space.setTrainPoses(this.poses);
    this.space.refresh();
  }

  private updatePlayerWorld(p: SimPlayer): void {
    const m = p.motor;
    if (m.frame >= Frame.Handcar) {
      const pose = this.handcarPoses[m.frame - Frame.Handcar];
      if (pose) {
        const w = handcarToWorld(pose, m.x, m.y, m.z, { x: 0, y: 0, z: 0 });
        p.wx = w.x;
        p.wy = w.y;
        p.wz = w.z;
      }
      return;
    }
    if (m.frame === Frame.World) {
      p.wx = m.x;
      p.wy = m.y;
      p.wz = m.z;
    } else {
      const w = trainToWorld(this.poses, m.x, m.y, m.z, { x: 0, y: 0, z: 0 });
      p.wx = w.x;
      p.wy = w.y;
      p.wz = w.z;
    }
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
    if (p.life !== Life.Alive) {
      // Downed and dead players don't move; keep acking so prediction stays in step.
      m.prevButtons = input.buttons;
      m.yaw = input.yaw;
      m.pitch = input.pitch;
      if (p.life === Life.Downed && pressed & Btn.Interact) this.selfRevive(p);
      p.lastInput = input;
      p.ack = input.seq;
      return;
    }
    if (pressed & Btn.Interact) this.interact(p, input);
    if (input.buttons & Btn.Interact) this.reviveHeld(p, dt);
    if (pressed & Btn.Reload && !m.driving) this.combat.reload(p);
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
    if (m.frame >= Frame.Handcar) {
      this.leaveHandcar(p);
      return;
    }
    if (m.driving) {
      m.driving = false;
      if (this.train.driver === p.id) this.train.driver = '';
      return;
    }
    if (this.downedNear(p)) return; // Interact is busy reviving.
    if (p.carry) return; // Hands full: the client names a target (furnace, cargo) instead.
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

  // ---------- Health (§4.9) ----------

  damagePlayer(p: SimPlayer, dmg: number, fromX: number, fromZ: number, _by: string): void {
    if (p.life !== Life.Alive || !p.connected || this.devGod || this.over) return;
    p.hp -= dmg;
    p.lastHurt = this.time;
    this.events.push({
      ev: { e: 'hurt', id: p.id, dmg: Math.round(dmg), fx: fromX - p.wx, fz: fromZ - p.wz },
    });
    if (p.hp <= 0) this.down(p);
  }

  private down(p: SimPlayer): void {
    if (p.carry) this.items.drop(p, false);
    if (p.motor.frame >= Frame.Handcar) this.leaveHandcar(p);
    p.hp = 0;
    p.life = Life.Downed;
    p.bleed = SURVIVAL.bleedOut;
    p.revive = 0;
    const m = p.motor;
    m.vx = m.vz = 0;
    m.mantle = 0;
    if (m.driving) {
      m.driving = false;
      if (this.train.driver === p.id) this.train.driver = '';
    }
    this.events.push({ ev: { e: 'downed', id: p.id } });
  }

  private downedNear(p: SimPlayer): SimPlayer | null {
    for (const o of this.players.values()) {
      if (o === p || o.life !== Life.Downed) continue;
      if (Math.hypot(o.wx - p.wx, o.wy - p.wy, o.wz - p.wz) < 2.2) return o;
    }
    return null;
  }

  /** Holding Interact next to a downed teammate with meds revives them (§4.9). */
  private reviveHeld(p: SimPlayer, dt: number): void {
    const o = this.downedNear(p);
    if (!o) return;
    if (p.inv.bandage <= 0 && p.inv.tonic <= 0) {
      if (o.revive === 0 && o.revivedBy !== 'nomeds') {
        o.revivedBy = 'nomeds';
        this.events.push({
          to: p.id,
          ev: { e: 'toast', text: 'You need a bandage or tonic to revive' },
        });
      }
      return;
    }
    o.revive += dt / SURVIVAL.reviveTime;
    o.revivedBy = p.id;
    if (o.revive >= 1) {
      const tonic = p.inv.bandage <= 0;
      if (tonic) p.inv.tonic--;
      else p.inv.bandage--;
      this.revive(o, tonic ? SURVIVAL.tonicRevive : SURVIVAL.bandageRevive, p.id);
    }
  }

  /** Solo players can use a tonic on themselves while downed (§4.9). */
  private selfRevive(p: SimPlayer): void {
    if (p.inv.tonic <= 0) return;
    p.inv.tonic--;
    this.revive(p, SURVIVAL.tonicRevive, p.id);
  }

  private revive(p: SimPlayer, hp: number, by: string): void {
    p.life = Life.Alive;
    p.hp = hp;
    p.revive = 0;
    p.revivedBy = '';
    p.lastHurt = this.time;
    this.events.push({ ev: { e: 'revived', id: p.id, by } });
  }

  private heal(p: SimPlayer): void {
    if (p.life === Life.Downed) {
      this.selfRevive(p);
      return;
    }
    if (p.life !== Life.Alive || p.hp >= 100) return;
    const useTonic = p.inv.tonic > 0 && (p.hp < 40 || p.inv.bandage <= 0);
    if (useTonic) {
      p.inv.tonic--;
      p.hp = Math.min(100, p.hp + SURVIVAL.tonicHeal);
    } else if (p.inv.bandage > 0) {
      p.inv.bandage--;
      p.hp = Math.min(100, p.hp + SURVIVAL.bandageHeal);
    }
  }

  private stepHealth(p: SimPlayer, dt: number): void {
    if (p.life === Life.Alive) {
      // Slow regeneration up to 50% after 10 s without damage.
      if (this.time - p.lastHurt > SURVIVAL.regenDelay && p.hp < SURVIVAL.regenCap) {
        p.hp = Math.min(SURVIVAL.regenCap, p.hp + SURVIVAL.regenPerSec * dt);
      }
    } else if (p.life === Life.Downed) {
      if (p.revivedBy && p.revivedBy !== 'nomeds') {
        // Progress is kept only while someone keeps holding.
        p.revivedBy = '';
      } else {
        p.revive = Math.max(0, p.revive - dt / SURVIVAL.reviveTime);
      }
      p.bleed -= dt;
      if (p.bleed <= 0) {
        p.life = Life.Dead;
        p.bleed = 0;
        p.revive = 0;
        // Respawn when the train passes the next station (§4.9).
        const next = nextFeature(this.features, this.train.s, ['station', 'start', 'fort']);
        p.respawnS = next ? next.s : this.train.s + 1500;
        this.events.push({ ev: { e: 'died', id: p.id } });
      }
    } else if (p.life === Life.Dead) {
      if (this.train.s >= p.respawnS) {
        p.life = Life.Alive;
        p.hp = 50;
        p.lastHurt = this.time;
        this.respawnOnTrain(p);
        this.events.push({ ev: { e: 'respawned', id: p.id } });
      }
    }
  }

  private checkRunOver(): void {
    if (this.over || this.players.size === 0) return;
    let up = 0;
    let soloHope = false;
    for (const p of this.players.values()) {
      if (p.life === Life.Alive) up++;
      // A solo player who is downed but holds a tonic can still get up.
      if (this.players.size === 1 && p.life === Life.Downed && p.inv.tonic > 0) soloHope = true;
    }
    if (up === 0 && !soloHope) {
      this.over = true;
      this.forts.finish(false);
    }
  }

  killEnemy(e: SimEnemy, by: string, _zone: number, byTrain: boolean): void {
    if (e.state === 'dead') return;
    if (by && by !== 'train') this.forts.kills++;
    e.hp = 0;
    e.state = 'dead';
    e.deadT = 0;
    e.anim = Anim.Dead;
    e.vx = e.vz = 0;
    e.climb = null;
    if (e.type === 'outlaw') {
      // Outlaws carry a bounty: their badge pays at any sheriff (§4.6).
      this.items.spawn('bounty', Frame.World, e.wx, e.wy + 0.5, e.wz, 0, { flying: true });
      if (this.rng.chance(0.6))
        this.items.spawn('ammo_rifle', Frame.World, e.wx + 0.4, e.wy + 0.5, e.wz, 0, {
          flying: true,
        });
    }
    if (byTrain) {
      e.gore |= 0x1f & (1 << Math.floor(this.rng.next() * 5));
      this.events.push({
        ev: {
          e: 'hit',
          id: e.id,
          by: 'train',
          zone: 0,
          x: e.wx,
          y: e.wy + 1,
          z: e.wz,
          kill: true,
          dmg: 999,
        },
      });
    }
    void by;
  }

  /** Players standing in the train's path get pushed aside (and hurt at speed). */
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
      const speed = Math.abs(this.train.speed);
      if (speed > 4) this.damagePlayer(p, speed * 3, w.x, w.z, 'train');
    }
  }

  /** Train-space or world position of a player in world coordinates. */
  worldPosition(p: SimPlayer): { x: number; y: number; z: number } {
    return { x: p.wx, y: p.wy, z: p.wz };
  }

  drainEvents(): OutEvent[] {
    return this.events.splice(0, this.events.length);
  }

  dispose(): void {
    this.space.dispose();
  }
}

export { ENEMIES };
