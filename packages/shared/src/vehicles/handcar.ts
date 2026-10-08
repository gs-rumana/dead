import { type Route, type TrackFrame, makeFrame } from '../worldgen/route.ts';
import { RAIL_TOP } from './consist.ts';

/** Handcar tuning (§4.4). */
export const HANDCAR = {
  /**
   * Top speed with 1..4 people pumping. The plan's 4–9 m/s can't make a 1–3 minute
   * round trip on a 300–800 m spur for a solo player, so these start higher.
   */
  speeds: [0, 6, 7.5, 9, 10.5],
  accel: 1.6,
  coastDecel: 0.35,
  brakeDecel: 3.5,
  /** Stamina per second while pumping. */
  pumpStamina: 9,
  seats: 4,
  /** Bulky cargo slots on the handcar, plus more with a trolley. */
  slots: 2,
  trolleySlots: 2,
  /** Where it waits on the spur's siding. */
  parkS: 22,
  deck: 0.75,
  length: 2.6,
} as const;

/** Seat positions in handcar-local coordinates (x right, z back, y up from rail tops). */
export const HANDCAR_SEATS: Array<{ x: number; z: number; yaw: number }> = [
  { x: -0.55, z: -0.55, yaw: 0 },
  { x: 0.55, z: -0.55, yaw: 0 },
  { x: -0.55, z: 0.55, yaw: Math.PI },
  { x: 0.55, z: 0.55, yaw: Math.PI },
];

/** Cargo slots: two on the handcar's ends, two on the trolley behind it. */
export const HANDCAR_SLOTS: Array<{ x: number; z: number }> = [
  { x: 0, z: -1.15 },
  { x: 0, z: 1.15 },
  { x: -0.45, z: 3.0 },
  { x: 0.45, z: 3.0 },
];

export interface HandcarPose {
  x: number;
  y: number;
  z: number;
  /** three.js yaw of the handcar's forward (+s) direction. */
  yaw: number;
  rx: number;
  rz: number;
  fx: number;
  fz: number;
}

const tf: TrackFrame = makeFrame();

/** World pose of a handcar at distance s along its spur. */
export function handcarPose(spur: Route, s: number, out: HandcarPose): HandcarPose {
  spur.frameAt(s, tf);
  out.x = tf.x;
  out.y = tf.y + RAIL_TOP;
  out.z = tf.z;
  out.yaw = -tf.heading;
  out.rx = tf.rx;
  out.rz = tf.rz;
  out.fx = tf.tx;
  out.fz = tf.tz;
  return out;
}

export function makeHandcarPose(): HandcarPose {
  return { x: 0, y: 0, z: 0, yaw: 0, rx: 1, rz: 0, fx: 0, fz: -1 };
}

/** Handcar-local point to world (local -z is forward along +s). */
export function handcarToWorld(
  p: HandcarPose,
  lx: number,
  ly: number,
  lz: number,
  out: { x: number; y: number; z: number },
) {
  out.x = p.x + p.rx * lx - p.fx * lz;
  out.y = p.y + ly;
  out.z = p.z + p.rz * lx - p.fz * lz;
  return out;
}
