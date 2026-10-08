import * as THREE from 'three/webgpu';
import { RAIL_TOP, type Route, WORLD, makeFrame } from '@dead-tracks/shared';
import { paletteMaterial } from '../render/materials.ts';
import { MeshBuilder } from '../render/builder.ts';
import { swatchUV, type Swatch } from '../render/palette.ts';
import { buildMilepost, buildSleeper, buildTelegraphPole } from '../render/models/props.ts';

const CHUNK = 100;
const SLEEPER_SPACING = 0.62;
const POLE_SPACING = 55;
const RAIL_X = 0.755;

interface Chunk {
  index: number;
  mesh: THREE.Mesh;
}

/**
 * Streams the main line around the camera in 100 m chunks of s: ballast and rails
 * as swept geometry, sleepers, telegraph poles and km posts as instances.
 */
export class TrackStreamer {
  private readonly chunks = new Map<number, Chunk>();
  private readonly sleepers: THREE.InstancedMesh;
  private readonly poles: THREE.InstancedMesh;
  private readonly posts: THREE.InstancedMesh;
  private readonly instRoot = new THREE.Group();
  private dirty = true;
  private lastOriginX = NaN;
  private lastOriginZ = NaN;
  private readonly f = makeFrame();

  constructor(
    private readonly worldRoot: THREE.Group,
    private readonly route: Route,
    private distance: number,
    /** Telegraph poles and km posts only line the main line. */
    private readonly decor = true,
  ) {
    const mat = paletteMaterial();
    this.sleepers = new THREE.InstancedMesh(buildSleeper(), mat, 3000);
    this.poles = new THREE.InstancedMesh(buildTelegraphPole(), mat, 40);
    this.posts = new THREE.InstancedMesh(buildMilepost(), mat, 12);
    for (const m of [this.sleepers, this.poles, this.posts]) {
      m.count = 0;
      m.frustumCulled = false;
      this.instRoot.add(m);
    }
    this.poles.castShadow = true;
    this.worldRoot.add(this.instRoot);
  }

  setDistance(d: number): void {
    this.distance = d;
  }

  /** `s` is the route distance nearest the camera. */
  update(s: number, originX: number, originZ: number): void {
    const first = Math.max(
      Math.floor((s - this.distance) / CHUNK),
      Math.floor(this.route.start / CHUNK),
    );
    const last = Math.min(
      Math.floor((s + this.distance) / CHUNK),
      Math.floor(this.route.end / CHUNK) - 1,
    );
    const keep = new Set<number>();
    let built = 0;
    for (let i = first; i <= last; i++) {
      keep.add(i);
      if (!this.chunks.has(i) && built < 2) {
        this.chunks.set(i, { index: i, mesh: this.buildChunk(i) });
        built++;
        this.dirty = true;
      }
    }
    for (const [i, c] of this.chunks) {
      if (!keep.has(i)) {
        this.worldRoot.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.chunks.delete(i);
        this.dirty = true;
      }
    }
    if (this.dirty || originX !== this.lastOriginX || originZ !== this.lastOriginZ) {
      this.rebuildInstances(originX, originZ);
    }
  }

  private buildChunk(index: number): THREE.Mesh {
    const s0 = index * CHUNK;
    const route = this.route;
    const f = this.f;
    route.frameAt(s0, f);
    const ox = f.x;
    const oz = f.z;
    const pos: number[] = [];
    const uv: number[] = [];
    const push = (sw: Swatch, ...pts: number[]) => {
      const [u, v] = swatchUV(sw);
      for (let i = 0; i < pts.length; i += 3) {
        pos.push(pts[i] as number, pts[i + 1] as number, pts[i + 2] as number);
        uv.push(u, v);
      }
    };
    // Cross-section points as (lateral, height above bed).
    const ballast: Array<[number, number]> = [
      [-2.3, -0.35],
      [-1.55, 0.04],
      [1.55, 0.04],
      [2.3, -0.35],
    ];
    const railTop = RAIL_TOP;
    const rail = (x: number): Array<[number, number]> => [
      [x - 0.04, 0.16],
      [x - 0.035, railTop],
      [x + 0.035, railTop],
      [x + 0.04, 0.16],
    ];
    const sweep = (profile: Array<[number, number]>, sw: Swatch, step: number) => {
      const A = makeFrame();
      const B = makeFrame();
      for (let s = s0; s < s0 + CHUNK - 1e-6; s += step) {
        route.frameAt(s, A);
        route.frameAt(Math.min(s + step, s0 + CHUNK), B);
        for (let k = 0; k < profile.length - 1; k++) {
          const [l0, h0] = profile[k] as [number, number];
          const [l1, h1] = profile[k + 1] as [number, number];
          const a0x = A.x + A.rx * l0 - ox,
            a0y = A.y + h0,
            a0z = A.z + A.rz * l0 - oz;
          const a1x = A.x + A.rx * l1 - ox,
            a1y = A.y + h1,
            a1z = A.z + A.rz * l1 - oz;
          const b0x = B.x + B.rx * l0 - ox,
            b0y = B.y + h0,
            b0z = B.z + B.rz * l0 - oz;
          const b1x = B.x + B.rx * l1 - ox,
            b1y = B.y + h1,
            b1z = B.z + B.rz * l1 - oz;
          push(sw, a0x, a0y, a0z, b0x, b0y, b0z, a1x, a1y, a1z);
          push(sw, a1x, a1y, a1z, b0x, b0y, b0z, b1x, b1y, b1z);
        }
      }
    };
    sweep(ballast, 'ballast', 4);
    sweep(rail(-RAIL_X), 'steel', 2);
    sweep(rail(RAIL_X), 'steel', 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, paletteMaterial());
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.worldRoot.add(mesh);
    return mesh;
  }

  private rebuildInstances(originX: number, originZ: number): void {
    this.dirty = false;
    this.lastOriginX = originX;
    this.lastOriginZ = originZ;
    this.instRoot.position.set(originX, 0, originZ);
    this.instRoot.updateMatrixWorld();
    const f = this.f;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let ns = 0;
    let np = 0;
    let nk = 0;
    const indices = [...this.chunks.keys()].sort((a, b) => a - b);
    for (const i of indices) {
      const s0 = i * CHUNK;
      for (
        let s = Math.ceil(s0 / SLEEPER_SPACING) * SLEEPER_SPACING;
        s < s0 + CHUNK;
        s += SLEEPER_SPACING
      ) {
        if (ns >= this.sleepers.instanceMatrix.count) break;
        this.route.frameAt(s, f);
        q.setFromAxisAngle(up, -f.heading);
        m.compose(p.set(f.x - originX, f.y + 0.16, f.z - originZ), q, one);
        this.sleepers.setMatrixAt(ns++, m);
      }
      for (
        let s = Math.ceil(s0 / POLE_SPACING) * POLE_SPACING;
        this.decor && s < s0 + CHUNK;
        s += POLE_SPACING
      ) {
        if (np >= this.poles.instanceMatrix.count) break;
        this.route.frameAt(s, f);
        q.setFromAxisAngle(up, -f.heading);
        m.compose(p.set(f.x + f.rx * 7.5 - originX, f.y - 0.3, f.z + f.rz * 7.5 - originZ), q, one);
        this.poles.setMatrixAt(np++, m);
      }
      const km = WORLD.metersPerKm;
      for (let s = Math.ceil(s0 / km) * km; this.decor && s < s0 + CHUNK; s += km) {
        if (nk >= this.posts.instanceMatrix.count || s < 0) break;
        this.route.frameAt(s, f);
        q.setFromAxisAngle(up, -f.heading + Math.PI / 2);
        m.compose(p.set(f.x - f.rx * 3.6 - originX, f.y - 0.1, f.z - f.rz * 3.6 - originZ), q, one);
        this.posts.setMatrixAt(nk++, m);
      }
    }
    this.sleepers.count = ns;
    this.poles.count = np;
    this.posts.count = nk;
    for (const inst of [this.sleepers, this.poles, this.posts])
      inst.instanceMatrix.needsUpdate = true;
  }
}

export { MeshBuilder };
