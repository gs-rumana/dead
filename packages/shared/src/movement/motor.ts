import type RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER } from '../data/player.ts';
import { clamp } from '../math/scalar.ts';
import type { Vec3 } from '../math/vec.ts';
import { Frame } from '../protocol/constants.ts';
import { Btn, type InputFrame } from '../protocol/input.ts';
import { insideTrainBounds } from '../vehicles/consist.ts';
import {
  type CarPose,
  trainDirToWorld,
  trainToWorld,
  trainYawAt,
  worldDirToTrain,
  worldToTrain,
} from '../vehicles/trainPose.ts';
import { Group, type PhysicsSpace, SOLID_FILTER, groups } from './physics.ts';

/**
 * Everything needed to replay a player's movement exactly (client prediction and
 * server simulation share this code, §6.8).
 */
export interface MotorState {
  frame: number;
  /** Position of the feet: world (absolute) or train space, per `frame`. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Look direction relative to `frame`. */
  yaw: number;
  pitch: number;
  grounded: boolean;
  stamina: number;
  airTime: number;
  /** Seconds left in a mantle (climb onto a ledge), 0 when not mantling. */
  mantle: number;
  mx: number;
  my: number;
  mz: number;
  prevButtons: number;
  /** Locked at the locomotive controls. */
  driving: boolean;
  sprinting: boolean;
}

export function makeMotorState(): MotorState {
  return {
    frame: Frame.World,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    grounded: false,
    stamina: PLAYER.maxStamina,
    airTime: 0,
    mantle: 0,
    mx: 0,
    my: 0,
    mz: 0,
    prevButtons: 0,
    driving: false,
    sprinting: false,
  };
}

export function copyMotorState(out: MotorState, s: MotorState): MotorState {
  return Object.assign(out, s);
}

/** What the motor needs to know about the world this tick. */
export interface MotorContext {
  space: PhysicsSpace;
  poses: CarPose[];
  /** Train speed along the track (m/s, signed). */
  trainSpeed: number;
}

const tmp: Vec3 = { x: 0, y: 0, z: 0 };
const tmp2: Vec3 = { x: 0, y: 0, z: 0 };
const CAPSULE_CENTRE = PLAYER.radius + PLAYER.halfHeight;

/** World velocity of the train at a train-space z (forward = -back). */
function trainVelocity(ctx: MotorContext, z: number, out: Vec3): Vec3 {
  trainDirToWorld(ctx.poses, z, 0, 0, -1, out);
  out.x *= ctx.trainSpeed;
  out.y *= ctx.trainSpeed;
  out.z *= ctx.trainSpeed;
  return out;
}

export function toTrainFrame(ctx: MotorContext, st: MotorState): void {
  if (st.frame === Frame.Train) return;
  worldToTrain(ctx.poses, st.x, st.y, st.z, tmp);
  const tz = tmp.z;
  trainVelocity(ctx, tz, tmp2);
  const yawOffset = trainYawAt(ctx.poses, tz);
  const vx = st.vx - tmp2.x;
  const vy = st.vy - tmp2.y;
  const vz = st.vz - tmp2.z;
  st.x = tmp.x;
  st.y = tmp.y;
  st.z = tz;
  worldDirToTrain(ctx.poses, tz, vx, vy, vz, tmp);
  st.vx = tmp.x;
  st.vy = tmp.y;
  st.vz = tmp.z;
  st.yaw -= yawOffset;
  if (st.mantle > 0) {
    worldToTrain(ctx.poses, st.mx, st.my, st.mz, tmp);
    st.mx = tmp.x;
    st.my = tmp.y;
    st.mz = tmp.z;
  }
  st.frame = Frame.Train;
}

export function toWorldFrame(ctx: MotorContext, st: MotorState): void {
  if (st.frame === Frame.World) return;
  const tz = st.z;
  const yawOffset = trainYawAt(ctx.poses, tz);
  trainDirToWorld(ctx.poses, tz, st.vx, st.vy, st.vz, tmp2);
  trainVelocity(ctx, tz, tmp);
  st.vx = tmp2.x + tmp.x;
  st.vy = tmp2.y + tmp.y;
  st.vz = tmp2.z + tmp.z;
  trainToWorld(ctx.poses, st.x, st.y, st.z, tmp);
  st.x = tmp.x;
  st.y = tmp.y;
  st.z = tmp.z;
  st.yaw += yawOffset;
  st.frame = Frame.World;
}

/** Converts an input's yaw to the frame the motor is in (they differ right after a switch). */
function inputYaw(ctx: MotorContext, st: MotorState, input: InputFrame): number {
  if (input.frame === st.frame) return input.yaw;
  const off = trainYawAt(ctx.poses, st.frame === Frame.Train ? st.z : 0);
  return st.frame === Frame.Train ? input.yaw - off : input.yaw + off;
}

/** Advances one player by one fixed step. */
export function stepMotor(ctx: MotorContext, st: MotorState, input: InputFrame, dt: number): void {
  const pressed = input.buttons & ~st.prevButtons;
  st.prevButtons = input.buttons;
  st.yaw = inputYaw(ctx, st, input);
  st.pitch = clamp(input.pitch, -1.5, 1.5);

  if (st.driving) {
    st.vx = st.vy = st.vz = 0;
    st.grounded = true;
    st.sprinting = false;
    regen(st, dt);
    return;
  }

  if (st.mantle > 0) {
    const t = Math.min(dt / st.mantle, 1);
    st.x += (st.mx - st.x) * t;
    st.y += (st.my - st.y) * t;
    st.z += (st.mz - st.z) * t;
    st.mantle = Math.max(0, st.mantle - dt);
    st.vx = st.vy = st.vz = 0;
    if (st.mantle === 0) {
      st.x = st.mx;
      st.y = st.my;
      st.z = st.mz;
      st.grounded = true;
    }
    return;
  }

  // Wish velocity in the frame's horizontal plane.
  const sin = Math.sin(st.yaw);
  const cos = Math.cos(st.yaw);
  let ix = input.mx;
  let iy = input.my;
  const il = Math.hypot(ix, iy);
  if (il > 1) {
    ix /= il;
    iy /= il;
  }
  const wantsSprint = (input.buttons & Btn.Sprint) !== 0 && iy > 0.3 && st.stamina > 1;
  st.sprinting = wantsSprint && st.grounded;
  let speed: number = PLAYER.walkSpeed;
  if (input.buttons & Btn.Aim) speed = PLAYER.aimSpeed;
  else if (wantsSprint) speed = PLAYER.sprintSpeed;
  const wx = (ix * cos - iy * sin) * speed;
  const wz = (-ix * sin - iy * cos) * speed;
  const accel = (st.grounded ? PLAYER.groundAccel : PLAYER.airAccel) * dt;
  const dvx = wx - st.vx;
  const dvz = wz - st.vz;
  const dl = Math.hypot(dvx, dvz);
  if (dl <= accel) {
    st.vx = wx;
    st.vz = wz;
  } else {
    st.vx += (dvx / dl) * accel;
    st.vz += (dvz / dl) * accel;
  }

  if (st.sprinting) st.stamina = Math.max(0, st.stamina - PLAYER.sprintStaminaPerSec * dt);
  else regen(st, dt);

  // Jump or mantle.
  const canJump = st.grounded || st.airTime < 0.12;
  if (pressed & Btn.Jump) {
    if (tryMantle(ctx, st, sin, cos, 1.95)) return;
    if (canJump && st.stamina >= PLAYER.jumpStamina * 0.5) {
      st.vy = PLAYER.jumpSpeed;
      st.grounded = false;
      st.airTime = 1;
      st.stamina = Math.max(0, st.stamina - PLAYER.jumpStamina);
    }
  } else if (!st.grounded && input.buttons & Btn.Jump && st.vy < 2 && iy > 0.3) {
    // Holding jump into a ledge while airborne grabs it.
    if (tryMantle(ctx, st, sin, cos, 1.3)) return;
  }

  st.vy = Math.max(st.vy - PLAYER.gravity * dt, -PLAYER.maxFallSpeed);
  move(ctx, st, dt);
  st.airTime = st.grounded ? 0 : st.airTime + dt;

  // Frame switching (§6.8: players on vehicles sync in vehicle-local coordinates).
  if (st.frame === Frame.Train && !insideTrainBounds(st.x, st.y, st.z)) {
    toWorldFrame(ctx, st);
  }
}

function regen(st: MotorState, dt: number): void {
  st.stamina = Math.min(PLAYER.maxStamina, st.stamina + PLAYER.staminaRegenPerSec * dt);
}

function move(ctx: MotorContext, st: MotorState, dt: number): void {
  const { space } = ctx;
  const onTrain = st.frame === Frame.Train;
  const probe = onTrain ? space.trainProbe : space.groundProbe;
  const ctl = onTrain ? space.trainCtl : space.groundCtl;
  const ox = onTrain ? 0 : space.originX;
  const oz = onTrain ? 0 : space.originZ;
  probe.setTranslation({ x: st.x - ox, y: st.y + CAPSULE_CENTRE, z: st.z - oz });
  const desired = { x: st.vx * dt, y: st.vy * dt, z: st.vz * dt };
  ctl.computeColliderMovement(probe, desired, undefined, SOLID_FILTER);
  const m = ctl.computedMovement();
  st.x += m.x;
  st.y += m.y;
  st.z += m.z;
  const grounded = ctl.computedGrounded();
  if (grounded && st.vy <= 0) st.vy = 0;
  if (desired.y > 0 && m.y < desired.y * 0.5) st.vy = Math.min(st.vy, 0);
  // Horizontal blocking: keep velocity consistent with what actually happened.
  if (dt > 0) {
    const ax = m.x / dt;
    const az = m.z / dt;
    if (Math.abs(ax) < Math.abs(st.vx)) st.vx = ax;
    if (Math.abs(az) < Math.abs(st.vz)) st.vz = az;
  }
  st.grounded = grounded;

  if (!onTrain) {
    // Landing on the train hull switches into train space.
    let onHull = false;
    for (let i = 0; i < ctl.numComputedCollisions(); i++) {
      const c = ctl.computedCollision(i);
      if (c?.collider && space.isTrainCollider(c.collider) && c.normal1.y > 0.6) onHull = true;
    }
    if (onHull) toTrainFrame(ctx, st);
  }
}

/**
 * Climb onto a ledge in front (train decks, platforms, crates). Looks for a walkable
 * top between 0.5 m and `maxHeight` above the feet with room for the player.
 */
function tryMantle(
  ctx: MotorContext,
  st: MotorState,
  sin: number,
  cos: number,
  maxHeight: number,
): boolean {
  const { space } = ctx;
  const fx = -sin;
  const fz = -cos;
  const reach = PLAYER.radius + 0.5;
  const top = 2.2;
  const onTrain = st.frame === Frame.Train;
  const ox = st.x + fx * reach;
  const oy = st.y + top;
  const oz = st.z + fz * reach;
  const hit = onTrain
    ? space.rayTrain(ox, oy, oz, 0, -1, 0, top - 0.45)
    : space.rayGround(ox, oy, oz, 0, -1, 0, top - 0.45);
  if (!hit) return false;
  const ledge = top - hit.toi;
  if (ledge < 0.5 || ledge > maxHeight) return false;
  // Something solid must be in front just below the top (a ledge, not a slope).
  const wallY = st.y + Math.max(0.3, ledge - 0.3);
  const wall = onTrain
    ? space.rayTrain(st.x, wallY, st.z, fx, 0, fz, reach + 0.1)
    : space.rayGround(st.x, wallY, st.z, fx, 0, fz, reach + 0.1);
  if (!wall) return false;
  // Head room above the target.
  const tx = st.x + fx * (reach + 0.05);
  const ty = st.y + ledge + 0.03;
  const tz = st.z + fz * (reach + 0.05);
  if (!fits(ctx, onTrain, tx, ty, tz)) return false;
  st.mx = tx;
  st.my = ty;
  st.mz = tz;
  st.mantle = 0.22 + ledge * 0.12;
  st.vx = st.vy = st.vz = 0;
  st.grounded = false;
  if (!onTrain && space.isTrainCollider(hit.collider)) toTrainFrame(ctx, st);
  return true;
}

function fits(ctx: MotorContext, onTrain: boolean, x: number, y: number, z: number): boolean {
  const { space } = ctx;
  const world = onTrain ? space.train : space.ground;
  const ox = onTrain ? 0 : space.originX;
  const oz = onTrain ? 0 : space.originZ;
  const shape = new space.R.Capsule(PLAYER.halfHeight, PLAYER.radius - 0.04);
  let blocked = false;
  world.intersectionsWithShape(
    { x: x - ox, y: y + CAPSULE_CENTRE + 0.02, z: z - oz },
    { x: 0, y: 0, z: 0, w: 1 },
    shape,
    () => {
      blocked = true;
      return false;
    },
    undefined,
    groups(Group.Probe, Group.Env | Group.Train),
  );
  return !blocked;
}

export type { RAPIER };
