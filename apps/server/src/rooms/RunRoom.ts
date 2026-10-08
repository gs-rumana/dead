import { Room, matchMaker, type Client } from '@colyseus/core';
import { type JoinOptions, type RunState, MAX_PARTY, PATCH_MS, SIM_DT } from '@dead-tracks/shared';
import { type HostClient, RunHost } from '@dead-tracks/sim/host';
import { randomCode } from './codes.ts';

export interface RunRoomOptions {
  seed?: number;
}

/** A Colyseus room that is a thin adapter over RunHost (§6.5). One room per party. */
export class RunRoom extends Room<{ state: RunState }> {
  override maxClients = MAX_PARTY;
  override patchRate = PATCH_MS;

  private host!: RunHost;
  private readonly hostClients = new Map<string, HostClient>();
  private accumulator = 0;

  override async onCreate(options: RunRoomOptions): Promise<void> {
    this.roomId = await this.uniqueCode();
    const seed =
      typeof options.seed === 'number' ? options.seed >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    this.host = new RunHost({ seed, code: this.roomId });
    this.state = this.host.state;

    this.onMessage('*', (client: Client, type: string | number, message: unknown) => {
      const hc = this.hostClients.get(client.sessionId);
      if (hc) this.host.message(hc, String(type), message);
    });

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), 1000 / 60);
  }

  override onJoin(client: Client, options: JoinOptions): void {
    const hc: HostClient = {
      id: client.sessionId,
      send: (type, msg) => client.send(type, msg),
    };
    this.hostClients.set(client.sessionId, hc);
    this.host.join(hc, options);
  }

  override onLeave(client: Client): void {
    const hc = this.hostClients.get(client.sessionId);
    if (!hc) return;
    this.hostClients.delete(client.sessionId);
    this.host.leave(hc);
  }

  /** Fixed 30 Hz simulation driven by a faster wall-clock timer. */
  private tick(deltaMs: number): void {
    this.accumulator += Math.min(deltaMs / 1000, 0.25);
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < 4) {
      this.host.step(SIM_DT);
      this.accumulator -= SIM_DT;
      steps++;
    }
    if (steps === 4) this.accumulator = 0;
  }

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = randomCode();
      const existing = await matchMaker.query({ roomId: code });
      if (existing.length === 0) return code;
    }
    return randomCode(6);
  }
}
