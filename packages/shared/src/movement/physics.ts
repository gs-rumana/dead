import RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER } from '../data/player.ts';
import { CONSIST, type CarLayout, GAP_PLATES, TRAIN_LADDERS } from '../vehicles/consist.ts';
import type { CarPose } from '../vehicles/trainPose.ts';
import { PROP_COLLIDERS, type Prop, tileProps } from '../worldgen/props.ts';
import type { Terrain } from '../worldgen/terrain.ts';
import type { Piece, Structure } from '../worldgen/structures.ts';
import { TILE_RES, TILE_SIZE, tileHeights, tileKey } from '../worldgen/tiles.ts';

export type Rapier = typeof RAPIER;
export { RAPIER };

let initPromise: Promise<Rapier> | null = null;

/** Loads Rapier's WASM once per thread (client main thread, solo worker, server). */
export function initPhysics(): Promise<Rapier> {
  initPromise ??= RAPIER.init().then(() => RAPIER);
  return initPromise;
}

/** Collision groups: environment, train hull, and the character probe. */
export const Group = { Env: 0x0001, Train: 0x0002, Probe: 0x0004, Ladder: 0x0008 } as const;
export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}
export const SOLID_FILTER = groups(Group.Probe, Group.Env | Group.Train);

interface TileColliders {
  colliders: RAPIER.Collider[];
  /** Tile origin (world) for rebasing. */
  x0: number;
  z0: number;
  /** World positions of each collider (centre), for rebasing. */
  pos: Array<{ x: number; y: number; z: number }>;
  lastUsed: number;
}

/**
 * Two Rapier worlds (§6.7, §6.8):
 * - `ground`: terrain, props and the moving train hull, positioned relative to a
 *   floating origin so float32 precision holds across the 20 km route;
 * - `train`: the straight train-space layout, static, used while riding the train.
 */
export class PhysicsSpace {
  readonly R: Rapier;
  readonly ground: RAPIER.World;
  readonly train: RAPIER.World;
  readonly groundProbe: RAPIER.Collider;
  readonly trainProbe: RAPIER.Collider;
  readonly groundCtl: RAPIER.KinematicCharacterController;
  readonly trainCtl: RAPIER.KinematicCharacterController;
  originX = 0;
  originZ = 0;
  private readonly tiles = new Map<string, TileColliders>();
  private readonly carBodies: RAPIER.RigidBody[] = [];
  private readonly trainColliderHandles = new Set<number>();
  private frameCounter = 0;
  /** Structures whose colliders load with a tile (set by the owner of the World). */
  structureSource: ((tx: number, tz: number) => Structure[]) | null = null;
  /** Dynamic structure pieces (doors, boards) by "structureId:pieceId". */
  private readonly pieces = new Map<
    string,
    { collider: RAPIER.Collider; st: Structure; piece: Piece; state: number }
  >();
  /** Last known dynamic state per piece, applied when its tile (re)loads. */
  private readonly pieceStates = new Map<string, number>();

  constructor(
    R: Rapier,
    readonly terrain: Terrain,
  ) {
    this.R = R;
    this.ground = new R.World({ x: 0, y: 0, z: 0 });
    this.train = new R.World({ x: 0, y: 0, z: 0 });

    // Static train-space layout.
    for (const car of CONSIST) {
      for (const c of car.def.colliders) {
        this.train.createCollider(
          R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
            .setTranslation(c.x, c.y, car.zc + c.z)
            .setCollisionGroups(groups(Group.Train, 0xffff)),
        );
      }
    }
    for (const c of GAP_PLATES) {
      this.train.createCollider(
        R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
          .setTranslation(c.x, c.y, c.z)
          .setCollisionGroups(groups(Group.Train, 0xffff)),
      );
    }
    for (const c of TRAIN_LADDERS) {
      this.train.createCollider(
        R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
          .setTranslation(c.x, c.y, c.z)
          .setSensor(true)
          .setCollisionGroups(groups(Group.Ladder, Group.Probe)),
      );
    }

    // Moving hull in the ground world: one kinematic body per car.
    for (const car of CONSIST) {
      const body = this.ground.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
      for (const c of car.def.colliders) {
        const col = this.ground.createCollider(
          R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
            .setTranslation(c.x, c.y, c.z)
            .setCollisionGroups(groups(Group.Train, 0xffff)),
          body,
        );
        this.trainColliderHandles.add(col.handle);
      }
      this.carBodies.push(body);
    }

    const probe = () =>
      R.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius)
        .setCollisionGroups(groups(Group.Probe, 0))
        .setSensor(true);
    this.groundProbe = this.ground.createCollider(probe());
    this.trainProbe = this.train.createCollider(probe());
    this.groundCtl = this.makeController(this.ground);
    this.trainCtl = this.makeController(this.train);
    this.ground.step();
    this.train.step();
  }

  private makeController(world: RAPIER.World): RAPIER.KinematicCharacterController {
    const ctl = world.createCharacterController(0.02);
    ctl.enableAutostep(PLAYER.stepHeight, 0.15, false);
    ctl.enableSnapToGround(0.3);
    ctl.setMaxSlopeClimbAngle((PLAYER.maxSlopeDeg * Math.PI) / 180);
    ctl.setMinSlopeSlideAngle(((PLAYER.maxSlopeDeg + 5) * Math.PI) / 180);
    ctl.setApplyImpulsesToDynamicBodies(false);
    return ctl;
  }

  isTrainCollider(c: RAPIER.Collider): boolean {
    return this.trainColliderHandles.has(c.handle);
  }

  /** Moves the train hull in the ground world. Call before stepping characters. */
  setTrainPoses(poses: readonly CarPose[]): void {
    for (let i = 0; i < this.carBodies.length; i++) {
      const p = poses[i] as CarPose;
      const body = this.carBodies[i] as RAPIER.RigidBody;
      body.setTranslation({ x: p.cx - this.originX, y: p.cy, z: p.cz - this.originZ }, false);
      body.setRotation(basisToQuat(p), false);
    }
  }

  /** Refreshes the ground world's spatial queries after the hull moved. */
  refresh(): void {
    this.ground.step();
  }

  /** Moves the floating origin; existing colliders are shifted to keep world positions. */
  rebase(x: number, z: number): void {
    if (x === this.originX && z === this.originZ) return;
    this.originX = x;
    this.originZ = z;
    for (const t of this.tiles.values()) {
      t.colliders.forEach((c, i) => {
        const p = t.pos[i] as { x: number; y: number; z: number };
        c.setTranslation({ x: p.x - x, y: p.y, z: p.z - z });
      });
    }
  }

  /** Rebases when the given point drifts far from the origin (§6.7: every 1 km). */
  maybeRebase(x: number, z: number, distance = 1000): void {
    if (Math.abs(x - this.originX) > distance || Math.abs(z - this.originZ) > distance) {
      this.rebase(Math.round(x / TILE_SIZE) * TILE_SIZE, Math.round(z / TILE_SIZE) * TILE_SIZE);
    }
  }

  /**
   * Keeps terrain and prop colliders loaded for tiles within `radius` of any point
   * (§6.10: colliders only near players) and drops tiles that have not been needed
   * for a while.
   */
  streamTiles(points: ReadonlyArray<{ x: number; z: number }>, radius = 96): void {
    this.frameCounter++;
    for (const p of points) {
      const tx0 = Math.floor((p.x - radius) / TILE_SIZE);
      const tx1 = Math.floor((p.x + radius) / TILE_SIZE);
      const tz0 = Math.floor((p.z - radius) / TILE_SIZE);
      const tz1 = Math.floor((p.z + radius) / TILE_SIZE);
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const key = tileKey(tx, tz);
          const t = this.tiles.get(key);
          if (t) t.lastUsed = this.frameCounter;
          else this.loadTile(key, tx, tz);
        }
      }
    }
    for (const [key, t] of this.tiles) {
      if (this.frameCounter - t.lastUsed > 90) {
        for (const c of t.colliders) this.ground.removeCollider(c, false);
        this.tiles.delete(key);
        for (const [pk, p] of this.pieces)
          if (t.colliders.includes(p.collider)) this.pieces.delete(pk);
      }
    }
  }

  get loadedTiles(): number {
    return this.tiles.size;
  }

  private loadTile(key: string, tx: number, tz: number): void {
    const R = this.R;
    const n = TILE_RES + 1;
    const h = tileHeights(this.terrain, tx, tz);
    // Rapier wants column-major with columns along x and rows along z.
    const hf = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) hf[ix * n + iz] = h[iz * n + ix] as number;
    const x0 = tx * TILE_SIZE;
    const z0 = tz * TILE_SIZE;
    const cx = x0 + TILE_SIZE / 2;
    const cz = z0 + TILE_SIZE / 2;
    const colliders: RAPIER.Collider[] = [];
    const pos: Array<{ x: number; y: number; z: number }> = [];
    colliders.push(
      this.ground.createCollider(
        R.ColliderDesc.heightfield(TILE_RES, TILE_RES, hf, { x: TILE_SIZE, y: 1, z: TILE_SIZE })
          .setTranslation(cx - this.originX, 0, cz - this.originZ)
          .setCollisionGroups(groups(Group.Env, 0xffff)),
      ),
    );
    pos.push({ x: cx, y: 0, z: cz });
    for (const prop of tileProps(this.terrain, tx, tz, 0))
      this.addPropCollider(prop, colliders, pos);
    for (const st of this.structureSource?.(tx, tz) ?? []) this.addStructure(st, colliders, pos);
    this.tiles.set(key, { colliders, pos, x0, z0, lastUsed: this.frameCounter });
  }

  private addStructure(
    st: Structure,
    colliders: RAPIER.Collider[],
    pos: Array<{ x: number; y: number; z: number }>,
  ): void {
    for (const p of st.pieces) {
      if (!p.solid && p.kind !== 'ladder') continue;
      const w = pieceWorld(st, p);
      const desc = this.R.ColliderDesc.cuboid(p.hx, p.hy, p.hz)
        .setTranslation(w.x - this.originX, w.y, w.z - this.originZ)
        .setRotation(yawQuat(st.yaw + p.ry));
      if (p.kind === 'ladder')
        desc.setSensor(true).setCollisionGroups(groups(Group.Ladder, Group.Probe));
      else desc.setCollisionGroups(groups(Group.Env, 0xffff));
      const c = this.ground.createCollider(desc);
      colliders.push(c);
      pos.push(w);
      if (p.kind === 'door' || p.kind === 'board') {
        const key = `${st.id}:${p.id}`;
        this.pieces.set(key, { collider: c, st, piece: p, state: 0 });
        this.applyPiece(key, this.pieceStates.get(key) ?? 0);
      }
    }
  }

  /** Doors open (1) or close (0); boards break (1) (§4.8). */
  setPieceState(key: string, state: number): void {
    this.pieceStates.set(key, state);
    this.applyPiece(key, state);
  }

  private applyPiece(key: string, state: number): void {
    const e = this.pieces.get(key);
    if (!e) return;
    e.state = state;
    const { st, piece } = e;
    if (piece.kind === 'board') {
      e.collider.setEnabled(state === 0);
      return;
    }
    // Door: swing 90° about the hinge edge.
    const w = doorPose(st, piece, state === 1 ? 1 : 0);
    e.collider.setTranslation({ x: w.x - this.originX, y: w.y, z: w.z - this.originZ });
    e.collider.setRotation(yawQuat(w.yaw));
  }

  /** True if the capsule at a feet position touches a ladder (§4.8). */
  onLadder(world: 'ground' | 'train', x: number, y: number, z: number): boolean {
    const w = world === 'ground' ? this.ground : this.train;
    const ox = world === 'ground' ? this.originX : 0;
    const oz = world === 'ground' ? this.originZ : 0;
    let hit = false;
    w.intersectionsWithShape(
      { x: x - ox, y: y + PLAYER.radius + PLAYER.halfHeight, z: z - oz },
      { x: 0, y: 0, z: 0, w: 1 },
      new this.R.Capsule(PLAYER.halfHeight, PLAYER.radius + 0.1),
      () => {
        hit = true;
        return false;
      },
      undefined,
      groups(Group.Probe, Group.Ladder),
    );
    return hit;
  }

  private addPropCollider(
    prop: Prop,
    colliders: RAPIER.Collider[],
    pos: Array<{ x: number; y: number; z: number }>,
  ): void {
    const spec = PROP_COLLIDERS[prop.kind];
    if (!spec) return;
    const r = spec.radius * prop.scale;
    const hh = (spec.height * prop.scale) / 2;
    const y = prop.y + hh - 0.2;
    colliders.push(
      this.ground.createCollider(
        this.R.ColliderDesc.cylinder(hh, r)
          .setTranslation(prop.x - this.originX, y, prop.z - this.originZ)
          .setCollisionGroups(groups(Group.Env, 0xffff)),
      ),
    );
    pos.push({ x: prop.x, y, z: prop.z });
  }

  /** Ray cast in the ground world from a world-space point. Returns distance or -1. */
  rayGround(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    max: number,
    filter = SOLID_FILTER,
  ): { toi: number; collider: RAPIER.Collider } | null {
    const ray = new this.R.Ray(
      { x: ox - this.originX, y: oy, z: oz - this.originZ },
      { x: dx, y: dy, z: dz },
    );
    const hit = this.ground.castRay(ray, max, true, undefined, filter);
    return hit ? { toi: hit.timeOfImpact, collider: hit.collider } : null;
  }

  rayTrain(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    max: number,
  ): { toi: number; collider: RAPIER.Collider } | null {
    const ray = new this.R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.train.castRay(ray, max, true, undefined, SOLID_FILTER);
    return hit ? { toi: hit.timeOfImpact, collider: hit.collider } : null;
  }

  dispose(): void {
    this.ground.free();
    this.train.free();
  }
}

/** World position of a structure piece's centre. */
export function pieceWorld(st: Structure, p: Piece): { x: number; y: number; z: number } {
  const c = Math.cos(st.yaw);
  const s = Math.sin(st.yaw);
  return { x: st.x + c * p.x + s * p.z, y: st.y + p.y, z: st.z - s * p.x + c * p.z };
}

/** A door's centre and yaw when open by `t` (0 closed .. 1 open 90°). */
export function doorPose(
  st: Structure,
  p: Piece,
  t: number,
): { x: number; y: number; z: number; yaw: number } {
  // Hinge at the +x end of the door (in the door's own frame).
  const ang = (p.hinge ?? 1) * t * (Math.PI / 2);
  const cr = Math.cos(p.ry);
  const sr = Math.sin(p.ry);
  // Hinge point in structure-local coords.
  const hx = p.x + cr * p.hx * (p.hinge ?? 1);
  const hz = p.z - sr * p.hx * (p.hinge ?? 1);
  // Door centre relative to the hinge, rotated.
  const yaw = p.ry + ang;
  const cx = hx - Math.cos(yaw) * p.hx * (p.hinge ?? 1);
  const cz = hz + Math.sin(yaw) * p.hx * (p.hinge ?? 1);
  const c = Math.cos(st.yaw);
  const s = Math.sin(st.yaw);
  return { x: st.x + c * cx + s * cz, y: st.y + p.y, z: st.z - s * cx + c * cz, yaw: st.yaw + yaw };
}

export function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Quaternion from an orthonormal basis given as columns right (X), up (Y), back (Z). */
export function basisToQuat(p: CarPose): { x: number; y: number; z: number; w: number } {
  const m00 = p.rx;
  const m01 = p.ux;
  const m02 = p.bx;
  const m10 = p.ry;
  const m11 = p.uy;
  const m12 = p.by;
  const m20 = p.rz;
  const m21 = p.uz;
  const m22 = p.bz;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
}

/** Matches the CONSIST import for consumers that need car layouts with physics. */
export type { CarLayout };
