import * as THREE from 'three/webgpu';
import {
  Anim,
  type CarPose,
  ENEMIES,
  ENEMY_TYPES,
  type EnemyType,
  Frame,
  type RunState,
  type Terrain,
  lerpAngle,
  trainToWorld,
  trainYawAt,
} from '@dead-tracks/shared';
import { OUTLAW_OUTFIT, ZOMBIE_OUTFITS } from '../render/models/humanoid.ts';
import { type ClipName, type VatAsset, bakeVat } from '../render/vat.ts';
import { type VatInstances, createVatInstances } from '../render/vatMaterial.ts';
import { INTERP_DELAY } from './RemotePlayers.ts';

interface Snap {
  t: number;
  frame: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  gore: number;
}

interface Rendered {
  id: string;
  type: EnemyType;
  buf: Snap[];
  clip: ClipName;
  clipT: number;
  phase: number;
  flash: number;
  lastX: number;
  lastZ: number;
  speed: number;
  /** World position and yaw as rendered this frame (for hit tests). */
  wx: number;
  wy: number;
  wz: number;
  yaw: number;
  gore: number;
  dead: boolean;
  seen: number;
}

const ANIM_CLIP: Record<number, ClipName> = {
  [Anim.Idle]: 'idle',
  [Anim.Walk]: 'walk',
  [Anim.Run]: 'run',
  [Anim.Attack]: 'attack',
  [Anim.Hit]: 'walk',
  [Anim.Dead]: 'dead',
  [Anim.Climb]: 'climb',
  [Anim.Crouch]: 'crouch',
};

/** Which baked body each enemy type uses until its own art lands. */
type Body = 'walker' | 'runner' | 'brute' | 'outlaw';

const BODY: Record<EnemyType, Body> = {
  walker: 'walker',
  runner: 'runner',
  brute: 'brute',
  outlaw: 'outlaw',
  werewolf: 'runner',
  vampire: 'runner',
};

/**
 * Renders the visible enemies (§6.9 hordes) with snapshot interpolation, driving
 * the VAT instances: one draw call per body type for the whole horde.
 */
export class EnemyView {
  private readonly enemies = new Map<string, Rendered>();
  private readonly bodies = new Map<Body, { asset: VatAsset; inst: VatInstances }>();
  private readonly w = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    for (const body of ['walker', 'runner', 'brute', 'outlaw'] as const) {
      const asset =
        body === 'outlaw'
          ? bakeVat(OUTLAW_OUTFIT, 'human', 'rifle')
          : bakeVat(ZOMBIE_OUTFITS[body]);
      const inst = createVatInstances(asset, body === 'outlaw' ? 24 : 96);
      scene.add(inst.mesh);
      this.bodies.set(body, { asset, inst });
    }
  }

  sample(state: RunState, now: number): void {
    state.enemies.forEach((e, id) => {
      let r = this.enemies.get(id);
      if (!r) {
        r = {
          id,
          type: (ENEMY_TYPES[e.type] ?? 'walker') as EnemyType,
          buf: [],
          clip: 'idle',
          clipT: Math.random() * 2,
          phase: Math.random(),
          flash: 0,
          lastX: e.x,
          lastZ: e.z,
          speed: 0,
          wx: e.x,
          wy: e.y,
          wz: e.z,
          yaw: e.yaw,
          gore: 0,
          dead: false,
          seen: now,
        };
        this.enemies.set(id, r);
      }
      const last = r.buf[r.buf.length - 1];
      // Skip duplicate samples when this enemy didn't change (LOD).
      if (
        last &&
        last.x === e.x &&
        last.z === e.z &&
        last.y === e.y &&
        last.anim === e.anim &&
        last.gore === e.gore &&
        last.yaw === e.yaw
      ) {
        r.seen = now;
        return;
      }
      // Ground enemies: height from the terrain (the host doesn't send it).
      const y = e.frame === Frame.World ? this.terrain.height(e.x, e.z) : e.y;
      r.buf.push({
        t: now,
        frame: e.frame,
        x: e.x,
        y,
        z: e.z,
        yaw: e.yaw,
        anim: e.anim,
        gore: e.gore,
      });
      if (r.buf.length > 24) r.buf.shift();
      r.seen = now;
    });
    for (const [id] of this.enemies) if (!state.enemies.has(id)) this.enemies.delete(id);
  }

  /** Flash an enemy that was just hit. */
  flash(id: string): void {
    const r = this.enemies.get(id);
    if (r) r.flash = 1;
  }

  /** Rendered world positions (for client-side hit tests: you hit what you see). */
  forEach(
    cb: (id: string, type: EnemyType, x: number, y: number, z: number, dead: boolean) => void,
  ): void {
    for (const r of this.enemies.values()) cb(r.id, r.type, r.wx, r.wy, r.wz, r.dead);
  }

  get count(): number {
    return this.enemies.size;
  }

  update(dt: number, now: number, poses: CarPose[], ox: number, oz: number, night: number): void {
    const t = now - INTERP_DELAY;
    const counts = new Map<Body, number>();
    for (const r of this.enemies.values()) {
      const buf = r.buf;
      if (buf.length === 0) continue;
      let a = buf[0] as Snap;
      let b = a;
      for (let i = 1; i < buf.length; i++) {
        const s = buf[i] as Snap;
        if (s.t <= t) a = s;
        if (s.t >= t) {
          b = s;
          break;
        }
        b = s;
      }
      const span = b.t - a.t;
      const k = span > 0 && a.frame === b.frame ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
      const src = k >= 1 ? b : a;
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k;
      const z = a.z + (b.z - a.z) * k;
      let yaw = lerpAngle(a.yaw, b.yaw, k);
      let wx = x;
      let wy = y;
      let wz = z;
      if (src.frame === Frame.Train) {
        trainToWorld(poses, x, y, z, this.w);
        wx = this.w.x;
        wy = this.w.y;
        wz = this.w.z;
        yaw += trainYawAt(poses, z);
      }
      r.wx = wx;
      r.wy = wy;
      r.wz = wz;
      r.yaw = yaw;
      r.gore = src.gore;

      // Animation: one-shot clips restart on change; gaits follow the ground speed.
      const sp = dt > 0 ? Math.hypot(x - r.lastX, z - r.lastZ) / dt : 0;
      r.speed += (Math.min(sp, 12) - r.speed) * Math.min(1, dt * 8);
      r.lastX = x;
      r.lastZ = z;
      const clip = ANIM_CLIP[src.anim] ?? 'idle';
      if (clip !== r.clip) {
        r.clip = clip;
        r.clipT = 0;
      }
      r.dead = clip === 'dead';
      r.clipT += dt;
      if (clip === 'walk') r.phase += (r.speed * dt) / 1.25;
      else if (clip === 'run') r.phase += (r.speed * dt) / 2.4;
      r.flash = Math.max(0, r.flash - dt * 6);

      const body = this.bodies.get(BODY[r.type]);
      if (!body) continue;
      const i = counts.get(BODY[r.type]) ?? 0;
      if (i >= body.inst.capacity) continue;
      counts.set(BODY[r.type], i + 1);
      const c = body.asset.clips[clip];
      let f: number;
      if (clip === 'walk' || clip === 'run') f = (((r.phase % 1) + 1) % 1) * c.frames;
      else if (c.loop) f = (r.clipT * c.fps) % c.frames;
      else f = Math.min(r.clipT * c.fps, c.frames - 1);
      const fa = Math.floor(f);
      const fb = c.loop ? (fa + 1) % c.frames : Math.min(fa + 1, c.frames - 1);
      const inst = body.inst;
      inst.posYaw.setXYZW(i, wx - ox, wy, wz - oz, yaw);
      inst.anim.setXYZW(i, c.start + fa, c.start + fb, f - fa, ENEMIES[r.type].scale);
      inst.fx.setXYZW(i, r.gore, r.flash, 1 - night * 0.25, 0);
    }
    for (const [name, body] of this.bodies) {
      const n = counts.get(name) ?? 0;
      body.inst.mesh.count = n;
      body.inst.posYaw.needsUpdate = true;
      body.inst.anim.needsUpdate = true;
      body.inst.fx.needsUpdate = true;
      body.inst.mesh.visible = n > 0;
    }
  }

  dispose(): void {
    for (const b of this.bodies.values()) this.scene.remove(b.inst.mesh);
  }
}

export { THREE };
