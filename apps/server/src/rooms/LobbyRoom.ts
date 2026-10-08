import { Room, matchMaker, type Client } from '@colyseus/core';
import {
  type JoinOptions,
  LobbyMember,
  LobbyState,
  MAX_PARTY,
  PROTOCOL_VERSION,
  RUN_ROOM,
  isClassId,
} from '@dead-tracks/shared';
import type { AccountInfo } from '@dead-tracks/sim/host';
import { services } from '../services.ts';
import { randomCode } from './codes.ts';

/** How long a finished or abandoned lobby lingers so late joiners get a clear answer. */
const IDLE_MS = 2 * 60_000;

/**
 * Party formation (§6.8): the party code points here. Players pick classes they've
 * unlocked; the leader starts the run, and everyone moves to the RunRoom. The lobby
 * stays up while the run lives so the code keeps working for drop-in players.
 */
export class LobbyRoom extends Room<{ state: LobbyState }> {
  override maxClients = MAX_PARTY;
  override maxMessagesPerSecond = 20;
  private emptySince = 0;
  private seed: number | undefined;

  override async onCreate(options: { seed?: number }): Promise<void> {
    this.roomId = await this.uniqueCode();
    this.autoDispose = false;
    this.seed = typeof options?.seed === 'number' ? options.seed >>> 0 : undefined;
    this.state = new LobbyState();
    this.state.code = this.roomId;
    this.state.host = '';
    this.state.runId = '';
    this.onMessage('cls', (client, cls: unknown) => {
      const m = this.state.members.get(client.sessionId);
      const acc = (client.auth as { account: AccountInfo | null } | undefined)?.account;
      if (!m || !isClassId(cls)) return;
      if (cls !== 'drifter' && acc && !acc.classes.includes(cls)) return;
      if (cls !== 'drifter' && !acc && !services.allowDev) return;
      m.cls = cls;
    });
    this.onMessage('ready', (client, ready: unknown) => {
      const m = this.state.members.get(client.sessionId);
      if (m) m.ready = ready === true;
    });
    this.onMessage('start', async (client) => {
      if (client.sessionId !== this.state.host || this.state.runId) return;
      const run = await matchMaker.createRoom(RUN_ROOM, {
        party: this.roomId,
        ...(this.seed === undefined ? {} : { seed: this.seed }),
      });
      this.state.runId = run.roomId;
      // Drop-in players find the run through the party code (§4.14).
      await this.setMetadata({ runId: run.roomId });
    });
    // Close once nobody is here and the run (if any) is over.
    this.clock.setInterval(async () => {
      if (this.clients.length > 0) {
        this.emptySince = 0;
        return;
      }
      this.emptySince ||= Date.now();
      if (Date.now() - this.emptySince < IDLE_MS) return;
      if (this.state.runId) {
        const alive = await matchMaker.query({ roomId: this.state.runId });
        if (alive.length > 0) return;
      }
      void this.disconnect();
    }, 10_000);
  }

  override async onAuth(_client: Client, options: JoinOptions): Promise<{ account: AccountInfo | null }> {
    if (options?.protocol !== PROTOCOL_VERSION)
      throw new Error(`protocol mismatch: client ${options?.protocol}, host ${PROTOCOL_VERSION}`);
    const account = services.accounts ? await services.accounts.accountInfo(options.token) : null;
    return { account };
  }

  override onJoin(client: Client, options: JoinOptions): void {
    const acc = (client.auth as { account: AccountInfo | null }).account;
    const m = new LobbyMember();
    m.name = acc?.name || (options.name ?? '').trim().slice(0, 20) || `Drifter ${this.clients.length}`;
    const want = isClassId(options.cls) ? options.cls : 'drifter';
    m.cls = want === 'drifter' || (acc ? acc.classes.includes(want) : services.allowDev) ? want : 'drifter';
    m.ready = false;
    this.state.members.set(client.sessionId, m);
    if (!this.state.host) this.state.host = client.sessionId;
  }

  override onLeave(client: Client): void {
    this.state.members.delete(client.sessionId);
    if (this.state.host === client.sessionId) this.state.host = [...this.state.members.keys()][0] ?? '';
  }

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = randomCode();
      if ((await matchMaker.query({ roomId: code })).length === 0) return code;
    }
    return randomCode(6);
  }
}
