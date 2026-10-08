import { Client, type Room } from '@colyseus/sdk';
import {
  type ClientMessages,
  type GameEvent,
  type JoinOptions,
  RUN_ROOM,
  RunState,
} from '@dead-tracks/shared';
import { type Connection, Emitter, NetMeter } from './Connection.ts';
import { wsCounter } from './wsPatch.ts';

/** Multiplayer: the authoritative simulation runs in a Colyseus RunRoom (§6.8). */
export class ColyseusConnection implements Connection {
  readonly kind = 'online' as const;
  private readonly meter = new NetMeter();
  private readonly patch = new Emitter<[]>();
  private readonly events = new Emitter<[GameEvent[]]>();
  private readonly closed = new Emitter<[string]>();
  readonly status = new Emitter<['reconnecting' | 'connected']>();
  private pingTimer = 0;

  private constructor(private readonly room: Room<any, RunState>) {
    room.onStateChange(() => this.patch.emit());
    room.onMessage('events', (events: GameEvent[]) => this.events.emit(events));
    room.onMessage('pong', (sentAt: number) => this.meter.pong(sentAt));
    room.onMessage('welcome', () => {});
    room.onDrop(() => this.status.emit('reconnecting'));
    room.onReconnect(() => this.status.emit('connected'));
    room.onLeave((code: number, reason?: string) => {
      clearInterval(this.pingTimer);
      this.closed.emit(reason || `left (${code})`);
    });
    this.pingTimer = window.setInterval(() => this.send('ping', performance.now()), 2000);
  }

  get state(): RunState {
    return this.room.state;
  }

  get selfId(): string {
    return this.room.sessionId;
  }

  get code(): string {
    return this.room.roomId;
  }

  get stats() {
    return this.meter.stats;
  }

  /** Creates a new party room, or joins `code` when given. */
  static async connect(
    serverUrl: string,
    opts: JoinOptions,
    seed?: number,
  ): Promise<ColyseusConnection> {
    const client = new Client(serverUrl);
    const room = opts.code
      ? await client.joinById(opts.code, opts, RunState)
      : await client.create(
          RUN_ROOM,
          { ...opts, ...(seed === undefined ? {} : { seed }) },
          RunState,
        );
    // Don't flush a long backlog of stale inputs after a reconnect.
    room.reconnection.maxEnqueuedMessages = 8;
    room.reconnection.maxRetries = 30;
    const conn = new ColyseusConnection(room);
    wsCounter.target = conn.meter;
    return conn;
  }

  send<K extends keyof ClientMessages>(type: K, msg: ClientMessages[K]): void {
    this.room.send(type, msg);
  }

  onPatch(cb: () => void) {
    return this.patch.on(cb);
  }

  onEvents(cb: (events: GameEvent[]) => void) {
    return this.events.on(cb);
  }

  onClose(cb: (reason: string) => void) {
    return this.closed.on(cb);
  }

  close(): void {
    clearInterval(this.pingTimer);
    void this.room.leave(true);
  }
}
