import { PLAYER } from '../data/player.ts';
import { Frame } from '../protocol/constants.ts';
import { CONSIST, LOCO_FLOOR, type Interactable, trainInteractables } from './consist.ts';

const TRAIN_INTERACTABLES = trainInteractables();

export interface InteractTarget {
  id: Interactable['id'];
  prompt: string;
}

/**
 * The interactable a player is looking at, if any. Shared so the client's prompt
 * always matches what the host will do when Interact is pressed.
 */
export function findInteractable(
  frame: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): InteractTarget | null {
  if (frame !== Frame.Train) return null;
  const ex = x;
  const ey = y + PLAYER.eyeHeight;
  const ez = z;
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp;
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cp;
  let best: InteractTarget | null = null;
  let bestScore = -Infinity;
  for (const it of TRAIN_INTERACTABLES) {
    const dx = it.x - ex;
    const dy = it.y - ey;
    const dz = it.tz - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > it.radius + 0.6) continue;
    const facing = (dx * fx + dy * fy + dz * fz) / Math.max(d, 1e-3);
    if (facing < 0.35 && d > 0.7) continue;
    const score = facing - d * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = { id: it.id, prompt: it.prompt };
    }
  }
  return best;
}

/** Where the driver stands while at the controls (train space). */
export const DRIVER_SPOT = { x: 0.95, y: LOCO_FLOOR, z: CONSIST[0]!.zc + 3.6 } as const;
