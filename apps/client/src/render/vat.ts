import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { weaponModel } from './models/weapons.ts';
import {
  BONES,
  BONE_PART,
  type BoneName,
  type Outfit,
  buildHumanoidGeometry,
  createSkeleton,
} from './models/humanoid.ts';

/**
 * Vertex animation textures (§6.9): the undead walk, run and die on the GPU, so a
 * whole horde costs one draw call per enemy type. Clips are posed procedurally on
 * the shared skeleton and baked to a half-float texture (one row per frame).
 */
export interface VatClip {
  start: number;
  frames: number;
  fps: number;
  loop: boolean;
}

export type ClipName = 'idle' | 'walk' | 'run' | 'attack' | 'dead' | 'climb' | 'crouch';

export interface VatAsset {
  geometry: THREE.BufferGeometry;
  texture: THREE.DataTexture;
  clips: Record<ClipName, VatClip>;
  vertexCount: number;
  frameCount: number;
}

const CLIP_SPEC: Array<[ClipName, number, number, boolean]> = [
  ['idle', 8, 4, true],
  ['walk', 16, 12, true],
  ['run', 16, 18, true],
  ['attack', 12, 14, false],
  ['dead', 16, 16, false],
  ['climb', 12, 10, true],
  ['crouch', 8, 4, true],
];

type Bones = Record<BoneName, THREE.Bone>;

/** Procedural undead poses: t in [0, 1) through the clip. */
function poseZombie(b: Bones, clip: ClipName, t: number): void {
  for (const n of BONES) b[n].rotation.set(0, 0, 0);
  b.hips.position.set(0, 0.95, 0);
  const s = Math.sin(t * Math.PI * 2);
  const c = Math.cos(t * Math.PI * 2);
  // Arms reach forward, head lolls: the classic shamble.
  const reach = (amt: number) => {
    b.upperArmL.rotation.x = -1.35 * amt + s * 0.12;
    b.upperArmR.rotation.x = -1.2 * amt - s * 0.12;
    b.lowerArmL.rotation.x = -0.25 * amt;
    b.lowerArmR.rotation.x = -0.35 * amt;
  };
  switch (clip) {
    case 'idle':
      reach(0.35);
      b.spine.rotation.x = 0.15 + s * 0.03;
      b.head.rotation.z = 0.25 + s * 0.08;
      b.head.rotation.x = 0.2;
      break;
    case 'walk': {
      reach(0.85);
      b.upperLegL.rotation.x = s * 0.42;
      b.upperLegR.rotation.x = -s * 0.32;
      b.lowerLegL.rotation.x = Math.max(0, -c) * 0.7 + 0.05;
      b.lowerLegR.rotation.x = Math.max(0, c) * 0.4 + 0.05;
      b.footR.rotation.x = 0.35; // dragging foot
      b.hips.position.y = 0.95 - Math.abs(c) * 0.05;
      b.hips.rotation.z = s * 0.06;
      b.spine.rotation.x = 0.28;
      b.spine.rotation.y = s * 0.12;
      b.head.rotation.z = 0.3 + s * 0.1;
      b.head.rotation.x = 0.15;
      break;
    }
    case 'run': {
      b.upperArmL.rotation.x = -0.9 + s * 0.9;
      b.upperArmR.rotation.x = -0.9 - s * 0.9;
      b.lowerArmL.rotation.x = -0.6;
      b.lowerArmR.rotation.x = -0.6;
      b.upperLegL.rotation.x = s * 0.85;
      b.upperLegR.rotation.x = -s * 0.85;
      b.lowerLegL.rotation.x = Math.max(0, -c) * 1.4 + 0.1;
      b.lowerLegR.rotation.x = Math.max(0, c) * 1.4 + 0.1;
      b.hips.position.y = 0.92 - Math.abs(c) * 0.08;
      b.spine.rotation.x = 0.5;
      b.head.rotation.x = -0.25;
      b.head.rotation.z = s * 0.15;
      break;
    }
    case 'attack': {
      // Raise both arms, then claw down and forward.
      const up = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
      b.upperArmL.rotation.x = -1.2 - up * 1.4 + (t > 0.4 ? (t - 0.4) * 1.2 : 0);
      b.upperArmR.rotation.x = -1.1 - up * 1.5 + (t > 0.4 ? (t - 0.4) * 1.3 : 0);
      b.lowerArmL.rotation.x = -0.4 * up;
      b.lowerArmR.rotation.x = -0.4 * up;
      b.spine.rotation.x = 0.2 + (t > 0.4 ? (t - 0.4) * 0.8 : -0.1 * up);
      b.head.rotation.x = -0.2;
      b.upperLegL.rotation.x = -0.3;
      b.upperLegR.rotation.x = 0.25;
      break;
    }
    case 'dead': {
      // Topple backward and settle on the ground.
      const k = Math.min(1, t * 1.6);
      const ease = k * k * (3 - 2 * k);
      b.hips.rotation.x = -ease * 1.5;
      b.hips.position.y = 0.95 - ease * 0.72;
      b.hips.position.z = ease * 0.5;
      b.lowerLegL.rotation.x = 0.4 * (1 - ease) + 0.2;
      b.lowerLegR.rotation.x = 0.6 * (1 - ease);
      b.upperArmL.rotation.z = -ease * 1.2;
      b.upperArmR.rotation.z = ease * 1.0;
      b.upperArmR.rotation.x = -ease * 0.4;
      b.head.rotation.y = ease * 0.6;
      b.head.rotation.x = -ease * 0.3;
      break;
    }
    case 'climb':
      b.upperArmL.rotation.x = -2.6 + s * 0.3;
      b.upperArmR.rotation.x = -2.6 - s * 0.3;
      b.lowerArmL.rotation.x = -0.5;
      b.lowerArmR.rotation.x = -0.5;
      b.upperLegL.rotation.x = -0.8 + s * 0.6;
      b.upperLegR.rotation.x = -0.8 - s * 0.6;
      b.lowerLegL.rotation.x = 1.2;
      b.lowerLegR.rotation.x = 1.2;
      b.spine.rotation.x = 0.3;
      break;
    case 'crouch':
      reach(0.4);
      b.hips.position.y = 0.6 + s * 0.02;
      b.upperLegL.rotation.x = -1.4;
      b.upperLegR.rotation.x = -1.1;
      b.lowerLegL.rotation.x = 2.2;
      b.lowerLegR.rotation.x = 1.9;
      b.spine.rotation.x = 0.6;
      b.head.rotation.x = -0.4;
      break;
  }
}

/** Living people (outlaws, townsfolk): a normal gait and a rifle-aiming "attack". */
function poseHuman(b: Bones, clip: ClipName, t: number): void {
  for (const n of BONES) b[n].rotation.set(0, 0, 0);
  b.hips.position.set(0, 0.95, 0);
  const s = Math.sin(t * Math.PI * 2);
  const c = Math.cos(t * Math.PI * 2);
  const carry = () => {
    // Rifle held across the body.
    b.upperArmR.rotation.set(-0.5, 0, 0.15);
    b.lowerArmR.rotation.set(-0.9, 0, 0);
    b.upperArmL.rotation.set(-0.7, 0, -0.3);
    b.lowerArmL.rotation.set(-1.1, 0, 0);
  };
  switch (clip) {
    case 'idle':
      carry();
      b.chest.rotation.x = s * 0.02;
      break;
    case 'walk':
      carry();
      b.upperLegL.rotation.x = s * 0.5;
      b.upperLegR.rotation.x = -s * 0.5;
      b.lowerLegL.rotation.x = Math.max(0, -c) * 0.8 + 0.05;
      b.lowerLegR.rotation.x = Math.max(0, c) * 0.8 + 0.05;
      b.hips.position.y = 0.95 - Math.abs(c) * 0.03;
      break;
    case 'run':
      carry();
      b.upperLegL.rotation.x = s * 0.8;
      b.upperLegR.rotation.x = -s * 0.8;
      b.lowerLegL.rotation.x = Math.max(0, -c) * 1.3 + 0.1;
      b.lowerLegR.rotation.x = Math.max(0, c) * 1.3 + 0.1;
      b.spine.rotation.x = 0.25;
      b.hips.position.y = 0.92 - Math.abs(c) * 0.06;
      break;
    case 'attack': {
      // Shouldered rifle, a small recoil kick early in the clip.
      const kick = t < 0.2 ? (0.2 - t) * 1.2 : 0;
      b.upperArmR.rotation.set(-1.45 - kick, 0, 0.25);
      b.lowerArmR.rotation.set(-0.35, 0, 0);
      b.upperArmL.rotation.set(-1.5 - kick, 0, -0.55);
      b.lowerArmL.rotation.set(-0.15, 0, 0);
      b.head.rotation.x = 0.1;
      b.spine.rotation.y = -0.15;
      break;
    }
    case 'dead': {
      const k = Math.min(1, t * 1.6);
      const ease = k * k * (3 - 2 * k);
      b.hips.rotation.x = ease * 1.45;
      b.hips.position.y = 0.95 - ease * 0.74;
      b.hips.position.z = -ease * 0.5;
      b.upperArmL.rotation.z = -ease * 1.4;
      b.upperArmR.rotation.z = ease * 1.2;
      b.lowerLegL.rotation.x = 0.5 * (1 - ease);
      break;
    }
    case 'climb':
      b.upperArmL.rotation.x = -2.6 + s * 0.3;
      b.upperArmR.rotation.x = -2.6 - s * 0.3;
      b.upperLegL.rotation.x = -0.8 + s * 0.6;
      b.upperLegR.rotation.x = -0.8 - s * 0.6;
      b.lowerLegL.rotation.x = 1.2;
      b.lowerLegR.rotation.x = 1.2;
      break;
    case 'crouch':
      carry();
      b.hips.position.y = 0.6;
      b.upperLegL.rotation.x = -1.4;
      b.upperLegR.rotation.x = -1.1;
      b.lowerLegL.rotation.x = 2.2;
      b.lowerLegR.rotation.x = 1.9;
      b.spine.rotation.x = 0.4;
      break;
  }
}

export type VatStyle = 'zombie' | 'human';

const cache = new Map<string, VatAsset>();
const outfitIds = new Map<Outfit, number>();

/** Bakes an outfit's clips; humans can hold a weapon (skinned to the right hand). */
export function bakeVat(outfit: Outfit, style: VatStyle = 'zombie', held = ''): VatAsset {
  if (!outfitIds.has(outfit)) outfitIds.set(outfit, outfitIds.size);
  const key = `${outfitIds.get(outfit)}:${style}:${held}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pose = style === 'human' ? poseHuman : poseZombie;
  let source = buildHumanoidGeometry(outfit);
  const model = held ? weaponModel(held) : null;
  if (model) {
    // Bind the weapon to the right hand in the bind pose (same mapping as Humanoid.setHeld).
    const g = model.geometry.clone();
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    );
    g.applyMatrix4(basis);
    g.translate(0.24, 0.92 - 0.07, 0.01);
    const n = g.getAttribute('position').count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const hand = BONES.indexOf('handR');
    for (let i = 0; i < n; i++) {
      si[i * 4] = hand;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    for (const name of Object.keys(g.attributes))
      if (!source.hasAttribute(name)) g.deleteAttribute(name);
    for (const name of Object.keys(source.attributes))
      if (!g.hasAttribute(name)) source.deleteAttribute(name);
    const merged = mergeGeometries([source, g], false);
    if (merged) source = merged;
  }
  const pos = source.getAttribute('position') as THREE.BufferAttribute;
  const skin = source.getAttribute('skinIndex') as THREE.BufferAttribute;
  const n = pos.count;
  const { root, bones, skeleton } = createSkeleton();
  root.updateMatrixWorld(true);
  skeleton.calculateInverses();

  const clips = {} as Record<ClipName, VatClip>;
  let total = 0;
  for (const [name, frames, fps, loop] of CLIP_SPEC) {
    clips[name] = { start: total, frames, fps, loop };
    total += frames;
  }
  const data = new Float32Array(n * total * 4);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const boneMats = BONES.map(() => new THREE.Matrix4());
  for (const [name, frames] of CLIP_SPEC) {
    const clip = clips[name];
    for (let f = 0; f < frames; f++) {
      const t = clip.loop ? f / frames : f / (frames - 1);
      pose(bones, name, t);
      root.updateMatrixWorld(true);
      BONES.forEach((bn, i) =>
        boneMats[i]!.multiplyMatrices(bones[bn].matrixWorld, skeleton.boneInverses[i]!),
      );
      const row = clip.start + f;
      for (let i = 0; i < n; i++) {
        const bi = skin.getX(i);
        v.fromBufferAttribute(pos, i).applyMatrix4(boneMats[bi] ?? m);
        const o = (row * n + i) * 4;
        data[o] = v.x;
        data[o + 1] = v.y;
        data[o + 2] = v.z;
        data[o + 3] = 1;
      }
    }
  }
  const texture = new THREE.DataTexture(data, n, total, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  // Render geometry: uvs (palette) and a per-vertex gore part; positions come from the texture.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', source.getAttribute('position'));
  geometry.setAttribute('uv', source.getAttribute('uv'));
  const part = new Float32Array(n);
  for (let i = 0; i < n; i++) part[i] = BONE_PART[BONES[skin.getX(i)] as BoneName];
  geometry.setAttribute('part', new THREE.BufferAttribute(part, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2);
  const asset: VatAsset = { geometry, texture, clips, vertexCount: n, frameCount: total };
  cache.set(key, asset);
  return asset;
}
