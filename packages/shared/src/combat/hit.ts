import { ENEMIES, type EnemyType } from '../data/enemies.ts';
import { hashFloat, hashInts } from '../math/rng.ts';

/** Seed for a shot's pellet spread; client and host derive it from the shot number. */
export function shotSeed(seq: number): number {
  return hashInts(0x5eed, seq >>> 0);
}

/** Hit zones (§4.7: headshots ×2). */
export const Zone = { Body: 0, Head: 1, Limb: 2 } as const;
export type ZoneId = (typeof Zone)[keyof typeof Zone];

export interface RayHit {
  t: number;
  zone: ZoneId;
}

/**
 * Ray against an enemy's hitbox: a vertical capsule for the body and a sphere for
 * the head, scaled with the enemy. (x, y, z) is the enemy's feet. Direction must be
 * normalised. Shared so the client's claim and the host's check agree.
 */
export function rayVsEnemy(
  type: EnemyType,
  x: number,
  y: number,
  z: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): RayHit | null {
  const s = ENEMIES[type].scale;
  // Head sphere above the shoulders.
  const head = raySphere(ox, oy, oz, dx, dy, dz, x, y + 1.66 * s, z, 0.16 * s);
  // Body: capsule from the shins to the shoulders (top cap ends at the neck).
  const body = rayCapsuleY(ox, oy, oz, dx, dy, dz, x, y + 0.28 * s, y + 1.27 * s, z, 0.28 * s);
  let best: RayHit | null = null;
  if (head !== null && head <= maxT) best = { t: head, zone: Zone.Head };
  if (body !== null && body <= maxT && (!best || body < best.t - 0.02)) {
    const hitY = oy + dy * body - y;
    // How far the ray passes from the body's axis: glancing shots hit the arms.
    const hl = Math.hypot(dx, dz);
    const miss = hl > 1e-6 ? Math.abs((x - ox) * (dz / hl) - (z - oz) * (dx / hl)) : 0;
    const zone: ZoneId = hitY < 0.82 * s || miss > 0.18 * s ? Zone.Limb : Zone.Body;
    best = { t: body, zone };
  }
  return best;
}

function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number | null {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

/** Ray vs a vertical capsule (segment y0..y1 at x, z, radius r). */
function rayCapsuleY(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  x: number,
  y0: number,
  y1: number,
  z: number,
  r: number,
): number | null {
  // Infinite cylinder first.
  const px = ox - x;
  const pz = oz - z;
  const a = dx * dx + dz * dz;
  let best: number | null = null;
  if (a > 1e-9) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const hy = oy + dy * t;
      if (t >= 0 && hy >= y0 && hy <= y1) best = t;
    }
  }
  for (const cy of [y0, y1]) {
    const t = raySphere(ox, oy, oz, dx, dy, dz, x, cy, z, r);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/**
 * Deterministic spread for a shot: both sides derive the same pellet directions
 * from the shot sequence number. Returns unit vectors.
 */
export function shotDirections(
  dx: number,
  dy: number,
  dz: number,
  spread: number,
  pellets: number,
  seed: number,
): Array<[number, number, number]> {
  // Orthonormal basis around the aim direction.
  let ux = 0;
  let uy = 1;
  const uz = 0;
  if (Math.abs(dy) > 0.95) {
    ux = 1;
    uy = 0;
  }
  // right = d × up
  let rx = dy * uz - dz * uy;
  let ry = dz * ux - dx * uz;
  let rz = dx * uy - dy * ux;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  // up' = right × d
  const vx = ry * dz - rz * dy;
  const vy = rz * dx - rx * dz;
  const vz = rx * dy - ry * dx;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < pellets; i++) {
    // Uniform in a disc of radius `spread` (small-angle).
    const a = hashFloat(seed, i, 1) * Math.PI * 2;
    const r = Math.sqrt(hashFloat(seed, i, 2)) * spread;
    const ox = Math.cos(a) * r;
    const oy = Math.sin(a) * r;
    let x = dx + rx * ox + vx * oy;
    let y = dy + ry * ox + vy * oy;
    let z = dz + rz * ox + vz * oy;
    const l = Math.hypot(x, y, z);
    x /= l;
    y /= l;
    z /= l;
    out.push([x, y, z]);
  }
  return out;
}

/** Vertical drop of a bullet after travelling `dist` metres (§4.7: slight drop at range). */
export function bulletDrop(drop: number, speed: number, dist: number): number {
  if (drop <= 0 || speed <= 0) return 0;
  const t = dist / speed;
  return 0.5 * drop * t * t;
}
