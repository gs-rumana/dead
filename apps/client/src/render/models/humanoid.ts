import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Swatch, swatchUV } from '../palette.ts';
import { weaponModel } from './weapons.ts';

/**
 * A low-poly humanoid with realistic proportions (§5.1, §5.5) on one shared
 * skeleton. Players, zombies, outlaws and townsfolk all use it with different
 * outfits; movement is animated in code until Quaternius clips land.
 */

export const BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmL',
  'lowerArmL',
  'handL',
  'upperArmR',
  'lowerArmR',
  'handR',
  'upperLegL',
  'lowerLegL',
  'footL',
  'upperLegR',
  'lowerLegR',
  'footR',
] as const;
export type BoneName = (typeof BONES)[number];

/** Bind-pose joint positions (absolute, metres; character faces -Z). */
const JOINTS: Record<BoneName, [number, number, number, BoneName | null]> = {
  hips: [0, 0.95, 0, null],
  spine: [0, 1.06, 0, 'hips'],
  chest: [0, 1.27, 0, 'spine'],
  neck: [0, 1.5, 0, 'chest'],
  head: [0, 1.58, 0, 'neck'],
  upperArmL: [-0.2, 1.45, 0, 'chest'],
  lowerArmL: [-0.23, 1.17, 0, 'upperArmL'],
  handL: [-0.24, 0.92, 0, 'lowerArmL'],
  upperArmR: [0.2, 1.45, 0, 'chest'],
  lowerArmR: [0.23, 1.17, 0, 'upperArmR'],
  handR: [0.24, 0.92, 0, 'lowerArmR'],
  upperLegL: [-0.1, 0.92, 0, 'hips'],
  lowerLegL: [-0.1, 0.5, 0, 'upperLegL'],
  footL: [-0.1, 0.09, 0, 'lowerLegL'],
  upperLegR: [0.1, 0.92, 0, 'hips'],
  lowerLegR: [0.1, 0.5, 0, 'upperLegR'],
  footR: [0.1, 0.09, 0, 'lowerLegR'],
};

export interface Outfit {
  skin: Swatch;
  shirt: Swatch;
  pants: Swatch;
  boots: Swatch;
  vest?: Swatch;
  hat?: Swatch;
  hair?: Swatch;
  bandana?: Swatch;
}

/** Undead outfits (§5.5: the same bodies with rotting skin and torn clothes). */
export const ZOMBIE_OUTFITS: Record<'walker' | 'runner' | 'brute', Outfit> = {
  walker: {
    skin: 'rot1',
    shirt: 'shirt',
    pants: 'denim',
    boots: 'leather',
    vest: 'blood',
    hair: 'hair',
  },
  runner: { skin: 'rot2', shirt: 'shirtRed', pants: 'dusterDark', boots: 'hatDark' },
  brute: {
    skin: 'rot1',
    shirt: 'blood',
    pants: 'duster',
    boots: 'leather',
    vest: 'dusterDark',
    bandana: 'bandana',
  },
};

export const OUTFITS: Outfit[] = [
  {
    skin: 'skin2',
    shirt: 'shirt',
    pants: 'denim',
    boots: 'leather',
    vest: 'dusterDark',
    hat: 'hat',
    hair: 'hair',
  },
  {
    skin: 'skin1',
    shirt: 'shirtRed',
    pants: 'dusterDark',
    boots: 'hatDark',
    hat: 'hatDark',
    hair: 'hair',
    bandana: 'bandana',
  },
  {
    skin: 'skin3',
    shirt: 'shirtBlue',
    pants: 'denim',
    boots: 'leather',
    vest: 'leather',
    hat: 'hat',
    hair: 'hair',
  },
  {
    skin: 'skin4',
    shirt: 'shirt',
    pants: 'duster',
    boots: 'hatDark',
    vest: 'shirtRed',
    hat: 'hatDark',
    hair: 'hair',
  },
];

interface Part {
  bone: BoneName;
  geo: THREE.BufferGeometry;
  swatch: Swatch;
}

/** Tapered box: width/depth at the bottom and top can differ. */
function taper(w0: number, d0: number, w1: number, d1: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, h, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * (top ? w1 : w0));
    p.setZ(i, p.getZ(i) * (top ? d1 : d0));
  }
  return g;
}

function at(
  g: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
): THREE.BufferGeometry {
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

function parts(o: Outfit): Part[] {
  const out: Part[] = [];
  const P = (bone: BoneName, swatch: Swatch, geo: THREE.BufferGeometry) =>
    out.push({ bone, geo, swatch });
  // Torso.
  P('hips', o.pants, at(taper(0.31, 0.19, 0.3, 0.19, 0.2), 0, 0.95, 0));
  P('spine', o.shirt, at(taper(0.3, 0.19, 0.34, 0.2, 0.24), 0, 1.15, 0));
  P('chest', o.vest ?? o.shirt, at(taper(0.35, 0.21, 0.4, 0.22, 0.24), 0, 1.36, 0));
  P('chest', o.shirt, at(taper(0.4, 0.2, 0.3, 0.16, 0.06), 0, 1.5, 0));
  if (o.vest) P('chest', o.shirt, at(new THREE.BoxGeometry(0.08, 0.36, 0.01), 0, 1.32, -0.112));
  P('neck', o.skin, at(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 6), 0, 1.55, 0));
  if (o.bandana)
    P('neck', o.bandana, at(new THREE.CylinderGeometry(0.08, 0.09, 0.07, 7), 0, 1.53, 0));
  // Head.
  P('head', o.skin, at(taper(0.17, 0.2, 0.19, 0.21, 0.23), 0, 1.69, 0.005));
  P('head', o.skin, at(new THREE.BoxGeometry(0.04, 0.06, 0.05), 0, 1.68, -0.115));
  if (o.hair) P('head', o.hair, at(new THREE.BoxGeometry(0.2, 0.08, 0.2), 0, 1.79, 0.02));
  if (o.hat) {
    P('head', o.hat, at(new THREE.CylinderGeometry(0.26, 0.26, 0.025, 10), 0, 1.79, 0));
    P('head', o.hat, at(new THREE.CylinderGeometry(0.11, 0.13, 0.14, 8), 0, 1.86, 0));
  }
  // Arms.
  for (const s of ['L', 'R'] as const) {
    const x = s === 'L' ? -1 : 1;
    P(`upperArm${s}`, o.shirt, at(taper(0.085, 0.09, 0.1, 0.11, 0.3), x * 0.215, 1.31, 0));
    P(`lowerArm${s}`, o.shirt, at(taper(0.07, 0.075, 0.085, 0.09, 0.27), x * 0.235, 1.045, 0));
    P(`hand${s}`, o.skin, at(new THREE.BoxGeometry(0.06, 0.1, 0.085), x * 0.24, 0.86, -0.005));
    // Legs.
    P(`upperLeg${s}`, o.pants, at(taper(0.12, 0.13, 0.15, 0.16, 0.44), x * 0.1, 0.71, 0));
    P(`lowerLeg${s}`, o.pants, at(taper(0.1, 0.11, 0.12, 0.13, 0.42), x * 0.1, 0.3, 0));
    P(`foot${s}`, o.boots, at(new THREE.BoxGeometry(0.11, 0.1, 0.27), x * 0.1, 0.05, -0.05));
    P(`lowerLeg${s}`, o.boots, at(taper(0.115, 0.125, 0.12, 0.13, 0.18), x * 0.1, 0.18, 0));
  }
  return out;
}

/** Gore part bit for each bone (0 = never removed). Matches GoreBit in the sim. */
export const BONE_PART: Record<BoneName, number> = {
  hips: 0,
  spine: 0,
  chest: 0,
  neck: 0,
  head: 1,
  upperArmL: 2,
  lowerArmL: 2,
  handL: 2,
  upperArmR: 4,
  lowerArmR: 4,
  handR: 4,
  upperLegL: 8,
  lowerLegL: 8,
  footL: 8,
  upperLegR: 16,
  lowerLegR: 16,
  footR: 16,
};

/** Skinned geometry for an outfit (rigid weights: one bone per vertex). */
export function buildHumanoidGeometry(o: Outfit): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const part of parts(o)) {
    const g = part.geo.toNonIndexed();
    part.geo.dispose();
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    const [u, v] = swatchUV(part.swatch);
    const uv = new Float32Array(n * 2);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const bi = BONES.indexOf(part.bone);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('humanoid merge failed');
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/** Creates a fresh skeleton in bind pose. */
export function createSkeleton(): {
  root: THREE.Bone;
  bones: Record<BoneName, THREE.Bone>;
  skeleton: THREE.Skeleton;
} {
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONES) {
    const [x, y, z, parent] = JOINTS[name];
    const b = bones[name];
    if (parent) {
      const [px, py, pz] = JOINTS[parent];
      b.position.set(x - px, y - py, z - pz);
      bones[parent].add(b);
    } else {
      b.position.set(x, y, z);
    }
  }
  const list = BONES.map((n) => bones[n]);
  return { root: bones.hips, bones, skeleton: new THREE.Skeleton(list) };
}

const geoCache = new Map<Outfit, THREE.BufferGeometry>();

/** A ready-to-animate character mesh. */
export function createHumanoid(outfit: Outfit, material: THREE.Material): Humanoid {
  let geo = geoCache.get(outfit);
  if (!geo) geoCache.set(outfit, (geo = buildHumanoidGeometry(outfit)));
  const { root, bones, skeleton } = createSkeleton();
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  return new Humanoid(mesh, bones);
}

export interface PoseInput {
  /** Horizontal speed (m/s) for the gait. */
  speed: number;
  grounded: boolean;
  /** Look pitch in radians (head and chest follow). */
  pitch: number;
  driving: boolean;
  mantling: boolean;
  sprinting: boolean;
  /** Held item id ('' for empty hands). */
  held?: string;
  /** Lying on the ground: downed or dead (§4.9). */
  downed?: boolean;
}

/** Procedural animation: walk/run cycle, idle breathing, jump, mantle and driving poses. */
export class Humanoid {
  private phase = 0;
  private idle = Math.random() * 10;
  private air = 0;
  private gait = 0;
  private heldId = '';
  private heldMesh: THREE.Mesh | null = null;
  private swingT = 0;
  private down = 0;

  constructor(
    readonly mesh: THREE.SkinnedMesh,
    readonly bones: Record<BoneName, THREE.Bone>,
  ) {}

  /** Puts a weapon or tool in the right hand. */
  setHeld(id: string, material: THREE.Material): void {
    if (id === this.heldId) return;
    this.heldId = id;
    if (this.heldMesh) this.bones.handR.remove(this.heldMesh);
    this.heldMesh = null;
    const model = id ? weaponModel(id) : null;
    if (!model) return;
    const m = new THREE.Mesh(model.geometry, material);
    // Gun axes onto the hand: barrel along the fingers (-Y), top of the gun forward (+Z).
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    );
    m.quaternion.setFromRotationMatrix(basis);
    m.position.set(0, -0.07, 0.01);
    m.castShadow = true;
    this.heldMesh = m;
    this.bones.handR.add(m);
  }

  /** Plays a melee swing. */
  swing(): void {
    this.swingT = 1;
  }

  animate(dt: number, p: PoseInput): void {
    const b = this.bones;
    this.idle += dt;
    this.air += ((p.grounded || p.driving ? 0 : 1) - this.air) * Math.min(1, dt * 10);
    const targetGait = p.grounded ? Math.min(p.speed / 4.5, 1.6) : 0;
    this.gait += (targetGait - this.gait) * Math.min(1, dt * 8);
    const stride = p.sprinting ? 2.1 : 1.5;
    this.phase += (p.speed * dt * Math.PI * 2) / (stride * 2);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const g = Math.min(this.gait, 1.3);
    const breath = Math.sin(this.idle * 1.7) * 0.02;

    for (const name of BONES) b[name].rotation.set(0, 0, 0);
    b.hips.position.y = 0.95 - Math.abs(c) * 0.04 * g;

    // Legs: thigh swing, knee bend on the back swing.
    b.upperLegL.rotation.x = s * 0.55 * g;
    b.upperLegR.rotation.x = -s * 0.55 * g;
    b.lowerLegL.rotation.x = Math.max(0, -c) * 0.9 * g + 0.05;
    b.lowerLegR.rotation.x = Math.max(0, c) * 0.9 * g + 0.05;
    b.footL.rotation.x = -s * 0.2 * g;
    b.footR.rotation.x = s * 0.2 * g;
    // Arms counter-swing, slightly bent.
    b.upperArmL.rotation.x = -s * 0.45 * g;
    b.upperArmR.rotation.x = s * 0.45 * g;
    b.upperArmL.rotation.z = -0.08;
    b.upperArmR.rotation.z = 0.08;
    b.lowerArmL.rotation.x = 0.15 + g * 0.35;
    b.lowerArmR.rotation.x = 0.15 + g * 0.35;
    // Torso lean and twist.
    b.spine.rotation.x = -0.05 * g - (p.sprinting ? 0.12 : 0);
    b.spine.rotation.y = s * 0.08 * g;
    b.chest.rotation.x = breath + p.pitch * 0.25;
    b.neck.rotation.x = p.pitch * 0.3;
    b.head.rotation.x = p.pitch * 0.35;

    if (this.air > 0.01) {
      const a = this.air;
      b.upperLegL.rotation.x += 0.5 * a;
      b.upperLegR.rotation.x += -0.1 * a;
      b.lowerLegL.rotation.x += 0.7 * a;
      b.lowerLegR.rotation.x += 0.3 * a;
      b.upperArmL.rotation.z -= 0.5 * a;
      b.upperArmR.rotation.z += 0.5 * a;
    }
    if (p.mantling) {
      b.upperArmL.rotation.x = -2.4;
      b.upperArmR.rotation.x = -2.4;
      b.lowerArmL.rotation.x = 0.6;
      b.lowerArmR.rotation.x = 0.6;
      b.upperLegL.rotation.x = 0.9;
      b.lowerLegL.rotation.x = 1.2;
    }
    if (p.driving) {
      b.upperArmR.rotation.x = -0.9;
      b.lowerArmR.rotation.x = 0.7;
      b.upperArmL.rotation.x = -0.6;
      b.lowerArmL.rotation.x = 0.9;
    }

    // Weapons: guns point where the player looks; tools swing.
    const held = p.held ?? '';
    const gun = held === 'revolver' || held === 'rifle' || held === 'coachgun';
    if (gun && !p.driving && !p.mantling) {
      const raise = -Math.PI / 2 - p.pitch;
      b.upperArmR.rotation.set(raise, 0, 0.12);
      b.lowerArmR.rotation.set(0, 0, 0);
      if (held !== 'revolver') {
        b.upperArmL.rotation.set(raise + 0.25, 0, 0.75);
        b.lowerArmL.rotation.set(-0.5, 0, 0);
      }
      b.spine.rotation.y = 0;
    }
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt * 3);
      const k = 1 - this.swingT;
      b.upperArmR.rotation.set(-2.6 + k * 2.4, 0, 0.2);
      b.lowerArmR.rotation.set(-0.3, 0, 0);
      b.spine.rotation.y = 0.4 - k * 0.8;
    }

    // Downed: lie on the side, propped on an arm.
    this.down += ((p.downed ? 1 : 0) - this.down) * Math.min(1, dt * 5);
    if (this.down > 0.01) {
      const d = this.down;
      b.hips.rotation.x = -1.35 * d;
      b.hips.rotation.z = 0.2 * d;
      b.hips.position.y = 0.95 - 0.68 * d;
      b.upperLegL.rotation.x *= 1 - d;
      b.upperLegR.rotation.x = b.upperLegR.rotation.x * (1 - d) + 0.4 * d;
      b.lowerLegR.rotation.x = b.lowerLegR.rotation.x * (1 - d) + 0.8 * d;
      b.upperArmL.rotation.set(-2.2 * d, 0, -0.3 * d);
      b.head.rotation.x = 0.8 * d;
    }
  }
}
