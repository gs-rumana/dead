import type { ClientMessages, GameEvent, RunState } from '@dead-tracks/shared';

export interface NetStats {
  rttMs: number;
  /** Bytes per second, smoothed. */
  inRate: number;
  outRate: number;
}

/**
 * One interface for both transports (§6.5): the solo Web Worker and the Colyseus server.
 * The game reads `state` (a decoded RunState) and never knows which one it has.
 */
export interface Connection {
  readonly kind: 'solo' | 'online';
  readonly state: RunState;
  readonly selfId: string;
  readonly code: string;
  readonly stats: NetStats;
  send<K extends keyof ClientMessages>(type: K, msg: ClientMessages[K]): void;
  /** Called after each decoded state patch. */
  onPatch(cb: () => void): () => void;
  onEvents(cb: (events: GameEvent[]) => void): () => void;
  onClose(cb: (reason: string) => void): () => void;
  close(): void;
}

export class Emitter<A extends unknown[]> {
  private readonly listeners = new Set<(...args: A) => void>();

  on(cb: (...args: A) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(...args: A): void {
    for (const cb of this.listeners) cb(...args);
  }
}

/** Shared bookkeeping for both connection types: byte rates and ping. */
export class NetMeter {
  readonly stats: NetStats = { rttMs: 0, inRate: 0, outRate: 0 };
  private inBytes = 0;
  private outBytes = 0;
  private windowStart = performance.now();

  addIn(n: number): void {
    this.inBytes += n;
    this.roll();
  }

  addOut(n: number): void {
    this.outBytes += n;
    this.roll();
  }

  pong(sentAt: number): void {
    const rtt = performance.now() - sentAt;
    this.stats.rttMs = this.stats.rttMs === 0 ? rtt : this.stats.rttMs * 0.7 + rtt * 0.3;
  }

  private roll(): void {
    const now = performance.now();
    const elapsed = (now - this.windowStart) / 1000;
    if (elapsed < 1) return;
    this.stats.inRate = this.inBytes / elapsed;
    this.stats.outRate = this.outBytes / elapsed;
    this.inBytes = 0;
    this.outBytes = 0;
    this.windowStart = now;
  }
}
