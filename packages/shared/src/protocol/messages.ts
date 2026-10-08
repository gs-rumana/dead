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
export type Command =
  | { t: 'nudge' }
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
}

/** One-shot events (sounds, effects) the host sends alongside state patches. */
export type GameEvent =
  { e: 'whistle' } | { e: 'stoke'; by: string } | { e: 'toast'; text: string; to?: string };

/** Host → client messages. */
export interface ServerMessages {
  events: GameEvent[];
  pong: number;
  welcome: { selfId: string; seed: number; code: string; protocol: number };
}
