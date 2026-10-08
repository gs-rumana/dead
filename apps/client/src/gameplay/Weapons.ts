import * as THREE from 'three/webgpu';
import {
  type ClaimedHit,
  type EnemyType,
  type GunDef,
  type InventoryState,
  PLAYER,
  type PhysicsSpace,
  WEAPONS,
  type WeaponDef,
  type WeaponId,
  bulletDrop,
  rayVsEnemy,
  shotDirections,
  shotSeed,
  type ClassId,
  hipSpreadFor,
} from '@dead-tracks/shared';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import type { Connection } from '../net/Connection.ts';
import { weaponModel } from '../render/models/weapons.ts';
import type { Effects } from './Effects.ts';
import type { EnemyView } from './EnemyView.ts';

export interface WeaponContext {
  conn: Connection;
  space: PhysicsSpace;
  enemies: EnemyView;
  effects: Effects;
  audio: () => AudioEngine | null;
  camera: THREE.PerspectiveCamera;
  /** Render origin (world = render + origin). */
  origin: () => { x: number; z: number };
  /** Local player's eye in world space. */
  eye: () => { x: number; y: number; z: number };
  inventory: () => InventoryState | undefined;
  alive: () => boolean;
  driving: () => boolean;
  /** The local player's class (§4.11: Gunslingers have tighter hip fire). */
  cls: () => ClassId;
}

const tmpDir = new THREE.Vector3();

/**
 * Client side of combat (§4.7): hip fire and iron sights, shots from the crosshair
 * checked from the eye, client-claimed hits that the host re-checks, recoil, melee
 * swings and throws.
 */
export class Weapons {
  /** 0 = hip, 1 = iron sights (0.2 s transition). */
  aimT = 0;
  /** Visual pitch kick (radians), decays. */
  kick = 0;
  /** Permanent aim drift to apply to the look pitch. */
  drift = 0;
  /** Crosshair bloom 0..1 after shots. */
  bloom = 0;
  private seq = 0;
  private lastFire = -1;
  private pending = 0;
  private lastMag = -1;
  /** Hit marker: time left and whether it was a kill. */
  hitMarker = 0;
  hitKill = false;
  /** Last shot details, for tests and debugging. */
  lastShot: {
    claims: number;
    targetT: number;
    eye: number[];
    dir: number[];
    enemies: number;
  } | null = null;

  constructor(private readonly ctx: WeaponContext) {}

  held(): WeaponDef | null {
    const inv = this.ctx.inventory();
    if (!inv) return null;
    const id = inv.slots[inv.selected] ?? '';
    return WEAPONS[id as WeaponId] ?? null;
  }

  /** Rounds in the magazine as shown (server value minus shots not yet confirmed). */
  magazine(): number {
    const inv = this.ctx.inventory();
    if (!inv) return 0;
    const m = inv.mags[inv.selected] ?? 0;
    if (m !== this.lastMag) {
      this.lastMag = m;
      this.pending = 0;
    }
    return Math.max(0, m - this.pending);
  }

  reserve(): number {
    const inv = this.ctx.inventory();
    const w = this.held();
    if (!inv || !w || w.kind !== 'gun') return 0;
    return inv[w.ammo];
  }

  update(dt: number, aimHeld: boolean): void {
    const w = this.held();
    const canAim = !!w && w.kind === 'gun' && this.ctx.alive() && !this.ctx.driving();
    const target = aimHeld && canAim ? 1 : 0;
    this.aimT = Math.max(0, Math.min(1, this.aimT + (target ? dt : -dt) / 0.2));
    this.kick *= Math.exp(-dt * 14);
    this.bloom = Math.max(0, this.bloom - dt * 3);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
  }

  /** Fire button pressed this tick. */
  trigger(now: number): void {
    if (!this.ctx.alive() || this.ctx.driving()) return;
    const w = this.held();
    if (!w) return;
    if (w.kind === 'gun') this.fire(w, now);
    else if (w.kind === 'melee') this.melee(w.interval, now);
    else this.throw(now);
  }

  private aimRay(): THREE.Vector3 {
    return this.ctx.camera.getWorldDirection(tmpDir);
  }

  private fire(gun: GunDef, now: number): void {
    const ctx = this.ctx;
    if (now - this.lastFire < gun.fireInterval * 1000 - 20) return;
    const inv = ctx.inventory();
    if (!inv || (inv.reload > 0.001 && gun.reloadPerRound === false)) return;
    if (this.magazine() <= 0) {
      this.lastFire = now;
      ctx.audio()?.dryFire();
      // Empty: start reloading automatically.
      if (this.reserve() > 0 && inv.reload <= 0) ctx.conn.send('cmd', { t: 'reload' });
      return;
    }
    this.lastFire = now;
    this.pending++;
    const o = ctx.origin();
    const cam = ctx.camera.position;
    const camX = cam.x + o.x;
    const camY = cam.y;
    const camZ = cam.z + o.z;
    const dir = this.aimRay();
    // 1. What is under the crosshair?
    const reach = gun.range;
    let targetT = reach;
    const world = ctx.space.rayGround(camX, camY, camZ, dir.x, dir.y, dir.z, reach);
    if (world) targetT = world.toi;
    ctx.enemies.forEach((_id, type, x, y, z, dead) => {
      if (dead) return;
      const h = rayVsEnemy(type, x, y, z, camX, camY, camZ, dir.x, dir.y, dir.z, targetT);
      if (h && h.t < targetT) targetT = h.t;
    });
    const tx = camX + dir.x * targetT;
    const ty = camY + dir.y * targetT;
    const tz = camZ + dir.z * targetT;
    // 2. Shoot from the eye toward it.
    const eye = ctx.eye();
    let dx = tx - eye.x;
    let dy = ty - eye.y;
    let dz = tz - eye.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const aim = this.aimT > 0.8;
    const seq = ++this.seq;
    const hip = hipSpreadFor(ctx.cls(), gun);
    const spread = (aim ? gun.aimSpread : hip) * (1 + this.bloom * 0.6);
    const pellets = shotDirections(
      dx,
      dy,
      dz,
      aim ? gun.aimSpread : hip,
      gun.pellets,
      shotSeed(seq),
    );
    void spread;
    const hits: ClaimedHit[] = [];
    let anyHit = false;
    const muzzle = this.muzzleWorld(eye, dx, dy, dz);
    pellets.forEach(([px, py, pz], i) => {
      let best = gun.range;
      let bestId = '';
      let bestType: EnemyType = 'walker';
      const w = ctx.space.rayGround(eye.x, eye.y, eye.z, px, py, pz, gun.range);
      const wallT = w && !ctx.space.isTrainCollider(w.collider) ? w.toi : gun.range;
      ctx.enemies.forEach((id, type, x, y, z, dead) => {
        if (dead) return;
        const dist = Math.hypot(x - eye.x, z - eye.z);
        const drop = bulletDrop(gun.drop, gun.speed, dist);
        const h = rayVsEnemy(
          type,
          x,
          y + drop,
          z,
          eye.x,
          eye.y,
          eye.z,
          px,
          py,
          pz,
          Math.min(best, wallT),
        );
        if (h && h.t < best) {
          best = h.t;
          bestId = id;
          bestType = type;
        }
      });
      void bestType;
      const endT = bestId ? best : w ? w.toi : gun.range;
      const ex = eye.x + px * endT;
      const ey = eye.y + py * endT;
      const ez = eye.z + pz * endT;
      if (i < 3) ctx.effects.tracer(muzzle.x, muzzle.y, muzzle.z, ex, ey, ez);
      if (bestId) {
        hits.push({ e: bestId, p: i });
        anyHit = true;
      } else if (w) {
        ctx.effects.impact(ex, ey, ez, ctx.space.isTrainCollider(w.collider));
      }
    });
    let enemies = 0;
    ctx.enemies.forEach(() => enemies++);
    this.lastShot = {
      claims: hits.length,
      targetT,
      eye: [eye.x, eye.y, eye.z],
      dir: [dx, dy, dz],
      enemies,
    };
    ctx.conn.send('cmd', {
      t: 'fire',
      seq,
      ox: eye.x,
      oy: eye.y,
      oz: eye.z,
      dx,
      dy,
      dz,
      aim,
      hits,
    });
    ctx.effects.muzzle(muzzle.x, muzzle.y, muzzle.z, gun.pellets > 1 ? 1.4 : 1);
    ctx.audio()?.gunshot(gun.id);
    this.kick += gun.recoil * (aim ? 0.7 : 1);
    this.drift += gun.recoil * 0.18;
    this.bloom = Math.min(1, this.bloom + 0.5);
    if (anyHit) {
      this.hitMarker = 0.18;
      this.hitKill = false;
    }
  }

  private muzzleWorld(
    eye: { x: number; y: number; z: number },
    dx: number,
    dy: number,
    dz: number,
  ) {
    const w = this.held();
    const len = w ? (weaponModel(w.id)?.muzzle.z ?? -0.3) : -0.3;
    // Roughly where the barrel ends: ahead of the eye, slightly right and low.
    const rx = -dz;
    const rz = dx;
    const rl = Math.hypot(rx, rz) || 1;
    const side = this.aimT > 0.5 ? 0 : 0.25;
    return {
      x: eye.x + dx * (0.4 - len) + (rx / rl) * side,
      y: eye.y + dy * (0.4 - len) - (this.aimT > 0.5 ? 0.06 : 0.25),
      z: eye.z + dz * (0.4 - len) + (rz / rl) * side,
    };
  }

  private melee(interval: number, now: number): void {
    if (now - this.lastFire < interval * 1000 - 20) return;
    this.lastFire = now;
    const d = this.aimRay();
    this.ctx.conn.send('cmd', { t: 'melee', dx: d.x, dz: d.z });
    this.ctx.audio()?.swing();
  }

  private throw(now: number): void {
    if (now - this.lastFire < 800) return;
    this.lastFire = now;
    const d = this.aimRay();
    this.ctx.conn.send('cmd', { t: 'throw', dx: d.x, dy: d.y, dz: d.z });
    this.ctx.audio()?.swing();
  }

  /** The host confirmed one of our hits. */
  confirmHit(kill: boolean): void {
    this.hitMarker = 0.25;
    this.hitKill = this.hitKill || kill;
  }

  /** Eye height helper for callers. */
  static eyeHeight = PLAYER.eyeHeight;
}
