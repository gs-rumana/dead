import type { Vec3 } from '../math/vec.ts';
import { type Route, type TrackFrame, makeFrame } from '../worldgen/route.ts';
import { CONSIST, type CarLayout, RAIL_TOP } from './consist.ts';

/** World transform of one car: centre plus an orthonormal basis (right, up, back). */
export interface CarPose {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  /** Back = toward the rear of the train (train-space +z). */
  bx: number;
  by: number;
  bz: number;
  /** three.js yaw of the car's forward direction. */
  yaw: number;
  pitch: number;
}

export function makeCarPoses(): CarPose[] {
  return CONSIST.map(() => ({
    cx: 0,
    cy: 0,
    cz: 0,
    rx: 1,
    ry: 0,
    rz: 0,
    ux: 0,
    uy: 1,
    uz: 0,
    bx: 0,
    by: 0,
    bz: 1,
    yaw: 0,
    pitch: 0,
  }));
}

const fa: TrackFrame = makeFrame();
const fb: TrackFrame = makeFrame();

/** Places every car on the track for a locomotive front at route distance `trainS`. */
export function computeCarPoses(route: Route, trainS: number, out: CarPose[]): CarPose[] {
  for (let i = 0; i < CONSIST.length; i++) {
    const car = CONSIST[i] as CarLayout;
    const p = out[i] as CarPose;
    const zf = car.zc + car.def.pivotFront;
    const zr = car.zc + car.def.pivotRear;
    route.frameAt(trainS - zf, fa);
    route.frameAt(trainS - zr, fb);
    // Back vector from the front pivot to the rear pivot.
    let bx = fb.x - fa.x;
    let by = fb.y - fa.y;
    let bz = fb.z - fa.z;
    const bl = Math.hypot(bx, by, bz) || 1;
    bx /= bl;
    by /= bl;
    bz /= bl;
    // Right = forward × up = up × back (world up), kept horizontal; then up = back × right.
    let rx = bz;
    let rz = -bx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    // up = back × right
    const ux = by * rz;
    const uy = bz * rx - bx * rz;
    const uz = -by * rx;
    // Centre: midpoint of pivots shifted to the car's centre along the back axis.
    const mid = (car.def.pivotFront + car.def.pivotRear) / 2;
    p.cx = (fa.x + fb.x) / 2 - bx * mid + ux * RAIL_TOP;
    p.cy = (fa.y + fb.y) / 2 - by * mid + uy * RAIL_TOP;
    p.cz = (fa.z + fb.z) / 2 - bz * mid + uz * RAIL_TOP;
    p.rx = rx;
    p.ry = 0;
    p.rz = rz;
    p.ux = ux;
    p.uy = uy;
    p.uz = uz;
    p.bx = bx;
    p.by = by;
    p.bz = bz;
    // Forward = -back; three.js yaw of forward f: atan2(-f.x, -f.z) = atan2(bx, bz).
    p.yaw = Math.atan2(bx, bz);
    p.pitch = Math.asin(-by);
  }
  return out;
}

/** Which car (and blend toward the next car) a train-space z belongs to. */
export function carAt(z: number): { index: number; next: number; t: number } {
  for (let i = 0; i < CONSIST.length; i++) {
    const car = CONSIST[i] as CarLayout;
    if (z <= car.z1) {
      if (i > 0 && z < car.z0) {
        const prev = CONSIST[i - 1] as CarLayout;
        return { index: i - 1, next: i, t: (z - prev.z1) / (car.z0 - prev.z1) };
      }
      return { index: i, next: i, t: 0 };
    }
  }
  return { index: CONSIST.length - 1, next: CONSIST.length - 1, t: 0 };
}

function carLocalToWorld(p: CarPose, x: number, y: number, zl: number, out: Vec3): Vec3 {
  out.x = p.cx + p.rx * x + p.ux * y + p.bx * zl;
  out.y = p.cy + p.ry * x + p.uy * y + p.by * zl;
  out.z = p.cz + p.rz * x + p.uz * y + p.bz * zl;
  return out;
}

const tmpA: Vec3 = { x: 0, y: 0, z: 0 };
const tmpB: Vec3 = { x: 0, y: 0, z: 0 };

/** Maps a train-space point to world space (rigid per car, blended across the gaps). */
export function trainToWorld(poses: CarPose[], x: number, y: number, z: number, out: Vec3): Vec3 {
  const c = carAt(z);
  const a = CONSIST[c.index] as CarLayout;
  carLocalToWorld(poses[c.index] as CarPose, x, y, z - a.zc, tmpA);
  if (c.next === c.index) {
    out.x = tmpA.x;
    out.y = tmpA.y;
    out.z = tmpA.z;
    return out;
  }
  const nb = CONSIST[c.next] as CarLayout;
  carLocalToWorld(poses[c.next] as CarPose, x, y, z - nb.zc, tmpB);
  out.x = tmpA.x + (tmpB.x - tmpA.x) * c.t;
  out.y = tmpA.y + (tmpB.y - tmpA.y) * c.t;
  out.z = tmpA.z + (tmpB.z - tmpA.z) * c.t;
  return out;
}

/** Car yaw at a train-space z (blended across gaps), for converting look directions. */
export function trainYawAt(poses: CarPose[], z: number): number {
  const c = carAt(z);
  const ya = (poses[c.index] as CarPose).yaw;
  if (c.next === c.index) return ya;
  let yb = (poses[c.next] as CarPose).yaw;
  if (yb - ya > Math.PI) yb -= Math.PI * 2;
  else if (yb - ya < -Math.PI) yb += Math.PI * 2;
  return ya + (yb - ya) * c.t;
}

/** Rotates a train-space vector into world space using the car at z. */
export function trainDirToWorld(
  poses: CarPose[],
  z: number,
  x: number,
  y: number,
  zv: number,
  out: Vec3,
): Vec3 {
  const p = poses[carAt(z).index] as CarPose;
  out.x = p.rx * x + p.ux * y + p.bx * zv;
  out.y = p.ry * x + p.uy * y + p.by * zv;
  out.z = p.rz * x + p.uz * y + p.bz * zv;
  return out;
}

/** Rotates a world vector into train space using the car at z. */
export function worldDirToTrain(
  poses: CarPose[],
  z: number,
  x: number,
  y: number,
  zv: number,
  out: Vec3,
): Vec3 {
  const p = poses[carAt(z).index] as CarPose;
  out.x = p.rx * x + p.ry * y + p.rz * zv;
  out.y = p.ux * x + p.uy * y + p.uz * zv;
  out.z = p.bx * x + p.by * y + p.bz * zv;
  return out;
}

/**
 * Maps a world point into train space. Picks the car whose local frame contains the
 * point (or the nearest one). Exact inverse of trainToWorld on the cars themselves.
 */
export function worldToTrain(
  poses: CarPose[],
  wx: number,
  wy: number,
  wz: number,
  out: Vec3,
): Vec3 {
  let bestErr = Infinity;
  for (let i = 0; i < CONSIST.length; i++) {
    const car = CONSIST[i] as CarLayout;
    const p = poses[i] as CarPose;
    const dx = wx - p.cx;
    const dy = wy - p.cy;
    const dz = wz - p.cz;
    const lx = p.rx * dx + p.ry * dy + p.rz * dz;
    const ly = p.ux * dx + p.uy * dy + p.uz * dz;
    const lz = p.bx * dx + p.by * dy + p.bz * dz;
    const half = car.def.length / 2;
    const err = Math.max(0, Math.abs(lz) - half);
    if (err < bestErr) {
      bestErr = err;
      out.x = lx;
      out.y = ly;
      out.z = lz + car.zc;
      if (err === 0) break;
    }
  }
  return out;
}
