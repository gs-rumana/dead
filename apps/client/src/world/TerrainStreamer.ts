import * as THREE from 'three/webgpu';
import {
  PROP_KIND_COUNT,
  type Prop,
  type PropKindId,
  TILE_RES,
  TILE_SIZE,
  type Terrain,
  tileHeights,
  tileKey,
  tileProps,
} from '@dead-tracks/shared';
import { paletteMaterial, releaseObject, terrainMaterial } from '../render/materials.ts';
import { PROP_KINDS, buildProp } from '../render/models/props.ts';
import type { QualitySettings } from '../core/quality.ts';
import { terrainColor } from './terrainColor.ts';

interface Tile {
  key: string;
  tx: number;
  tz: number;
  res: number;
  mesh: THREE.Mesh;
  props: Prop[];
}

const PROP_CAPACITY: Record<number, number> = {
  0: 9000, // grass
  1: 2500,
  2: 1500,
  3: 6000,
  4: 2500,
  5: 1500,
  6: 1000,
  7: 1500,
};

/**
 * Streams terrain tiles and their props around the camera (§6.9): three mesh LODs
 * by distance, skirts to hide LOD seams, and one InstancedMesh per prop kind and
 * LOD so all props cost a handful of draw calls.
 */
export class TerrainStreamer {
  private readonly tiles = new Map<string, Tile>();
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly far: THREE.InstancedMesh[] = [];
  private lastPropX = Infinity;
  private lastPropZ = Infinity;
  private propsDirty = true;
  private readonly propRoot = new THREE.Group();

  constructor(
    private readonly worldRoot: THREE.Group,
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private quality: QualitySettings,
  ) {
    const mat = paletteMaterial();
    for (const kind of PROP_KINDS) {
      const cap = PROP_CAPACITY[kind] ?? 1000;
      const n = new THREE.InstancedMesh(buildProp(kind, 0), mat, cap);
      const f = new THREE.InstancedMesh(buildProp(kind, 1), mat, kind === 0 ? 1 : cap);
      for (const m of [n, f]) {
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = kind !== 0;
        m.receiveShadow = false;
        this.propRoot.add(m);
      }
      this.near[kind] = n;
      this.far[kind] = f;
    }
    this.worldRoot.add(this.propRoot);
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.propsDirty = true;
    for (const t of this.tiles.values()) t.res = -1; // force rebuild at the new LOD
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  /** Call every frame with the camera's world position and render origin. */
  update(camX: number, camZ: number, originX: number, originZ: number, budgetMs = 4): void {
    const q = this.quality;
    const radius = q.viewDistance + TILE_SIZE * 0.5;
    const ctx = Math.floor(camX / TILE_SIZE);
    const ctz = Math.floor(camZ / TILE_SIZE);
    const r = Math.ceil(radius / TILE_SIZE);
    const wanted: Array<{ tx: number; tz: number; d: number }> = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = ctx + dx;
        const tz = ctz + dz;
        const cx = (tx + 0.5) * TILE_SIZE;
        const cz = (tz + 0.5) * TILE_SIZE;
        const d = Math.hypot(cx - camX, cz - camZ);
        if (d <= radius) wanted.push({ tx, tz, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    const keep = new Set<string>();
    const start = performance.now();
    for (const w of wanted) {
      const key = tileKey(w.tx, w.tz);
      keep.add(key);
      const res =
        w.d < q.lod0Distance ? TILE_RES : w.d < q.lod1Distance ? TILE_RES / 2 : TILE_RES / 4;
      const tile = this.tiles.get(key);
      if (tile && tile.res === res) continue;
      if (performance.now() - start > budgetMs) continue;
      this.buildTile(key, w.tx, w.tz, res, tile);
      this.propsDirty = true;
    }
    for (const [key, t] of this.tiles) {
      if (!keep.has(key)) {
        releaseObject(t.mesh);
        this.tiles.delete(key);
        this.propsDirty = true;
      }
    }
    if (
      this.propsDirty ||
      Math.hypot(camX - this.lastPropX, camZ - this.lastPropZ) > 24 ||
      this.propRoot.position.x !== originX ||
      this.propRoot.position.z !== originZ
    ) {
      this.rebuildProps(camX, camZ, originX, originZ);
    }
  }

  private buildTile(key: string, tx: number, tz: number, res: number, old?: Tile): void {
    const geo = this.tileGeometry(tx, tz, res);
    if (old) {
      old.mesh.geometry.dispose();
      old.mesh.geometry = geo;
      old.res = res;
    } else {
      const mesh = new THREE.Mesh(geo, terrainMaterial());
      mesh.position.set(tx * TILE_SIZE, 0, tz * TILE_SIZE);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.worldRoot.add(mesh);
      this.tiles.set(key, {
        key,
        tx,
        tz,
        res,
        mesh,
        props: tileProps(this.terrain, tx, tz, 1),
      });
    }
  }

  private tileGeometry(tx: number, tz: number, res: number): THREE.BufferGeometry {
    const terrain = this.terrain;
    const n = res + 1;
    const step = TILE_SIZE / res;
    const x0 = tx * TILE_SIZE;
    const z0 = tz * TILE_SIZE;
    const h =
      res === TILE_RES ? tileHeights(terrain, tx, tz, res) : tileHeights(terrain, tx, tz, res);
    const skirt = 4 * 6;
    const triCount = res * res * 2 + skirt * res;
    const pos = new Float32Array(triCount * 9);
    const colors = new Float32Array(triCount * 9);
    const color = new THREE.Color();
    const seed = terrain.seed;
    const s = terrain.progressAt(x0 + TILE_SIZE / 2, z0 + TILE_SIZE / 2);
    let o = 0;
    let face = 0;
    const tri = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      cx: number,
      cy: number,
      cz: number,
      darken = 1,
    ) => {
      pos[o] = ax;
      pos[o + 1] = ay;
      pos[o + 2] = az;
      pos[o + 3] = bx;
      pos[o + 4] = by;
      pos[o + 5] = bz;
      pos[o + 6] = cx;
      pos[o + 7] = cy;
      pos[o + 8] = cz;
      // Face normal y for slope colouring.
      const ux = bx - ax,
        uy = by - ay,
        uz = bz - az;
      const vx = cx - ax,
        vy = cy - ay,
        vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const ln = Math.hypot(nx, ny, nz) || 1;
      const mx = x0 + (ax + bx + cx) / 3;
      const mz = z0 + (az + bz + cz) / 3;
      const my = (ay + by + cy) / 3;
      const bed = darken < 1 ? 0 : terrain.bedFactor(mx, mz);
      terrainColor(
        seed,
        mx,
        mz,
        my,
        Math.abs(ny / ln),
        s,
        bed,
        (tx * 73856093) ^ (tz * 19349663) ^ face,
        color,
      );
      color.multiplyScalar(darken);
      for (let k = 0; k < 3; k++) {
        colors[o + k * 3] = color.r;
        colors[o + k * 3 + 1] = color.g;
        colors[o + k * 3 + 2] = color.b;
      }
      o += 9;
      face++;
    };
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const xa = ix * step;
        const xb = xa + step;
        const za = iz * step;
        const zb = za + step;
        const h00 = h[iz * n + ix] as number;
        const h10 = h[iz * n + ix + 1] as number;
        const h01 = h[(iz + 1) * n + ix] as number;
        const h11 = h[(iz + 1) * n + ix + 1] as number;
        // Alternate the diagonal for a less regular look.
        if ((ix + iz) % 2 === 0) {
          tri(xa, h00, za, xa, h01, zb, xb, h11, zb);
          tri(xa, h00, za, xb, h11, zb, xb, h10, za);
        } else {
          tri(xa, h00, za, xa, h01, zb, xb, h10, za);
          tri(xb, h10, za, xa, h01, zb, xb, h11, zb);
        }
      }
    }
    // Skirts hide cracks between tiles of different LOD.
    const drop = 6;
    for (let i = 0; i < res; i++) {
      const a = i * step;
      const b = a + step;
      // north edge (z = 0)
      const n0 = h[i] as number,
        n1 = h[i + 1] as number;
      tri(a, n0, 0, b, n1, 0, b, n1 - drop, 0, 0.7);
      tri(a, n0, 0, b, n1 - drop, 0, a, n0 - drop, 0, 0.7);
      // south edge (z = TILE)
      const s0 = h[res * n + i] as number,
        s1 = h[res * n + i + 1] as number;
      tri(a, s0, TILE_SIZE, a, s0 - drop, TILE_SIZE, b, s1 - drop, TILE_SIZE, 0.7);
      tri(a, s0, TILE_SIZE, b, s1 - drop, TILE_SIZE, b, s1, TILE_SIZE, 0.7);
      // west edge (x = 0)
      const w0 = h[i * n] as number,
        w1 = h[(i + 1) * n] as number;
      tri(0, w0, a, 0, w0 - drop, a, 0, w1 - drop, b, 0.7);
      tri(0, w0, a, 0, w1 - drop, b, 0, w1, b, 0.7);
      // east edge (x = TILE)
      const e0 = h[i * n + res] as number,
        e1 = h[(i + 1) * n + res] as number;
      tri(TILE_SIZE, e0, a, TILE_SIZE, e1, b, TILE_SIZE, e1 - drop, b, 0.7);
      tri(TILE_SIZE, e0, a, TILE_SIZE, e1 - drop, b, TILE_SIZE, e0 - drop, a, 0.7);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, o), 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  private rebuildProps(camX: number, camZ: number, originX: number, originZ: number): void {
    this.lastPropX = camX;
    this.lastPropZ = camZ;
    this.propsDirty = false;
    this.propRoot.position.set(originX, 0, originZ);
    this.propRoot.updateMatrixWorld();
    const q = this.quality;
    const counts = new Array<number>(PROP_KIND_COUNT).fill(0);
    const farCounts = new Array<number>(PROP_KIND_COUNT).fill(0);
    const nearD2 = q.propLodDistance * q.propLodDistance;
    const grassD2 = q.grassDistance * q.grassDistance;
    const maxD2 = q.viewDistance * q.viewDistance;
    for (const t of this.tiles.values()) {
      for (const p of t.props) {
        const dx = p.x - camX;
        const dz = p.z - camZ;
        const d2 = dx * dx + dz * dz;
        if (d2 > maxD2) continue;
        const kind = p.kind as PropKindId;
        if (kind === 0) {
          if (d2 > grassD2) continue;
          writeInstance(
            this.near[0] as THREE.InstancedMesh,
            (counts[0] as number) + 0,
            p,
            originX,
            originZ,
          );
          counts[0] = (counts[0] as number) + 1;
          continue;
        }
        if (d2 < nearD2) {
          writeInstance(
            this.near[kind] as THREE.InstancedMesh,
            counts[kind] as number,
            p,
            originX,
            originZ,
          );
          counts[kind] = (counts[kind] as number) + 1;
        } else {
          writeInstance(
            this.far[kind] as THREE.InstancedMesh,
            farCounts[kind] as number,
            p,
            originX,
            originZ,
          );
          farCounts[kind] = (farCounts[kind] as number) + 1;
        }
      }
    }
    for (const kind of PROP_KINDS) {
      const n = this.near[kind] as THREE.InstancedMesh;
      const f = this.far[kind] as THREE.InstancedMesh;
      n.count = Math.min(counts[kind] as number, n.instanceMatrix.count);
      f.count = Math.min(farCounts[kind] as number, f.instanceMatrix.count);
      n.instanceMatrix.needsUpdate = true;
      f.instanceMatrix.needsUpdate = true;
      n.visible = n.count > 0;
      f.visible = f.count > 0;
    }
  }

  dispose(): void {
    for (const t of this.tiles.values()) releaseObject(t.mesh);
    this.tiles.clear();
    this.worldRoot.remove(this.propRoot);
  }
}

function writeInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  p: Prop,
  ox: number,
  oz: number,
): void {
  if (i >= mesh.instanceMatrix.count) return;
  const e = mesh.instanceMatrix.array as Float32Array;
  const c = Math.cos(p.rot) * p.scale;
  const s = Math.sin(p.rot) * p.scale;
  const o = i * 16;
  e[o] = c;
  e[o + 1] = 0;
  e[o + 2] = -s;
  e[o + 3] = 0;
  e[o + 4] = 0;
  e[o + 5] = p.scale;
  e[o + 6] = 0;
  e[o + 7] = 0;
  e[o + 8] = s;
  e[o + 9] = 0;
  e[o + 10] = c;
  e[o + 11] = 0;
  e[o + 12] = p.x - ox;
  e[o + 13] = p.y - 0.05;
  e[o + 14] = p.z - oz;
  e[o + 15] = 1;
}
