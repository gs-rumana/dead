import {
  type Command,
  ENEMIES,
  ENEMY_TYPES,
  Frame,
  type GunDef,
  HEADSHOT_MULTIPLIER,
  LIMB_MULTIPLIER,
  type MeleeDef,
  PERKS,
  hipSpreadFor,
  magazineFor,
  reloadTimeFor,
  PLAYER,
  type ThrowDef,
  WEAPONS,
  type WeaponId,
  Zone,
  bulletDrop,
  clamp,
  rayVsEnemy,
  shotDirections,
  shotSeed,
} from '@dead-tracks/shared';
import type { SimEnemy } from '../ai/EnemySystem.ts';
import type { Sim, SimPlayer } from '../Sim.ts';
import { heldGun, heldItem, reserveFor, takeReserve } from './inventory.ts';

type FireCmd = Extract<Command, { t: 'fire' }>;

export interface Projectile {
  id: string;
  kind: WeaponId;
  by: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
}

/** Gore bits (§4.7): which body parts are gone. */
export const GoreBit = { Head: 1, ArmL: 2, ArmR: 4, LegL: 8, LegR: 16 } as const;

/**
 * Weapons (§4.7): validates client shots against lag-compensated enemy positions
 * (§6.8: client reports hits, host checks fire rate, ammo, range and line of sight),
 * melee swings, thrown dynamite and holy water, reloads.
 */
export class Combat {
  readonly projectiles = new Map<string, Projectile>();
  private nextProjectile = 1;
  private readonly positions: Array<[number, number, number]> = [];

  constructor(private readonly sim: Sim) {}

  /** Per-tick weapon timers. */
  tickPlayer(p: SimPlayer, dt: number): void {
    const inv = p.inv;
    inv.cooldown = Math.max(0, inv.cooldown - dt);
    if (inv.reload > 0) {
      inv.reload -= dt;
      if (inv.reload <= 0) {
        inv.reload = 0;
        const gun = heldGun(inv);
        if (!gun) return;
        const slot = inv.selected;
        const mag = magazineFor(p.cls, gun);
        const need = mag - (inv.mags[slot] ?? 0);
        const got = takeReserve(inv, gun, gun.reloadPerRound ? Math.min(1, need) : need);
        inv.mags[slot] = (inv.mags[slot] ?? 0) + got;
        if (
          gun.reloadPerRound &&
          (inv.mags[slot] ?? 0) < mag &&
          reserveFor(inv, gun) > 0
        ) {
          inv.reload = reloadTimeFor(p.cls, gun);
        }
      }
    }
  }

  reload(p: SimPlayer): void {
    const inv = p.inv;
    const gun = heldGun(inv);
    if (!gun || inv.reload > 0 || p.life !== 0) return;
    if ((inv.mags[inv.selected] ?? 0) >= magazineFor(p.cls, gun) || reserveFor(inv, gun) <= 0) return;
    inv.reload = reloadTimeFor(p.cls, gun);
  }

  equip(p: SimPlayer, slot: number): void {
    if (slot < 0 || slot >= p.inv.slots.length || p.inv.selected === slot) return;
    p.inv.selected = slot;
    p.inv.reload = 0;
    p.inv.cooldown = Math.max(p.inv.cooldown, 0.3);
  }

  fire(p: SimPlayer, cmd: FireCmd): void {
    const sim = this.sim;
    if (p.life !== 0 || p.motor.driving || p.carry) return;
    const inv = p.inv;
    const gun = heldGun(inv);
    if (!gun) return;
    const slot = inv.selected;
    // Small tolerance for network timing on the fire rate.
    if (inv.cooldown > 0.08 || (inv.mags[slot] ?? 0) <= 0) return;
    inv.mags[slot] = (inv.mags[slot] ?? 0) - 1;
    inv.cooldown = gun.fireInterval;
    inv.reload = 0;

    let dx = Number(cmd.dx) || 0;
    let dy = Number(cmd.dy) || 0;
    let dz = Number(cmd.dz) || 0;
    const dl = Math.hypot(dx, dy, dz);
    if (dl < 1e-6) return;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    // Trust the claimed eye position only if it is close to where we think the player is.
    let ox = Number(cmd.ox);
    let oy = Number(cmd.oy);
    let oz = Number(cmd.oz);
    const ex = p.wx;
    const ey = p.wy + PLAYER.eyeHeight;
    const ez = p.wz;
    const slack = 3 + Math.abs(sim.train.speed) * 0.4;
    if (!Number.isFinite(ox + oy + oz) || Math.hypot(ox - ex, oy - ey, oz - ez) > slack) {
      ox = ex;
      oy = ey;
      oz = ez;
    }
    sim.enemySystem.makeNoise(ox, oz, gun.noise);
    sim.events.push({ ev: { e: 'shot', by: p.id, w: gun.id, ox, oy, oz, dx, dy, dz } });

    const dirs = shotDirections(
      dx,
      dy,
      dz,
      cmd.aim ? gun.aimSpread : hipSpreadFor(p.cls, gun),
      gun.pellets,
      shotSeed(cmd.seq),
    );
    const seen = new Set<string>();
    const hits = Array.isArray(cmd.hits) ? cmd.hits.slice(0, gun.pellets) : [];
    // Pellets that hit the same enemy add up.
    const damageBy = new Map<
      SimEnemy,
      { dmg: number; zone: number; x: number; y: number; z: number }
    >();
    for (const claim of hits) {
      const key = `${claim.e}:${claim.p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const e = sim.enemySystem.enemies.get(String(claim.e));
      const d = dirs[claim.p | 0];
      if (!e || e.state === 'dead' || !d) continue;
      const result = this.checkHit(e, ox, oy, oz, d, gun, p.viewDelay);
      if (!result) continue;
      const falloff = gun.pellets > 1 ? clamp(1.25 - result.t / gun.range, 0.35, 1) : 1;
      const mult =
        result.zone === Zone.Head
          ? HEADSHOT_MULTIPLIER * (p.cls === 'gunslinger' ? PERKS.gunslingerHeadshot : 1)
          : result.zone === Zone.Limb
            ? LIMB_MULTIPLIER
            : 1;
      const acc = damageBy.get(e) ?? { dmg: 0, zone: result.zone, x: 0, y: 0, z: 0 };
      acc.dmg += gun.damage * mult * falloff;
      if (result.zone === Zone.Head) acc.zone = Zone.Head;
      acc.x = ox + d[0] * result.t;
      acc.y = oy + d[1] * result.t;
      acc.z = oz + d[2] * result.t;
      damageBy.set(e, acc);
    }
    for (const [e, h] of damageBy) this.damageEnemy(e, h.dmg, h.zone, p.id, h.x, h.y, h.z);
  }

  /** Re-checks a claimed hit against where the enemy was when the shooter saw it. */
  private checkHit(
    e: SimEnemy,
    ox: number,
    oy: number,
    oz: number,
    d: [number, number, number],
    gun: GunDef,
    viewDelay: number,
  ): { t: number; zone: number } | null {
    const sim = this.sim;
    const vd = clamp(viewDelay, 0, 0.5);
    sim.enemySystem.positionsBetween(
      e,
      sim.time - vd - 0.2,
      sim.time,
      this.positions,
      sim.time - vd,
    );
    let best: { t: number; zone: number } | null = null;
    // Try positions nearest the moment the shooter saw first; take the first that hits.
    for (const [x, y, z] of this.positions) {
      const dist = Math.hypot(x - ox, z - oz);
      const drop = bulletDrop(gun.drop, gun.speed, dist);
      const h = rayVsEnemy(e.type, x, y + drop, z, ox, oy, oz, d[0], d[1], d[2], gun.range);
      if (h) {
        best = h;
        break;
      }
    }
    if (!best) return null;
    // Line of sight through terrain and props (§6.8).
    const blocked = sim.space.rayGround(ox, oy, oz, d[0], d[1], d[2], best.t - 0.4);
    if (blocked && !sim.space.isTrainCollider(blocked.collider)) return null;
    return best;
  }

  damageEnemy(
    e: SimEnemy,
    dmg: number,
    zone: number,
    by: string,
    x: number,
    y: number,
    z: number,
  ): void {
    const sim = this.sim;
    if (e.state === 'dead') return;
    // Preachers hit the night's hunters harder (§4.11).
    if (
      (e.type === 'werewolf' || e.type === 'vampire' || e.type === 'countess') &&
      sim.players.get(by)?.cls === 'preacher'
    )
      dmg *= PERKS.preacherHoly;
    e.hp -= dmg;
    // Gore (§4.7): heads pop on lethal headshots, strong hits take limbs.
    if (zone === Zone.Head && e.hp <= 0) e.gore |= GoreBit.Head;
    else if (zone === Zone.Limb && dmg >= 40) {
      const bits = [GoreBit.ArmL, GoreBit.ArmR, GoreBit.LegL, GoreBit.LegR];
      e.gore |= bits[Math.floor(sim.rng.next() * bits.length)] as number;
    }
    const kill = e.hp <= 0;
    sim.events.push({ ev: { e: 'hit', id: e.id, by, zone, x, y, z, kill, dmg: Math.round(dmg) } });
    if (kill) sim.killEnemy(e, by, zone, false);
    else if (by && e.state !== 'chase' && e.state !== 'attack') {
      // Getting shot makes them come for you.
      e.state = 'chase';
      e.target = by;
    }
  }

  melee(p: SimPlayer, dirX: number, dirZ: number): void {
    const sim = this.sim;
    if (p.life !== 0 || p.motor.driving || p.carry) return;
    const w = WEAPONS[heldItem(p.inv) as WeaponId];
    if (!w || w.kind !== 'melee' || p.inv.cooldown > 0.05) return;
    const def = w as MeleeDef;
    if (p.motor.stamina < def.stamina * 0.5) return;
    p.inv.cooldown = def.interval;
    p.motor.stamina = Math.max(0, p.motor.stamina - def.stamina);
    let fx = Number(dirX) || 0;
    let fz = Number(dirZ) || 0;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    sim.events.push({ ev: { e: 'swing', by: p.id, w: def.id } });
    // Melee breaks boarded windows and doors (§4.8).
    sim.items.breakBoardsNear(p.wx + fx * 1.2, p.wy + 1.3, p.wz + fz * 1.2, 0.9);
    const cosArc = Math.cos(def.arc);
    for (const e of sim.enemySystem.enemies.values()) {
      if (e.state === 'dead') continue;
      const dx = e.wx - p.wx;
      const dz = e.wz - p.wz;
      const d = Math.hypot(dx, dz);
      if (d > def.range + 0.4 * ENEMIES[e.type].scale || Math.abs(e.wy - p.wy) > 1.6) continue;
      if (d > 0.3 && (dx * fx + dz * fz) / d < cosArc) continue;
      this.damageEnemy(e, def.damage, Zone.Body, p.id, e.wx, e.wy + 1.2, e.wz);
    }
  }

  throw(p: SimPlayer, dx: number, dy: number, dz: number): void {
    const sim = this.sim;
    if (p.life !== 0 || p.motor.driving || p.carry) return;
    const item = heldItem(p.inv) as WeaponId;
    const w = WEAPONS[item];
    if (!w || w.kind !== 'throw' || p.inv.cooldown > 0.05) return;
    const count = item === 'dynamite' ? p.inv.dynamite : p.inv.holywater;
    if (count <= 0) return;
    if (item === 'dynamite') p.inv.dynamite--;
    else p.inv.holywater--;
    p.inv.cooldown = 0.8;
    let x = Number(dx) || 0;
    let y = Number(dy) || 0;
    let z = Number(dz) || 0;
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    const def = w as ThrowDef;
    // Inherit the train's motion when thrown from it.
    let bx = 0;
    let bz = 0;
    if (p.motor.frame === Frame.Train) {
      const pose = sim.poses[0]!;
      bx = -pose.bx * sim.train.speed;
      bz = -pose.bz * sim.train.speed;
    }
    const id = `p${this.nextProjectile++}`;
    this.projectiles.set(id, {
      id,
      kind: item,
      by: p.id,
      x: p.wx + x * 0.6,
      y: p.wy + 1.5,
      z: p.wz + z * 0.6,
      vx: x * def.throwSpeed + bx,
      vy: (y + 0.25) * def.throwSpeed,
      vz: z * def.throwSpeed + bz,
      fuse: def.fuse > 0 ? def.fuse : 10,
    });
    // Out of that throwable: clear the slot.
    if ((item === 'dynamite' ? p.inv.dynamite : p.inv.holywater) <= 0) {
      p.inv.slots[p.inv.selected] = '';
    }
  }

  stepProjectiles(dt: number): void {
    const sim = this.sim;
    for (const pr of this.projectiles.values()) {
      pr.fuse -= dt;
      pr.vy -= 9.81 * dt;
      const sx = pr.vx * dt;
      const sy = pr.vy * dt;
      const sz = pr.vz * dt;
      const len = Math.hypot(sx, sy, sz);
      let impact = false;
      if (len > 1e-6) {
        const hit = sim.space.rayGround(pr.x, pr.y, pr.z, sx / len, sy / len, sz / len, len + 0.05);
        if (hit) {
          impact = true;
          pr.x += (sx / len) * Math.max(0, hit.toi - 0.05);
          pr.y += (sy / len) * Math.max(0, hit.toi - 0.05);
          pr.z += (sz / len) * Math.max(0, hit.toi - 0.05);
          pr.vy = Math.abs(pr.vy) * 0.3;
          pr.vx *= 0.5;
          pr.vz *= 0.5;
        } else {
          pr.x += sx;
          pr.y += sy;
          pr.z += sz;
        }
      }
      const ground = sim.terrain.height(pr.x, pr.z);
      if (pr.y < ground + 0.05) {
        pr.y = ground + 0.05;
        impact = true;
        pr.vy = Math.abs(pr.vy) * 0.25;
        pr.vx *= 0.6;
        pr.vz *= 0.6;
      }
      const def = WEAPONS[pr.kind] as ThrowDef;
      if (pr.fuse <= 0 || (def.fuse === 0 && impact)) {
        this.explode(pr, def);
        this.projectiles.delete(pr.id);
      }
    }
  }

  private explode(pr: Projectile, def: ThrowDef): void {
    const sim = this.sim;
    const holy = pr.kind === 'holywater';
    sim.events.push({ ev: { e: 'explode', x: pr.x, y: pr.y, z: pr.z, r: def.radius, holy } });
    if (!holy) sim.items.breakBoardsNear(pr.x, pr.y, pr.z, def.radius * 0.6);
    sim.enemySystem.makeNoise(pr.x, pr.z, def.noise);
    for (const e of sim.enemySystem.enemies.values()) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.wx - pr.x, e.wy + 1 - pr.y, e.wz - pr.z);
      if (d > def.radius) continue;
      const bonus =
        e.type === 'werewolf' || e.type === 'vampire' || e.type === 'countess' ? def.holyBonus : 1;
      const dmg = def.damage * Math.sqrt(1 - d / def.radius) * bonus;
      this.damageEnemy(
        e,
        dmg,
        d < def.radius * 0.35 ? Zone.Limb : Zone.Body,
        pr.by,
        e.wx,
        e.wy + 1,
        e.wz,
      );
    }
    if (!holy) {
      for (const p of sim.players.values()) {
        if (p.life !== 0) continue;
        const d = Math.hypot(p.wx - pr.x, p.wy + 1 - pr.y, p.wz - pr.z);
        if (d < def.radius)
          sim.damagePlayer(p, def.damage * 0.4 * (1 - d / def.radius), pr.x, pr.z, 'explosion');
      }
    }
  }
}

export { ENEMY_TYPES };
