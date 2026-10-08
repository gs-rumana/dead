import * as THREE from 'three/webgpu';
import { type Piece, type Structure, type World, doorPose } from '@dead-tracks/shared';
import { MeshBuilder } from '../render/builder.ts';
import { glowMaterial, paletteMaterial, paletteSkinnedMaterial } from '../render/materials.ts';
import { type Humanoid, OUTFITS, type Outfit, createHumanoid } from '../render/models/humanoid.ts';
import type { Swatch } from '../render/palette.ts';

interface Built {
  st: Structure;
  group: THREE.Group;
  doors: Map<number, { mesh: THREE.Mesh; open: number; target: number }>;
  boards: Map<number, THREE.Mesh>;
  keeper: Humanoid | null;
  lamps: THREE.Mesh[];
}

const KEEPER: Outfit = { ...OUTFITS[2]!, vest: 'shirtRed', hat: undefined };

/**
 * Draws buildings near the camera (§4.4, §4.8). Static pieces of a structure merge
 * into one mesh; doors and boards are separate so they can swing or break.
 */
export class StructureView {
  private readonly built = new Map<string, Built>();
  private readonly glow = glowMaterial(0xffd27a);

  constructor(
    private readonly worldRoot: THREE.Group,
    private readonly world: World,
  ) {}

  update(
    dt: number,
    camX: number,
    camZ: number,
    range: number,
    props: (key: string) => number,
    night: number,
  ): void {
    const want = new Set<string>();
    for (const st of this.world.structuresNear(camX, camZ, range)) {
      want.add(st.id);
      if (!this.built.has(st.id)) this.built.set(st.id, this.build(st));
    }
    for (const [id, b] of this.built) {
      if (!want.has(id)) {
        this.worldRoot.remove(b.group);
        b.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry && !(m as THREE.SkinnedMesh).isSkinnedMesh)
            m.geometry.dispose();
        });
        this.built.delete(id);
        continue;
      }
      // Doors swing toward their synced state; broken boards disappear.
      for (const [pid, d] of b.doors) {
        d.target = props(`${id}:${pid}`) ? 1 : 0;
        if (d.open !== d.target) {
          d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 4);
          this.placeDoor(b.st, b.st.pieces[pid]!, d.mesh, d.open);
        }
      }
      for (const [pid, mesh] of b.boards) mesh.visible = !props(`${id}:${pid}`);
      b.keeper?.animate(dt, {
        speed: 0,
        grounded: true,
        pitch: 0,
        driving: false,
        mantling: false,
        sprinting: false,
      });
      for (const l of b.lamps) l.visible = night > 0.2;
    }
    void this.glow;
  }

  private placeDoor(st: Structure, p: Piece, mesh: THREE.Mesh, t: number): void {
    const w = doorPose(st, p, t);
    // Door meshes are children of the structure group: convert back to local.
    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    const dx = w.x - st.x;
    const dz = w.z - st.z;
    mesh.position.set(c * dx - s * dz, w.y - st.y, s * dx + c * dz);
    mesh.rotation.set(0, w.yaw - st.yaw, 0);
  }

  private build(st: Structure): Built {
    const group = new THREE.Group();
    group.position.set(st.x, st.y, st.z);
    group.rotation.y = st.yaw;
    const b = new MeshBuilder();
    const doors = new Map<number, { mesh: THREE.Mesh; open: number; target: number }>();
    const boards = new Map<number, THREE.Mesh>();
    const lamps: THREE.Mesh[] = [];
    const mat = paletteMaterial();
    for (const p of st.pieces) {
      const sw = (p.swatch ?? 'wood') as Swatch;
      switch (p.kind) {
        case 'door': {
          const db = new MeshBuilder();
          db.box(sw, 0, 0, 0, p.hx * 2, p.hy * 2, p.hz * 2);
          db.box('brass', p.hx * 0.7, 0, p.hz + 0.02, 0.06, 0.06, 0.04);
          for (const y of [-0.6, 0.6])
            db.box('woodGrayDark', 0, y * p.hy, p.hz + 0.005, p.hx * 1.9, 0.08, 0.01);
          const mesh = new THREE.Mesh(db.build(), mat);
          mesh.castShadow = true;
          this.placeDoor(st, p, mesh, 0);
          group.add(mesh);
          doors.set(p.id, { mesh, open: 0, target: 0 });
          break;
        }
        case 'board': {
          const bb = new MeshBuilder();
          for (let i = 0; i < 3; i++)
            bb.box(sw, 0, (i - 1) * p.hy * 0.62, 0, p.hx * 2.3, 0.14, 0.04, { rz: (i - 1) * 0.12 });
          const mesh = new THREE.Mesh(bb.build(), mat);
          mesh.position.set(p.x, p.y, p.z);
          mesh.rotation.y = p.ry;
          group.add(mesh);
          boards.set(p.id, mesh);
          break;
        }
        case 'gable': {
          b.push(p.x, p.y, p.z, { ry: p.ry });
          b.prism(
            sw,
            [
              [-p.hx, -p.hy],
              [p.hx, -p.hy],
              [0, p.hy],
            ],
            p.hz * 2,
          );
          b.pop();
          break;
        }
        case 'fire': {
          // Ring of stones, logs and a glowing heart.
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            b.blob(
              'rock',
              p.x + Math.cos(a) * 0.55,
              0.1,
              p.z + Math.sin(a) * 0.55,
              0.16,
              0.12,
              0.14,
            );
          }
          b.box('woodDark', p.x, 0.12, p.z, 0.9, 0.12, 0.14, { ry: 0.6 });
          b.box('woodDark', p.x, 0.16, p.z, 0.9, 0.12, 0.14, { ry: -0.6 });
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 6), glowMaterial(0xff9a3a));
          flame.position.set(p.x, 0.4, p.z);
          group.add(flame);
          lamps.push(flame);
          break;
        }
        case 'tent':
          b.push(p.x, 0, p.z, { ry: p.ry });
          b.prism(
            sw,
            [
              [-p.hx, 0],
              [p.hx, 0],
              [0, p.hy * 2],
            ],
            p.hz * 2,
          );
          b.box('woodDark', 0, p.hy, -p.hz, 0.05, p.hy * 2, 0.05);
          b.pop();
          break;
        case 'tank':
          b.cylinder(sw, p.x, p.y, p.z, p.hx, p.hx, p.hy * 2, 12);
          b.cylinder('iron', p.x, p.y + p.hy * 0.6, p.z, p.hx + 0.03, p.hx + 0.03, 0.06, 12);
          b.cylinder('iron', p.x, p.y - p.hy * 0.6, p.z, p.hx + 0.03, p.hx + 0.03, 0.06, 12);
          b.cone('woodGrayDark', p.x, p.y + p.hy + 0.4, p.z, p.hx + 0.1, 0.8, 12);
          break;
        case 'ladder':
          b.push(p.x, p.y, p.z, { ry: p.ry });
          for (const z of [-p.hz, p.hz]) b.box('iron', 0, 0, z, 0.05, p.hy * 2, 0.05);
          for (let y = -p.hy + 0.25; y < p.hy; y += 0.35)
            b.box('iron', 0, y, 0, 0.04, 0.04, p.hz * 2);
          b.pop();
          break;
        case 'lamp': {
          b.box('iron', p.x, p.y, p.z, 0.08, p.hy * 2, 0.08);
          b.box('iron', p.x, p.y + p.hy - 0.05, p.z, 0.22, 0.25, 0.22);
          const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.16), this.glow);
          glow.position.set(p.x, p.y + p.hy - 0.05, p.z);
          group.add(glow);
          lamps.push(glow);
          break;
        }
        case 'wagon':
          b.box('wood', p.x, p.y - 0.2, p.z, p.hx * 2, 0.5, p.hz * 2);
          b.push(p.x, p.y + 0.4, p.z);
          b.cylinder(
            'shirt',
            0,
            0,
            0,
            p.hx * 1.05,
            p.hx * 1.05,
            p.hz * 2,
            10,
            { rx: Math.PI / 2 },
            true,
          );
          b.pop();
          for (const [dz, r] of [
            [-p.hz * 0.7, 0.5],
            [p.hz * 0.7, 0.55],
          ] as const) {
            for (const sx of [-1, 1])
              b.cylinder('woodDark', p.x + sx * (p.hx + 0.06), 0.5, p.z + dz, r, r, 0.08, 10, {
                rz: Math.PI / 2,
              });
          }
          b.box('signRed', p.x - p.hx - 0.01, p.y + 0.1, p.z, 0.02, 0.4, 1.2);
          break;
        case 'sign':
          b.box('woodDark', p.x, p.y - 0.9, p.z - p.hz + 0.1, 0.08, 1.4, 0.08);
          b.box('woodDark', p.x, p.y - 0.9, p.z + p.hz - 0.1, 0.08, 1.4, 0.08);
          b.box(sw, p.x, p.y, p.z, p.hx * 2, p.hy * 2, p.hz * 2);
          b.box('black', p.x - p.hx - 0.005, p.y, p.z, 0.01, p.hy * 1.1, p.hz * 1.6);
          break;
        case 'well':
          b.cylinder(sw, p.x, p.y, p.z, p.hx, p.hx, p.hy * 2, 10);
          b.cylinder('black', p.x, p.y + p.hy + 0.01, p.z, p.hx * 0.75, p.hx * 0.75, 0.02, 10);
          for (const sx of [-1, 1])
            b.box('woodDark', p.x + sx * p.hx * 0.9, p.y + 0.9, p.z, 0.08, 1.4, 0.08);
          b.box('woodDark', p.x, p.y + 1.55, p.z, p.hx * 2.1, 0.08, 0.1);
          break;
        case 'stove':
          b.box('iron', p.x, p.y, p.z, p.hx * 2, p.hy * 2, p.hz * 2);
          b.cylinder('iron', p.x, p.y + p.hy + 1.0, p.z, 0.08, 0.08, 2.0, 6);
          break;
        case 'drawer':
          b.box(sw, p.x, p.y, p.z, p.hx * 2, p.hy * 2, p.hz * 2);
          for (const y of [-0.5, 0, 0.5])
            b.box('brass', p.x - p.hx - 0.01, p.y + y * p.hy, p.z, 0.02, 0.04, 0.12);
          break;
        case 'safe':
          b.box(sw, p.x, p.y, p.z, p.hx * 2, p.hy * 2, p.hz * 2);
          b.cylinder('brass', p.x - p.hx - 0.01, p.y, p.z, 0.08, 0.08, 0.03, 8, {
            rz: Math.PI / 2,
          });
          break;
        case 'shelf':
          b.box(sw, p.x + p.hx * 0.8, p.y, p.z, p.hx * 0.4, p.hy * 2, p.hz * 2);
          for (let y = -p.hy + 0.1; y < p.hy; y += 0.5)
            b.box(sw, p.x, p.y + y, p.z, p.hx * 2, 0.04, p.hz * 2);
          for (let i = 0; i < 6; i++)
            b.box(
              i % 2 ? 'copper' : 'glass',
              p.x - p.hx * 0.2,
              p.y - p.hy + 0.3 + Math.floor(i / 2) * 0.5,
              p.z - p.hz * 0.6 + (i % 3) * p.hz * 0.6,
              0.12,
              0.2,
              0.12,
            );
          break;
        default:
          b.push(p.x, p.y, p.z, { ry: p.ry });
          b.box(sw, 0, 0, 0, p.hx * 2, p.hy * 2, p.hz * 2);
          if (p.kind === 'platform')
            b.box('woodGrayDark', 0, p.hy - 0.01, -p.hz + 0.08, p.hx * 2, 0.02, 0.06);
          b.pop();
      }
    }
    if (b.partCount > 0) {
      const mesh = new THREE.Mesh(b.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    let keeper: Humanoid | null = null;
    if (st.shop) {
      const c = st.pieces[st.shop.piece]!;
      keeper = createHumanoid(KEEPER, paletteSkinnedMaterial());
      // Behind the counter (or beside the wagon), facing the customers.
      if (st.kind === 'wagon') keeper.mesh.position.set(c.x - c.hx - 0.8, 0, c.z + 1.2);
      else keeper.mesh.position.set(c.x + 0.9, c.y - c.hy, c.z);
      keeper.mesh.rotation.y = Math.PI / 2;
      group.add(keeper.mesh);
    }
    this.worldRoot.add(group);
    return { st, group, doors, boards, keeper, lamps };
  }

  get count(): number {
    return this.built.size;
  }
}
