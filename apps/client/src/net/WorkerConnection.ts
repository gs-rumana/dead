import { Decoder } from '@colyseus/schema';
import {
  type ClientMessages,
  type GameEvent,
  type JoinOptions,
  type ServerMessages,
  RunState,
} from '@dead-tracks/shared';
import { type Connection, Emitter, NetMeter } from './Connection.ts';
import type { FromWorker, ToWorker } from './workerProtocol.ts';

/** Solo play: the authoritative simulation runs in a Web Worker on this device (§6.5). */
export class WorkerConnection implements Connection {
  readonly kind = 'solo' as const;
  readonly state: RunState;
  selfId = '';
  code = 'SOLO';
  private readonly decoder: Decoder<RunState>;
  private readonly meter = new NetMeter();
  private readonly patch = new Emitter<[]>();
  private readonly events = new Emitter<[GameEvent[]]>();
  private readonly closed = new Emitter<[string]>();
  private pingTimer = 0;

  private constructor(private readonly worker: Worker) {
    this.decoder = new Decoder(new RunState());
    this.state = this.decoder.state;
  }

  get stats() {
    return this.meter.stats;
  }

  static connect(opts: JoinOptions, seed?: number): Promise<WorkerConnection> {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
      name: 'dead-tracks-sim',
    });
    const conn = new WorkerConnection(worker);
    return new Promise((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message || 'worker failed to start'));
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const msg = e.data;
        if (msg.type === 'msg' && msg.t === 'welcome') {
          const w = msg.p as ServerMessages['welcome'];
          conn.selfId = w.selfId;
          conn.code = w.code;
          resolve(conn);
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
        conn.handle(msg);
      };
      conn.post({ type: 'join', opts, ...(seed === undefined ? {} : { seed }) });
      conn.pingTimer = window.setInterval(() => conn.send('ping', performance.now()), 2000);
    });
  }

  send<K extends keyof ClientMessages>(type: K, msg: ClientMessages[K]): void {
    this.post({ type: 'msg', t: type, p: msg });
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
    this.post({ type: 'close' });
    this.worker.terminate();
    this.closed.emit('closed');
  }

  private post(msg: ToWorker): void {
    if (msg.type === 'msg') this.meter.addOut(JSON.stringify(msg.p ?? null).length + 4);
    this.worker.postMessage(msg);
  }

  private handle(msg: FromWorker): void {
    switch (msg.type) {
      case 'state': {
        const bytes = new Uint8Array(msg.bytes);
        this.meter.addIn(bytes.byteLength);
        this.decoder.decode(bytes);
        this.patch.emit();
        break;
      }
      case 'msg': {
        if (msg.t === 'events') this.events.emit(msg.p as GameEvent[]);
        else if (msg.t === 'pong') this.meter.pong(msg.p as number);
        break;
      }
      case 'error':
        console.error('[solo worker]', msg.message);
        this.closed.emit(msg.message);
        break;
    }
  }
}
