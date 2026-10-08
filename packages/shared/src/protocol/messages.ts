import type { InputWire } from './input.ts';

/** Options a client sends when joining a run. */
export interface JoinOptions {
  name?: string;
  protocol: number;
  /** Party code when joining a specific room. */
  code?: string;
  seed?: number;
}

/** Discrete commands that are not part of the per-tick input stream. */
/** A claimed hit on an enemy (host re-checks it, §6.8). */
export interface ClaimedHit {
  /** Enemy id. */
  e: string;
  /** Pellet index for shotguns. */
  p: number;
}

export type Command =
  | { t: 'nudge' }
  /** A shot from the held gun: eye position and aim direction in world space. */
  | {
      t: 'fire';
      seq: number;
      ox: number;
      oy: number;
      oz: number;
      dx: number;
      dy: number;
      dz: number;
      aim: boolean;
      hits: ClaimedHit[];
    }
  | { t: 'melee'; dx: number; dz: number }
  | { t: 'throw'; dx: number; dy: number; dz: number }
  | { t: 'equip'; slot: number }
  | { t: 'reload' }
  /** Use meds on yourself. */
  | { t: 'heal' }
  | { t: 'drive'; on: boolean }
  | { t: 'reverser' }
  | { t: 'stoke' }
  | { t: 'respawn' }
  | { t: 'dev'; action: string; value?: number };

/** Client → host messages. */
export interface ClientMessages {
  input: InputWire;
  cmd: Command;
  ping: number;
  /** Seconds between what this client renders and the present (RTT/2 + interpolation). */
  viewDelay: number;
}

/** One-shot events (sounds, effects) the host sends alongside state patches. */
export type GameEvent =
  | { e: 'whistle' }
  | { e: 'stoke'; by: string }
  | { e: 'toast'; text: string; to?: string }
  /** Someone fired (others show flash, tracer, sound). */
  | {
      e: 'shot';
      by: string;
      w: string;
      ox: number;
      oy: number;
      oz: number;
      dx: number;
      dy: number;
      dz: number;
    }
  /** An enemy was hit. */
  | {
      e: 'hit';
      id: string;
      by: string;
      zone: number;
      x: number;
      y: number;
      z: number;
      kill: boolean;
      dmg: number;
    }
  | { e: 'swing'; by: string; w: string }
  | { e: 'explode'; x: number; y: number; z: number; r: number; holy: boolean }
  /** A player took damage (camera shake, red flash). */
  | { e: 'hurt'; id: string; dmg: number; fx: number; fz: number }
  | { e: 'downed'; id: string }
  | { e: 'revived'; id: string; by: string }
  | { e: 'died'; id: string }
  | { e: 'respawned'; id: string }
  | { e: 'enemyAttack'; id: string };

/** Host → client messages. */
export interface ServerMessages {
  events: GameEvent[];
  pong: number;
  welcome: { selfId: string; seed: number; code: string; protocol: number };
}
