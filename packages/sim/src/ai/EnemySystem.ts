import {
  AI_LOD,
  Anim,
  CONSIST,
  DAY,
  DAY_CYCLE,
  DIRECTOR,
  ENEMIES,
  ENEMY_TYPES,
  FORT,
  type EnemyDef,
  type EnemyType,
  Frame,
  PROP_COLLIDERS,
  TILE_SIZE,
  TRAIN_LENGTH,
  WORLD,
  type Vec3,
  insideTrainBounds,
  makeFrame,
  tileKey,
  tileProps,
  trainToWorld,
  worldToTrain,
} from '@dead-tracks/shared';
import type { Sim, SimPlayer } from '../Sim.ts';

export type AiState =
  'wander' | 'alerted' | 'chase' | 'attack' | 'board' | 'ambush' | 'raid' | 'guard' | 'dead';

const HISTORY = 20;

/** One undead (or outlaw) in the simulation (§4.6). */
export interface SimEnemy {
  id: string;
  type: EnemyType;
  def: EnemyDef;
  frame: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  hp: number;
  state: AiState;
  anim: number;
  target: string | null;
  goalX: number;
  goalZ: number;
  attackT: number;
  stateT: number;
  /** Seconds since the last AI think (LOD). */
  thinkAcc: number;
  gore: number;
  deadT: number;
  climb: { t: number; tx: number; ty: number; tz: number } | null;
  /** World-space positions for lag-compensated hit checks: [time, x, y, z] × HISTORY. */
  hist: Float64Array;
  histHead: number;
  /** World position this tick. */
  wx: number;
  wy: number;
  wz: number;
  nearest: number;
  /** Pressed against the train hull this tick (climb over it when slow). */
  blocked: boolean;
  /** Outlaws: the camp they guard. */
  homeX: number;
  homeZ: number;
}

interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/**
 * Enemy AI, movement and the spawn director (§4.6, §6.10). Enemies walk on the
 * terrain height function with steering and separation; they board the train
 * when it is slow and fight in train space.
 */
export class EnemySystem {
  readonly enemies = new Map<string, SimEnemy>();
  private nextId = 1;
  private spawnAcc = 0;
  /** Recent noise adds to the director's budget (§4.6). */
  noise = 0;
  private readonly obstacles = new Map<string, Obstacle[]>();
  private readonly grid = new Map<number, SimEnemy[]>();
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly frame = makeFrame();
  /** Development: stop the director spawning. */
  paused = false;
  private raidAcc = 0;
  /** Camps whose guards have been spawned this day. */
  private readonly campDay = new Map<string, number>();

  constructor(private readonly sim: Sim) {}

  get count(): number {
    return this.enemies.size;
  }

  get alive(): number {
    let n = 0;
    for (const e of this.enemies.values()) if (e.state !== 'dead') n++;
    return n;
  }

  spawn(type: EnemyType, x: number, z: number, frame = Frame.World, y?: number): SimEnemy {
    const def = ENEMIES[type];
    const e: SimEnemy = {
      id: String(this.nextId++),
      type,
      def,
      frame,
      x,
      y: y ?? this.sim.terrain.height(x, z),
      z,
      yaw: this.sim.rng.range(-Math.PI, Math.PI),
      vx: 0,
      vz: 0,
      hp: def.hp,
      state: 'wander',
      anim: Anim.Idle,
      target: null,
      goalX: x,
      goalZ: z,
      attackT: 0,
      stateT: 0,
      thinkAcc: this.sim.rng.next() * 0.2,
      gore: 0,
      deadT: 0,
      climb: null,
      hist: new Float64Array(HISTORY * 4),
      histHead: 0,
      wx: x,
      wy: 0,
      wz: z,
      nearest: 0,
      blocked: false,
      homeX: x,
      homeZ: z,
    };
    this.enemies.set(e.id, e);
    this.updateWorldPos(e);
    return e;
  }

  remove(id: string): void {
    this.enemies.delete(id);
  }

  /** Something loud happened (§4.6: gunshots and the whistle attract enemies). */
  makeNoise(x: number, z: number, radius: number): void {
    this.noise = Math.min(this.noise + radius / 40, DIRECTOR.noiseBudget * 2);
    const r2 = radius * radius;
    for (const e of this.enemies.values()) {
      if (e.state === 'dead' || e.state === 'chase' || e.state === 'attack') continue;
      const dx = e.wx - x;
      const dz = e.wz - z;
      if (dx * dx + dz * dz < r2) {
        e.state = 'alerted';
        e.goalX = x + this.sim.rng.range(-6, 6);
        e.goalZ = z + this.sim.rng.range(-6, 6);
        e.stateT = 12;
      }
    }
  }

  step(dt: number): void {
    const sim = this.sim;
    this.noise = Math.max(0, this.noise - DIRECTOR.noiseDecay * dt * DIRECTOR.noiseBudget);
    this.rebuildGrid();
    const players = [...sim.players.values()];
    for (const e of this.enemies.values()) {
      // Distance to the nearest player drives the AI level of detail (§6.10).
      let nearest = Infinity;
      for (const p of players) {
        if (!p.connected && p.life !== 0) continue;
        const dx = p.wx - e.wx;
        const dz = p.wz - e.wz;
        nearest = Math.min(nearest, Math.hypot(dx, dz));
      }
      e.nearest = nearest;
      if (e.state === 'dead') {
        e.deadT += dt;
        // After the fall, the corpse becomes an item to burn, sell or search (§4.3).
        if (e.deadT > 2.5) {
          this.enemies.delete(e.id);
          if (nearest < DIRECTOR.despawn) sim.items.addBody(e.type, e.frame, e.x, e.y, e.z, e.yaw);
        }
        continue;
      }
      // Raiders gathering at a parked train stay even with everyone far away (§4.3).
      const raiding = e.state === 'raid' || e.state === 'ambush' || e.frame === Frame.Train;
      if (nearest > DIRECTOR.despawn && e.frame === Frame.World && !raiding) {
        this.enemies.delete(e.id);
        continue;
      }
      e.thinkAcc += dt;
      const interval = nearest < AI_LOD.full ? 0 : 1 / AI_LOD.reducedHz;
      if (e.thinkAcc >= interval) {
        const step = Math.min(e.thinkAcc, 0.25);
        e.thinkAcc = 0;
        this.think(e, players, step);
        e.blocked = false;
        this.move(e, step);
      }
      this.updateWorldPos(e);
      this.recordHistory(e);
    }
    this.direct(dt, players);
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const e of this.enemies.values()) {
      if (e.state === 'dead') continue;
      const k = cellKey(e.wx, e.wz);
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(e);
    }
  }

  private updateWorldPos(e: SimEnemy): void {
    if (e.frame === Frame.World) {
      e.wx = e.x;
      e.wy = e.y;
      e.wz = e.z;
    } else {
      trainToWorld(this.sim.poses, e.x, e.y, e.z, this.tmp);
      e.wx = this.tmp.x;
      e.wy = this.tmp.y;
      e.wz = this.tmp.z;
    }
  }

  private recordHistory(e: SimEnemy): void {
    const o = e.histHead * 4;
    e.hist[o] = this.sim.time;
    e.hist[o + 1] = e.wx;
    e.hist[o + 2] = e.wy;
    e.hist[o + 3] = e.wz;
    e.histHead = (e.histHead + 1) % HISTORY;
  }

  /**
   * World positions this enemy had between t0 and t1, ordered by how close their
   * time is to `seen` (when the shooter saw it), so the best match is tried first.
   */
  positionsBetween(
    e: SimEnemy,
    t0: number,
    t1: number,
    out: Array<[number, number, number]>,
    seen = t1,
  ): void {
    const found: Array<[number, number, number, number]> = [];
    for (let i = 0; i < HISTORY; i++) {
      const o = ((e.histHead + i) % HISTORY) * 4;
      const t = e.hist[o] as number;
      if (t >= t0 && t <= t1 && t > 0)
        found.push([
          Math.abs(t - seen),
          e.hist[o + 1] as number,
          e.hist[o + 2] as number,
          e.hist[o + 3] as number,
        ]);
    }
    found.sort((a, b) => a[0] - b[0]);
    out.length = 0;
    for (const f of found) out.push([f[1], f[2], f[3]]);
    if (out.length === 0) out.push([e.wx, e.wy, e.wz]);
  }

  private pickTarget(e: SimEnemy, players: SimPlayer[]): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bestD = e.def.sight;
    for (const p of players) {
      // Downed and disconnected players are left alone (§4.9, §6.8).
      if (p.life !== 0 || !p.connected) continue;
      const d = Math.hypot(p.wx - e.wx, p.wz - e.wz);
      // Noise makes them notice from farther away while alerted.
      const reach = e.state === 'alerted' ? e.def.sight * 1.6 : e.def.sight;
      if (d < Math.min(bestD, reach)) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private think(e: SimEnemy, players: SimPlayer[], dt: number): void {
    const sim = this.sim;
    e.attackT = Math.max(0, e.attackT - dt);
    e.stateT -= dt;
    if (e.climb) return;
    if (e.type === 'outlaw') {
      this.thinkOutlaw(e, players);
      return;
    }
    if (e.state === 'raid') {
      // Heading for the parked train (§4.3): climb aboard and wait.
      const target = this.pickTarget(e, players);
      if (target) {
        e.state = 'chase';
        e.target = target.id;
      } else {
        if (Math.hypot(e.goalX - e.x, e.goalZ - e.z) < 2.5 || e.blocked) this.tryBoard(e);
        return;
      }
    }
    if (e.state === 'ambush' && e.frame === Frame.Train) {
      // Knock cargo off now and then while nobody is around.
      if (e.stateT <= 0) {
        e.stateT = sim.rng.range(10, 18);
        sim.items.knockCargo(e.x, e.z);
      }
    }
    const target = this.pickTarget(e, players);
    if (target) {
      e.target = target.id;
      if (e.state !== 'attack') e.state = 'chase';
    } else if (e.state === 'chase' || e.state === 'attack') {
      e.state = e.frame === Frame.Train ? 'ambush' : 'wander';
      e.target = null;
    } else if (e.state === 'alerted' && e.stateT <= 0) {
      e.state = 'wander';
    }

    if (e.state === 'wander' && (e.stateT <= 0 || Math.hypot(e.goalX - e.x, e.goalZ - e.z) < 1)) {
      e.stateT = sim.rng.range(3, 8);
      if (e.frame === Frame.World) {
        e.goalX = e.x + sim.rng.range(-12, 12);
        e.goalZ = e.z + sim.rng.range(-12, 12);
      } else {
        e.goalX = sim.rng.range(-1, 1);
        e.goalZ = sim.rng.range(0, TRAIN_LENGTH);
      }
    }

    if ((e.state === 'chase' || e.state === 'attack') && e.target) {
      const p = sim.players.get(e.target);
      if (!p) return;
      const dist = Math.hypot(p.wx - e.wx, p.wy - e.wy, p.wz - e.wz);
      if (dist <= e.def.attackRange) {
        e.state = 'attack';
        if (e.attackT <= 0) {
          e.attackT = e.def.attackInterval;
          e.anim = Anim.Attack;
          sim.damagePlayer(p, e.def.damage, e.wx, e.wz, e.id);
          sim.events.push({ ev: { e: 'enemyAttack', id: e.id } });
        }
      } else {
        e.state = 'chase';
      }
      // Goal in the enemy's own frame.
      if (e.frame === Frame.Train) {
        if (p.motor.frame === Frame.Train) {
          e.goalX = p.motor.x;
          e.goalZ = p.motor.z;
        } else {
          // Target left the train: jump down toward them.
          worldToTrain(sim.poses, p.wx, p.wy, p.wz, this.tmp);
          e.goalX = this.tmp.x;
          e.goalZ = this.tmp.z;
        }
      } else if (p.motor.frame === Frame.Train && e.def.boards) {
        // Head for the side of the train nearest the target, then climb.
        worldToTrain(sim.poses, e.wx, e.wy, e.wz, this.tmp);
        const side = this.tmp.x >= 0 ? 1 : -1;
        const z = Math.max(1, Math.min(TRAIN_LENGTH - 1, p.motor.z));
        trainToWorld(sim.poses, side * 2.0, 0, z, this.tmp);
        e.goalX = this.tmp.x;
        e.goalZ = this.tmp.z;
        this.tryBoard(e);
      } else {
        e.goalX = p.wx;
        e.goalZ = p.wz;
        // The train is in the way: climb over it while it is slow (§4.3).
        if (e.blocked && e.def.boards) {
          worldToTrain(sim.poses, e.wx, e.wy, e.wz, this.tmp);
          const mySide = Math.sign(this.tmp.x);
          worldToTrain(sim.poses, p.wx, p.wy, p.wz, this.tmp);
          if (Math.sign(this.tmp.x) !== mySide && this.tmp.z > -2 && this.tmp.z < TRAIN_LENGTH + 2)
            this.tryBoard(e);
        }
      }
    } else if (e.state === 'alerted') {
      // Goal set by makeNoise.
    } else if (e.state === 'ambush') {
      e.anim = Anim.Crouch;
    }
  }

  /** Climb onto a slow train from beside it (§4.3). */
  private tryBoard(e: SimEnemy): void {
    const sim = this.sim;
    const speed = Math.abs(sim.train.speed);
    const limit = e.type === 'runner' || e.type === 'werewolf' || e.type === 'vampire' ? 6 : 3;
    if (speed > limit) return;
    worldToTrain(sim.poses, e.wx, e.wy, e.wz, this.tmp);
    if (Math.abs(this.tmp.x) > 2.7 || this.tmp.z < 0.5 || this.tmp.z > TRAIN_LENGTH - 0.5) return;
    const side = this.tmp.x >= 0 ? 1 : -1;
    const tz = this.tmp.z;
    // Fortifications (§4.3): plates stop climbers (brutes smash them), wire cuts them.
    const fort = sim.items.fortAt(side, tz);
    if (fort >= 0) {
      if (sim.items.forts[fort] === 1) {
        if (e.type === 'brute' && e.attackT <= 0) {
          e.attackT = e.def.attackInterval;
          e.anim = Anim.Attack;
          sim.items.damageFort(fort, FORT.bruteDamage);
        } else if (e.type !== 'brute') {
          // Look for an unprotected stretch further along.
          e.goalZ += sim.rng.chance(0.5) ? 6 : -6;
        }
        return;
      }
      e.hp -= FORT.wireDps * 0.5;
      sim.items.damageFort(fort, 6);
      if (e.hp <= 0) {
        sim.killEnemy(e, '', 0, false);
        return;
      }
    }
    const hit = sim.space.rayTrain(side * 0.9, 5, tz, 0, -1, 0, 6);
    if (!hit) return;
    const floor = 5 - hit.toi;
    if (floor > 3.2) return;
    e.frame = Frame.Train;
    e.x = this.tmp.x;
    e.y = this.tmp.y;
    e.z = tz;
    e.climb = { t: 0.9, tx: side * 0.9, ty: floor, tz };
    e.anim = Anim.Climb;
  }

  private move(e: SimEnemy, dt: number): void {
    const sim = this.sim;
    if (e.climb) {
      const c = e.climb;
      const k = Math.min(1, dt / c.t);
      e.x += (c.tx - e.x) * k;
      e.y += (c.ty - e.y) * k;
      e.z += (c.tz - e.z) * k;
      c.t -= dt;
      if (c.t <= 0) {
        e.x = c.tx;
        e.y = c.ty;
        e.z = c.tz;
        e.climb = null;
        if (e.state === 'raid' || !e.target) {
          e.state = 'ambush';
          e.stateT = this.sim.rng.range(6, 14);
        }
      }
      return;
    }
    const moving = e.state !== 'attack' && e.state !== 'ambush';
    const speed =
      e.state === 'chase'
        ? e.def.chaseSpeed
        : e.state === 'alerted'
          ? e.def.speed * 1.4
          : e.def.speed;
    let dx = e.goalX - e.x;
    let dz = e.goalZ - e.z;
    const dl = Math.hypot(dx, dz);
    let wantX = 0;
    let wantZ = 0;
    if (moving && dl > 0.4) {
      dx /= dl;
      dz /= dl;
      wantX = dx * speed;
      wantZ = dz * speed;
    }
    // Separation from neighbours.
    if (e.frame === Frame.World) {
      const cx = Math.floor(e.wx / CELL);
      const cz = Math.floor(e.wz / CELL);
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          const list = this.grid.get(gx * 100003 + gz);
          if (!list) continue;
          for (const o of list) {
            if (o === e) continue;
            const ox = e.wx - o.wx;
            const oz = e.wz - o.wz;
            const d2 = ox * ox + oz * oz;
            const min = 0.7 * (e.def.scale + o.def.scale);
            if (d2 < min * min && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const push = ((min - d) / min) * 3;
              wantX += (ox / d) * push;
              wantZ += (oz / d) * push;
            }
          }
        }
      }
      // Trees and rocks.
      for (const ob of this.obstaclesNear(e.x, e.z)) {
        const ox = e.x - ob.x;
        const oz = e.z - ob.z;
        const d = Math.hypot(ox, oz);
        const min = ob.r + 0.35;
        if (d < min + 0.6 && d > 1e-4) {
          const push = ((min + 0.6 - d) / 0.6) * speed;
          wantX += (ox / d) * push;
          wantZ += (oz / d) * push;
        }
      }
    }
    const k = Math.min(1, dt * 8);
    e.vx += (wantX - e.vx) * k;
    e.vz += (wantZ - e.vz) * k;
    const vl = Math.hypot(e.vx, e.vz);
    if (vl > 0.15) {
      const targetYaw = Math.atan2(-e.vx, -e.vz);
      let d = targetYaw - e.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.yaw += d * Math.min(1, dt * 6);
    } else if (e.target && e.state === 'attack') {
      const p = sim.players.get(e.target);
      if (p) e.yaw = Math.atan2(-(p.wx - e.wx), -(p.wz - e.wz));
    }
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    if (e.anim !== Anim.Attack || e.attackT < e.def.attackInterval - 0.6) {
      e.anim =
        vl > 2.5 ? Anim.Run : vl > 0.2 ? Anim.Walk : e.state === 'ambush' ? Anim.Crouch : Anim.Idle;
    }

    if (e.frame === Frame.World) {
      e.y = sim.terrain.height(e.x, e.z);
    } else {
      // Walk on the decks; fall off the edges back into the world.
      if (!insideTrainBounds(e.x, e.y, e.z)) {
        this.toWorld(e);
        return;
      }
      const hit = sim.space.rayTrain(e.x, e.y + 1.2, e.z, 0, -1, 0, 2.5);
      if (hit) e.y = e.y + 1.2 - hit.toi;
      else {
        e.y -= 9 * dt;
        if (e.y < 0.2) this.toWorld(e);
      }
    }
  }

  private toWorld(e: SimEnemy): void {
    // Land clear of the hull on the side they fell from.
    const side = e.x >= 0 ? 1 : -1;
    trainToWorld(this.sim.poses, Math.abs(e.x) < 1.9 ? side * 1.95 : e.x, 0, e.z, this.tmp);
    e.frame = Frame.World;
    e.x = this.tmp.x;
    e.z = this.tmp.z;
    e.y = this.sim.terrain.height(e.x, e.z);
    e.state = 'wander';
    e.stateT = 1;
  }

  private obstaclesNear(x: number, z: number): Obstacle[] {
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    const key = tileKey(tx, tz);
    let list = this.obstacles.get(key);
    if (!list) {
      list = [];
      for (const p of tileProps(this.sim.terrain, tx, tz, 0)) {
        const spec = PROP_COLLIDERS[p.kind];
        if (spec) list.push({ x: p.x, z: p.z, r: spec.radius * p.scale });
      }
      this.obstacles.set(key, list);
      if (this.obstacles.size > 64)
        this.obstacles.delete(this.obstacles.keys().next().value as string);
    }
    return list;
  }

  /** The moving train shoves or runs over enemies in its path. */
  trainContacts(): void {
    const sim = this.sim;
    const speed = Math.abs(sim.train.speed);
    for (const e of this.enemies.values()) {
      if (e.frame !== Frame.World || e.state === 'dead' || e.climb) continue;
      worldToTrain(sim.poses, e.x, e.y, e.z, this.tmp);
      if (this.tmp.z < -0.6 || this.tmp.z > TRAIN_LENGTH + 0.6 || Math.abs(this.tmp.x) > 1.7)
        continue;
      if (this.tmp.y > 4.2 || this.tmp.y < -1.5) continue;
      if (speed > 5) {
        sim.killEnemy(e, '', 0, true);
        continue;
      }
      const side = this.tmp.x >= 0 ? 1 : -1;
      trainToWorld(sim.poses, side * 1.85, 0, this.tmp.z, this.tmp);
      e.x = this.tmp.x;
      e.z = this.tmp.z;
      e.y = sim.terrain.height(e.x, e.z);
      e.blocked = true;
    }
  }

  /** Spawn director (§4.6): a budget from distance, time of day, party size and noise. */
  private direct(dt: number, players: SimPlayer[]): void {
    if (this.paused) return;
    this.raidParkedTrain(dt, players);
    this.guardCamps(players);
    const sim = this.sim;
    const alive = players.filter((p) => p.life === 0 && p.connected);
    if (alive.length === 0) return;
    this.spawnAcc += dt;
    if (this.spawnAcc < DIRECTOR.spawnInterval) return;
    this.spawnAcc = 0;
    const budget = this.budget(players.length);
    const active = this.alive;
    if (active >= Math.min(budget, DIRECTOR.maxEnemies)) return;
    const ref = alive[Math.floor(sim.rng.next() * alive.length)] as SimPlayer;
    const pos = this.spawnPoint(ref);
    if (!pos) return;
    const group = Math.min(1 + Math.floor(sim.rng.next() * 3), DIRECTOR.maxEnemies - active);
    const night = sim.isNight;
    for (let i = 0; i < group; i++) {
      const type = this.rollType(night);
      const e = this.spawn(type, pos.x + sim.rng.range(-3, 3), pos.z + sim.rng.range(-3, 3));
      if (night || this.noise > 2) {
        // Night hordes come for the train.
        e.state = 'alerted';
        e.goalX = ref.wx;
        e.goalZ = ref.wz;
        e.stateT = 20;
      }
    }
  }

  /**
   * The parked train (§4.3): with everyone away from a stopped train, the undead
   * gather, climb aboard and wait. Lighter for small parties.
   */
  private raidParkedTrain(dt: number, players: SimPlayer[]): void {
    const sim = this.sim;
    if (Math.abs(sim.train.speed) > 1) return;
    const loco = sim.poses[1]!;
    const away = players.every(
      (p) => p.life !== 0 || !p.connected || Math.hypot(p.wx - loco.cx, p.wz - loco.cz) > 70,
    );
    if (!away || players.length === 0) return;
    this.raidAcc += dt;
    if (this.raidAcc < 4) return;
    this.raidAcc = 0;
    let near = 0;
    for (const e of this.enemies.values()) {
      if (e.state !== 'dead' && Math.hypot(e.wx - loco.cx, e.wz - loco.cz) < 60) near++;
    }
    const cap = players.length <= 1 ? 3 : players.length === 2 ? 5 : 8;
    if (near >= cap) return;
    const a = sim.rng.range(0, Math.PI * 2);
    const d = sim.rng.range(35, 55);
    const e = this.spawn(
      sim.rng.chance(0.25) ? 'runner' : 'walker',
      loco.cx + Math.cos(a) * d,
      loco.cz + Math.sin(a) * d,
    );
    e.state = 'raid';
    const side = sim.rng.chance(0.5) ? 1 : -1;
    trainToWorld(sim.poses, side * 2.0, 0, sim.rng.range(4, TRAIN_LENGTH - 2), this.tmp);
    e.goalX = this.tmp.x;
    e.goalZ = this.tmp.z;
  }

  /** Outlaws guard their camps by day (§4.6); once per day per camp. */
  private guardCamps(players: SimPlayer[]): void {
    const sim = this.sim;
    if (sim.isNight) return;
    for (const p of players) {
      for (const st of sim.world.structuresNear(p.wx, p.wz, 130)) {
        if (st.kind !== 'camp' || this.campDay.get(st.id) === sim.day) continue;
        this.campDay.set(st.id, sim.day);
        const n = 3 + Math.floor(sim.rng.next() * 3);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const e = this.spawn('outlaw', st.x + Math.cos(a) * 4, st.z + Math.sin(a) * 4);
          e.state = 'guard';
          e.homeX = st.x;
          e.homeZ = st.z;
        }
      }
    }
  }

  /** Ranged human AI: keep a fighting distance, strafe, and shoot (§4.6). */
  private thinkOutlaw(e: SimEnemy, players: SimPlayer[]): void {
    const sim = this.sim;
    let target: SimPlayer | null = null;
    let best = e.state === 'chase' ? 85 : e.def.sight;
    for (const p of players) {
      if (p.life !== 0 || !p.connected) continue;
      const d = Math.hypot(p.wx - e.wx, p.wz - e.wz);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    if (!target) {
      e.target = null;
      e.state = 'guard';
      e.goalX = e.homeX + Math.sin(sim.time * 0.1 + Number(e.id)) * 5;
      e.goalZ = e.homeZ + Math.cos(sim.time * 0.1 + Number(e.id)) * 5;
      return;
    }
    e.state = 'chase';
    e.target = target.id;
    const dx = target.wx - e.wx;
    const dz = target.wz - e.wz;
    const d = Math.hypot(dx, dz) || 1;
    // Hold 15–30 m: back off when close, close in when far, strafe in between.
    const strafe = Math.sin(sim.time * 0.7 + Number(e.id)) > 0 ? 1 : -1;
    let gx = e.x;
    let gz = e.z;
    if (d < 13) {
      gx -= (dx / d) * 6;
      gz -= (dz / d) * 6;
    } else if (d > 32) {
      gx += (dx / d) * 6;
      gz += (dz / d) * 6;
    } else {
      gx += (-dz / d) * strafe * 4;
      gz += (dx / d) * strafe * 4;
    }
    e.goalX = gx;
    e.goalZ = gz;
    e.yaw = Math.atan2(-dx, -dz);
    if (e.attackT > 0 || d > 70) return;
    e.attackT = e.def.attackInterval * sim.rng.range(0.8, 1.3);
    e.anim = Anim.Attack;
    // Line of sight from the rifle to the target.
    const ox = e.wx;
    const oy = e.wy + 1.5;
    const oz = e.wz;
    const tx = target.wx;
    const ty = target.wy + 1.2;
    const tz = target.wz;
    const len = Math.hypot(tx - ox, ty - oy, tz - oz);
    const block = sim.space.rayGround(
      ox,
      oy,
      oz,
      (tx - ox) / len,
      (ty - oy) / len,
      (tz - oz) / len,
      len - 0.5,
    );
    const blocked = !!block && !sim.space.isTrainCollider(block.collider);
    sim.events.push({
      ev: {
        e: 'shot',
        by: `e${e.id}`,
        w: 'rifle',
        ox,
        oy,
        oz,
        dx: (tx - ox) / len,
        dy: (ty - oy) / len,
        dz: (tz - oz) / len,
      },
    });
    sim.enemySystem.makeNoise(ox, oz, 60);
    const moving = Math.hypot(target.motor.vx, target.motor.vz) > 3 ? 0.6 : 1;
    const chance = Math.max(0.08, 0.62 - d / 110) * moving;
    if (!blocked && sim.rng.chance(chance))
      sim.damagePlayer(target, e.def.damage, e.wx, e.wz, e.id);
  }

  budget(partySize: number): number {
    const sim = this.sim;
    const km = Math.max(0, sim.train.s / WORLD.metersPerKm);
    const n = sim.nightFactor;
    const base = DIRECTOR.dayBudget + (DIRECTOR.nightBudget - DIRECTOR.dayBudget) * n;
    const party = 1 + DIRECTOR.perPlayer * Math.max(0, partySize - 1);
    return Math.round(base * party * (1 + DIRECTOR.perKm * km) + this.noise);
  }

  private rollType(night: boolean): EnemyType {
    const sim = this.sim;
    const nights =
      Math.floor((sim.time + DAY.startOffset * DAY.dayLength) / DAY_CYCLE) + (night ? 1 : 0);
    const types: EnemyType[] = [];
    const weights: number[] = [];
    for (const t of ENEMY_TYPES) {
      const d = ENEMIES[t];
      const w = d.weight[night ? 1 : 0];
      if (w <= 0 || nights < d.fromNight) continue;
      types.push(t);
      weights.push(w);
    }
    return types.length ? sim.rng.weighted(types, weights) : 'walker';
  }

  private spawnPoint(ref: SimPlayer): { x: number; z: number } | null {
    const sim = this.sim;
    for (let attempt = 0; attempt < 6; attempt++) {
      let x: number;
      let z: number;
      const moving = Math.abs(sim.train.speed) > 4 && ref.motor.frame === Frame.Train;
      if (moving) {
        // Ahead of a moving train, off to the side of the track.
        const s = sim.train.s + sim.train.speed * sim.rng.range(4, 8);
        sim.route.frameAt(s, this.frame);
        const side = sim.rng.chance(0.5) ? 1 : -1;
        const lat = side * sim.rng.range(8, 30);
        x = this.frame.x + this.frame.rx * lat;
        z = this.frame.z + this.frame.rz * lat;
      } else {
        // Around the player, preferring behind them.
        const look = ref.motor.yaw + (ref.motor.frame === Frame.Train ? sim.poses[0]!.yaw : 0);
        const a = look + Math.PI + sim.rng.range(-1.6, 1.6);
        const d = sim.rng.range(DIRECTOR.spawnMin, DIRECTOR.spawnMax);
        x = ref.wx - Math.sin(a) * d;
        z = ref.wz - Math.cos(a) * d;
      }
      let ok = true;
      for (const p of sim.players.values()) {
        if (Math.hypot(p.wx - x, p.wz - z) < 25) ok = false;
      }
      const n = sim.route.nearest(x, z, 5);
      if (n) ok = false;
      if (ok) return { x, z };
    }
    return null;
  }
}

const CELL = 2;
function cellKey(x: number, z: number): number {
  return Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
}

export { CONSIST };
