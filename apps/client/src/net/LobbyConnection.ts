import { Client, type Room } from '@colyseus/sdk';
import { type JoinOptions, LOBBY_ROOM, LobbyState } from '@dead-tracks/shared';
import { Emitter } from './Connection.ts';

/** The party lobby (§6.8 LobbyRoom): members, classes, ready flags, then the run. */
export class LobbyConnection {
  private readonly changed = new Emitter<[]>();
  private readonly closed = new Emitter<[string]>();

  private constructor(private readonly room: Room<any, LobbyState>) {
    room.onStateChange(() => this.changed.emit());
    room.onLeave((code: number, reason?: string) => this.closed.emit(reason || `left (${code})`));
  }

  static async create(serverUrl: string, opts: JoinOptions, seed?: number): Promise<LobbyConnection> {
    const client = new Client(serverUrl);
    const room = await client.create(LOBBY_ROOM, { ...opts, ...(seed === undefined ? {} : { seed }) }, LobbyState);
    return new LobbyConnection(room);
  }

  static async join(serverUrl: string, code: string, opts: JoinOptions): Promise<LobbyConnection> {
    const client = new Client(serverUrl);
    return new LobbyConnection(await client.joinById(code, opts, LobbyState));
  }

  get state(): LobbyState {
    return this.room.state;
  }

  get selfId(): string {
    return this.room.sessionId;
  }

  get code(): string {
    return this.room.roomId;
  }

  get isHost(): boolean {
    return this.room.state.host === this.room.sessionId;
  }

  onChange(cb: () => void) {
    return this.changed.on(cb);
  }

  onClose(cb: (reason: string) => void) {
    return this.closed.on(cb);
  }

  setClass(cls: string): void {
    this.room.send('cls', cls);
  }

  setReady(ready: boolean): void {
    this.room.send('ready', ready);
  }

  start(): void {
    this.room.send('start');
  }

  leave(): void {
    void this.room.leave();
  }
}
