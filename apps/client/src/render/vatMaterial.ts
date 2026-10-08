import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  cos,
  float,
  floor,
  greaterThan,
  instancedDynamicBufferAttribute,
  mix,
  mod,
  select,
  sin,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
  vertexIndex,
} from 'three/tsl';
import { paletteTexture } from './palette.ts';
import type { VatAsset } from './vat.ts';

/** Per-instance data written by the CPU every frame. */
export interface VatInstances {
  mesh: THREE.InstancedMesh;
  /** x, y, z (render space), yaw */
  posYaw: THREE.InstancedBufferAttribute;
  /** frame A, frame B, blend, scale */
  anim: THREE.InstancedBufferAttribute;
  /** gore bits, hit flash, darken, unused */
  fx: THREE.InstancedBufferAttribute;
  capacity: number;
}

/**
 * One instanced draw for a whole horde: vertex positions come from the baked
 * animation texture, then each instance is scaled, turned and placed. Gore bits
 * collapse whole body parts (heads, arms, legs) into the chest.
 */
export function createVatInstances(asset: VatAsset, capacity: number): VatInstances {
  const posYaw = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const fx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  for (const a of [posYaw, anim, fx]) a.setUsage(THREE.DynamicDrawUsage);

  // @types/three's TSL types don't model swizzles on attribute nodes; treat them as vec4.
  type V4 = ReturnType<typeof vec4>;
  const iPos = instancedDynamicBufferAttribute(posYaw, 'vec4') as unknown as V4;
  const iAnim = instancedDynamicBufferAttribute(anim, 'vec4') as unknown as V4;
  const iFx = instancedDynamicBufferAttribute(fx, 'vec4') as unknown as V4;
  const W = float(asset.vertexCount);
  const H = float(asset.frameCount);

  const material = new THREE.MeshLambertNodeMaterial({ flatShading: true });
  material.positionNode = Fn(() => {
    const u = vertexIndex.toFloat().add(0.5).div(W);
    const a = texture(asset.texture, vec2(u, iAnim.x.add(float(0.5)).div(H))).level(float(0)).xyz;
    const b = texture(asset.texture, vec2(u, iAnim.y.add(float(0.5)).div(H))).level(float(0)).xyz;
    const p = mix(a, b, iAnim.z).toVar();
    // Gore: hide a part when its bit is set.
    const part = attribute('part', 'float');
    const bit = mod(floor(iFx.x.div(part.max(1))), 2);
    const hidden = select(greaterThan(part, 0.5), bit, float(0));
    p.assign(mix(p, vec3(0, 1.2, 0), hidden));
    const sp = p.mul(iAnim.w);
    const c = cos(iPos.w);
    const s = sin(iPos.w);
    return vec3(sp.x.mul(c).add(sp.z.mul(s)), sp.y, sp.x.negate().mul(s).add(sp.z.mul(c))).add(
      iPos.xyz,
    );
  })();
  const base = texture(paletteTexture(), uv());
  material.colorNode = vec4(mix(base.rgb.mul(iFx.z), vec3(1, 0.85, 0.8), iFx.y.mul(0.65)), 1);

  const mesh = new THREE.InstancedMesh(asset.geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return { mesh, posYaw, anim, fx, capacity };
}
