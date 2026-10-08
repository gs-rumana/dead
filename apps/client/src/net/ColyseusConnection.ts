import { Client, type Room } from '@colyseus/sdk';
import {
  type ClientMessages,
  type GameEvent,
  type JoinOptions,
  RUN_ROOM,
  RunState,
} from '@dead-tracks/shared';
import { type Connection, Emitter, NetMeter } from './Connection.ts';

/** Multiplayer: the authoritative simulation runs in a Colyseus RunRoom (§6.8). */
export class ColyseusConnection implements Connection {
  readonly kind = 'online' as const;
  private readonly meter = new NetMeter();
  private readonly patch = new Emitter<[]>();
  private readonly events = new Emitter<[GameEvent[]]>();
  private readonly closed = new Emitter<[string]>();
  private pingTimer = 0;

  private constructor(private readonly room: Room<any, RunState>) {
    room.onStateChange(() => this.patch.emit());
    room.onMessage('events', (events: GameEvent[]) => this.events.emit(events));
    room.onMessage('pong', (sentAt: number) => this.meter.pong(sentAt));
    room.onMessage('welcome', () => {});
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
    const meter = installByteCounter();
    const client = new Client(serverUrl);
    const room = opts.code
      ? await client.joinById(opts.code, opts, RunState)
      : await client.create(
          RUN_ROOM,
          { ...opts, ...(seed === undefined ? {} : { seed }) },
          RunState,
        );
    const conn = new ColyseusConnection(room);
    meter.target = conn.meter;
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

/**
 * Counts WebSocket bytes for the performance HUD by wrapping the global WebSocket once.
 * Only the most recent connection's meter receives counts.
 */
const counter: { target: NetMeter | null } = { target: null };
let installed = false;
function installByteCounter(): { target: NetMeter | null } {
  if (installed) return counter;
  installed = true;
  const Native = globalThis.WebSocket;
  class CountingWebSocket extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener('message', (e: MessageEvent) => {
        const d = e.data as ArrayBuffer | Blob | string;
        const n =
          typeof d === 'string' ? d.length : d instanceof ArrayBuffer ? d.byteLength : d.size;
        counter.target?.addIn(n);
      });
    }

    override send(data: string | Blob | BufferSource): void {
      const n =
        typeof data === 'string' ? data.length : data instanceof Blob ? data.size : data.byteLength;
      counter.target?.addOut(n);
      super.send(data);
    }
  }
  globalThis.WebSocket = CountingWebSocket;
  return counter;
}
