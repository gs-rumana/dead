import * as THREE from 'three/webgpu';
import {
  type CarPose,
  ENEMY_TYPES,
  Frame,
  type HandcarPose,
  ITEMS,
  type ItemKind,
  type RunState,
  handcarToWorld,
  trainToWorld,
  trainYawAt,
} from '@dead-tracks/shared';
import { paletteMaterial } from '../render/materials.ts';
import { ZOMBIE_OUTFITS } from '../render/models/humanoid.ts';
import { itemGeometry } from '../render/models/items.ts';
import { bakeVat } from '../render/vat.ts';
import { type VatInstances, createVatInstances } from '../render/vatMaterial.ts';

export interface HolderPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Tracked {
  id: string;
  kind: ItemKind;
  /** Smoothed render position (world). */
  wx: number;
  wy: number;
  wz: number;
  yaw: number;
  init: boolean;
}

/**
 * Items in the world, on the train and in people's arms (§4.8). One InstancedMesh
 * per kind; bodies reuse the horde's baked animation in their final "dead" pose.
 */
export class ItemView {
  private readonly meshes = new Map<ItemKind, THREE.InstancedMesh>();
  private readonly bodies = new Map<string, VatInstances>();
  private readonly tracked = new Map<string, Tracked>();
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly p = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    for (const body of ['walker', 'runner', 'brute'] as const) {
      const inst = createVatInstances(bakeVat(ZOMBIE_OUTFITS[body]), 48);
      inst.mesh.castShadow = false;
      scene.add(inst.mesh);
      this.bodies.set(body, inst);
    }
  }

  private mesh(kind: ItemKind): THREE.InstancedMesh {
    let m = this.meshes.get(kind);
    if (!m) {
      const bulky = ITEMS[kind]?.cls === 'bulky';
      m = new THREE.InstancedMesh(itemGeometry(kind), paletteMaterial(), bulky ? 64 : 32);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = bulky;
      m.receiveShadow = true;
      this.scene.add(m);
      this.meshes.set(kind, m);
    }
    return m;
  }

  /** World positions of items as rendered (for client-side targeting). */
  forEach(cb: (id: string, kind: ItemKind, x: number, y: number, z: number) => void): void {
    for (const t of this.tracked.values()) cb(t.id, t.kind, t.wx, t.wy, t.wz);
  }

  position(id: string): { x: number; y: number; z: number } | null {
    const t = this.tracked.get(id);
    return t ? { x: t.wx, y: t.wy, z: t.wz } : null;
  }

  /** Handcar poses for cargo (set by the game). */
  handcarPose: (i: number) => HandcarPose | null = () => null;

  update(
    dt: number,
    state: RunState,
    poses: CarPose[],
    holder: (id: string) => HolderPose | null,
    ox: number,
    oz: number,
  ): void {
    const counts = new Map<ItemKind, number>();
    const bodyCounts = new Map<string, number>();
    const seen = new Set<string>();
    const k = Math.min(1, dt * 15);
    state.items.forEach((it, id) => {
      seen.add(id);
      const kind = it.kind as ItemKind;
      let t = this.tracked.get(id);
      if (!t) {
        t = { id, kind, wx: 0, wy: 0, wz: 0, yaw: 0, init: false };
        this.tracked.set(id, t);
      }
      let tx: number;
      let ty: number;
      let tz: number;
      let yaw = it.yaw;
      let carried = false;
      if (it.holder) {
        const h = holder(it.holder);
        if (!h) return;
        carried = true;
        // Held in both hands in front of the chest.
        tx = h.x - Math.sin(h.yaw) * 0.55;
        ty = h.y + 0.75;
        tz = h.z - Math.cos(h.yaw) * 0.55;
        yaw = h.yaw;
      } else if (it.frame >= Frame.Handcar) {
        const hp = this.handcarPose(it.frame - Frame.Handcar);
        if (!hp) return;
        handcarToWorld(hp, it.x, it.y, it.z, this.tmp);
        tx = this.tmp.x;
        ty = this.tmp.y;
        tz = this.tmp.z;
        yaw += hp.yaw;
      } else if (it.frame === Frame.Train) {
        trainToWorld(poses, it.x, it.y, it.z, this.tmp);
        tx = this.tmp.x;
        ty = this.tmp.y;
        tz = this.tmp.z;
        yaw += trainYawAt(poses, it.z);
      } else {
        tx = it.x;
        ty = it.y;
        tz = it.z;
      }
      // Riding or carried items snap; loose ones ease toward the latest position.
      if (!t.init || carried || it.frame !== Frame.World) {
        t.wx = tx;
        t.wy = ty;
        t.wz = tz;
        t.init = true;
      } else {
        t.wx += (tx - t.wx) * k;
        t.wy += (ty - t.wy) * k;
        t.wz += (tz - t.wz) * k;
      }
      t.yaw = yaw;

      if (kind === 'corpse') {
        const type = ENEMY_TYPES[it.extra] ?? 'walker';
        const body =
          type === 'brute'
            ? 'brute'
            : type === 'runner' || type === 'werewolf' || type === 'vampire'
              ? 'runner'
              : 'walker';
        const inst = this.bodies.get(body);
        if (!inst) return;
        const i = bodyCounts.get(body) ?? 0;
        if (i >= inst.capacity) return;
        bodyCounts.set(body, i + 1);
        const clip = bakeVat(ZOMBIE_OUTFITS[body]).clips.dead;
        const f = clip.start + clip.frames - 1;
        // Carried bodies hang over the arms, a little lower and turned sideways.
        inst.posYaw.setXYZW(
          i,
          t.wx - ox,
          t.wy - (carried ? 0.55 : 0),
          t.wz - oz,
          t.yaw + (carried ? Math.PI / 2 : 0),
        );
        inst.anim.setXYZW(i, f, f, 0, (body === 'brute' ? 1.35 : 1) * (carried ? 0.85 : 1));
        inst.fx.setXYZW(i, 0, 0, it.searched ? 0.7 : 1, 0);
        return;
      }
      const mesh = this.mesh(kind);
      const i = counts.get(kind) ?? 0;
      if (i >= mesh.instanceMatrix.count) return;
      counts.set(kind, i + 1);
      this.e.set(0, t.yaw, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(t.wx - ox, t.wy - (carried ? 0.3 : 0), t.wz - oz), this.q, this.s);
      mesh.setMatrixAt(i, this.m);
    });
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    }
    for (const [body, inst] of this.bodies) {
      const n = bodyCounts.get(body) ?? 0;
      inst.mesh.count = n;
      inst.mesh.visible = n > 0;
      inst.posYaw.needsUpdate = true;
      inst.anim.needsUpdate = true;
      inst.fx.needsUpdate = true;
    }
    for (const id of [...this.tracked.keys()]) if (!seen.has(id)) this.tracked.delete(id);
  }
}
