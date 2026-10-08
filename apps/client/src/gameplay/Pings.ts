import * as THREE from 'three/webgpu';
import {
  type GameEvent,
  PING_MARK,
  PING_SECONDS,
  PINGS,
  type PhysicsSpace,
  rayVsEnemy,
} from '@dead-tracks/shared';
import type { EnemyView } from './EnemyView.ts';

export interface ActivePing {
  by: string;
  kind: number;
  x: number;
  y: number;
  z: number;
  target?: string;
  until: number;
}

/** Wheel sectors, clockwise from the top. */
const WHEEL = [0, 1, 2, 3, 4, 5];

/**
 * The ping wheel (§4.14): hold the ping key (Z / middle mouse) and flick toward a
 * call-out, or tap it to mark what's under the crosshair. Pings show as world
 * markers and on everyone's compass.
 */
export class Pings {
  open = false;
  /** Selected wheel sector, -1 for none. */
  sel = -1;
  private wx = 0;
  private wy = 0;
  private wasHeld = false;
  readonly active: ActivePing[] = [];
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly send: (kind: number, x: number, y: number, z: number, target?: string) => void,
    private readonly camera: THREE.Camera,
    private readonly origin: () => { x: number; z: number },
    private readonly space: PhysicsSpace,
    private readonly enemies: EnemyView,
  ) {}

  /**
   * Feeds the wheel. Returns true while the wheel is open (the caller then uses the
   * look deltas for picking instead of turning the camera).
   */
  update(held: boolean, lookDx: number, lookDy: number): boolean {
    const now = performance.now();
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i]!.until < now) this.active.splice(i, 1);
    if (held && !this.wasHeld) {
      this.open = true;
      this.wx = this.wy = 0;
      this.sel = -1;
    }
    if (held && this.open) {
      this.wx += lookDx;
      this.wy += lookDy;
      const len = Math.hypot(this.wx, this.wy);
      if (len > 40) {
        // Clamp so a flick back changes the choice quickly.
        if (len > 120) {
          this.wx = (this.wx / len) * 120;
          this.wy = (this.wy / len) * 120;
        }
        const a = Math.atan2(this.wx, -this.wy); // 0 = up, clockwise
        this.sel = WHEEL[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / 6)) % 6]!;
      } else this.sel = -1;
    }
    if (!held && this.wasHeld && this.open) {
      this.open = false;
      const t = this.target();
      if (this.sel >= 0) this.send(this.sel, t.x, t.y, t.z, t.enemy);
      else this.send(t.enemy ? 4 : PING_MARK, t.x, t.y, t.z, t.enemy);
    }
    this.wasHeld = held;
    return this.open;
  }

  /** Touch: pick a sector directly (or -1 to mark). */
  pick(kind: number): void {
    const t = this.target();
    this.send(kind >= 0 ? kind : t.enemy ? 4 : PING_MARK, t.x, t.y, t.z, t.enemy);
  }

  /** Where the crosshair points: the first enemy or surface within 300 m. */
  target(): { x: number; y: number; z: number; enemy?: string } {
    const o = this.origin();
    const c = this.camera.position;
    const cx = c.x + o.x;
    const cy = c.y;
    const cz = c.z + o.z;
    const d = this.camera.getWorldDirection(this.dir);
    let t = 300;
    const hit = this.space.rayGround(cx, cy, cz, d.x, d.y, d.z, 300);
    if (hit) t = hit.toi;
    let enemy: string | undefined;
    this.enemies.forEach((id, type, x, y, z, dead) => {
      if (dead) return;
      const h = rayVsEnemy(type, x, y, z, cx, cy, cz, d.x, d.y, d.z, t);
      if (h && h.t < t) {
        t = h.t;
        enemy = id;
      }
    });
    t = Math.min(t, 300);
    return { x: cx + d.x * t, y: cy + d.y * t, z: cz + d.z * t, ...(enemy ? { enemy } : {}) };
  }

  onEvent(ev: Extract<GameEvent, { e: 'ping' }>): void {
    // One live ping per player.
    const i = this.active.findIndex((p) => p.by === ev.by);
    if (i >= 0) this.active.splice(i, 1);
    this.active.push({
      by: ev.by,
      kind: ev.kind,
      x: ev.x,
      y: ev.y,
      z: ev.z,
      ...(ev.target ? { target: ev.target } : {}),
      until: performance.now() + PING_SECONDS * 1000,
    });
  }

  static label(kind: number): string {
    return PINGS[kind] ?? '';
  }
}

/** Icons for markers and the compass. */
export const PING_ICONS = ['⛽', '!', '✋', '➜', '☠', '✚', '◆'];
