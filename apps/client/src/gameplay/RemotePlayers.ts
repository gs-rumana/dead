import * as THREE from 'three/webgpu';
import {
  type CarPose,
  Frame,
  PlayerFlag,
  type RunState,
  lerpAngle,
  trainToWorld,
  trainYawAt,
} from '@dead-tracks/shared';
import { paletteSkinnedMaterial } from '../render/materials.ts';
import { type Humanoid, OUTFITS, createHumanoid } from '../render/models/humanoid.ts';

interface Snapshot {
  t: number;
  frame: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  mantle: number;
}

interface Remote {
  id: string;
  body: Humanoid;
  buf: Snapshot[];
  lastX: number;
  lastZ: number;
  speed: number;
}

/** Interpolation delay for other players (§6.8: ~100 ms buffer). */
export const INTERP_DELAY = 100;

/**
 * Renders other players with snapshot interpolation. Positions on the train are
 * interpolated in train space and then placed on the smoothed train, so riders
 * never jitter relative to the car they stand on.
 */
export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();
  private outfitIndex = 1;
  private readonly w = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly selfId: string,
  ) {}

  /** Record the latest state after every patch. */
  sample(state: RunState, now: number): void {
    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      if (id === this.selfId) return;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        const outfit = OUTFITS[this.outfitIndex++ % OUTFITS.length]!;
        const body = createHumanoid(outfit, paletteSkinnedMaterial());
        body.mesh.castShadow = true;
        this.scene.add(body.mesh);
        r = { id, body, buf: [], lastX: 0, lastZ: 0, speed: 0 };
        this.remotes.set(id, r);
      }
      r.buf.push({
        t: now,
        frame: p.frame,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        flags: p.flags,
        mantle: p.mantle,
      });
      if (r.buf.length > 30) r.buf.shift();
    });
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(r.body.mesh);
        this.remotes.delete(id);
      }
    }
  }

  update(dt: number, now: number, poses: CarPose[], ox: number, oz: number): void {
    const t = now - INTERP_DELAY;
    for (const r of this.remotes.values()) {
      const buf = r.buf;
      if (buf.length === 0) continue;
      let a = buf[0] as Snapshot;
      let b = a;
      for (let i = 1; i < buf.length; i++) {
        const s = buf[i] as Snapshot;
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
      const mesh = r.body.mesh;
      mesh.position.set(wx - ox, wy, wz - oz);
      mesh.rotation.set(0, yaw, 0);
      // Speed relative to the frame drives the gait.
      const sp = dt > 0 ? Math.hypot(x - r.lastX, z - r.lastZ) / dt : 0;
      r.speed += (Math.min(sp, 9) - r.speed) * Math.min(1, dt * 10);
      r.lastX = x;
      r.lastZ = z;
      r.body.animate(dt, {
        speed: r.speed,
        grounded: (src.flags & PlayerFlag.Grounded) !== 0,
        pitch: src.pitch,
        driving: (src.flags & PlayerFlag.Driving) !== 0,
        mantling: src.mantle > 0,
        sprinting: (src.flags & PlayerFlag.Sprinting) !== 0,
      });
    }
  }

  get count(): number {
    return this.remotes.size;
  }

  dispose(): void {
    for (const r of this.remotes.values()) this.scene.remove(r.body.mesh);
    this.remotes.clear();
  }
}
