import { Encoder, StateView } from '@colyseus/schema';
import { type JoinOptions, PATCH_MS, SIM_DT } from '@dead-tracks/shared';
import { type HostClient, RunHost } from '@dead-tracks/sim/host';
import type { FromWorker } from '../net/workerProtocol.ts';

/**
 * A one-player stand-in for the Colyseus RunRoom: drives RunHost at 30 Hz and
 * sends schema patches at 20 Hz, encoded exactly the way the server encodes them.
 */
export class LocalRoom {
  private readonly host: RunHost;
  private readonly encoder: Encoder;
  private readonly view = new StateView();
  private readonly client: HostClient;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private accumulator = 0;
  private sincePatch = 0;
  private joined = false;

  constructor(
    private readonly post: (msg: FromWorker, transfer?: Transferable[]) => void,
    seed: number,
  ) {
    this.host = new RunHost({ seed, code: 'SOLO' });
    this.encoder = new Encoder(this.host.state);
    this.client = {
      id: 'solo',
      view: this.view,
      send: (t, p) => this.post({ type: 'msg', t, p }),
    };
  }

  join(opts: JoinOptions): void {
    this.host.join(this.client, opts);
    this.joined = true;
    this.sendFullState();
    this.last = performance.now();
    this.timer = setInterval(() => this.loop(), 1000 / 60);
  }

  message(t: string, p: unknown): void {
    if (this.joined) this.host.message(this.client, t, p);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.view.dispose();
  }

  private loop(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < 4) {
      this.host.step(SIM_DT);
      this.accumulator -= SIM_DT;
      steps++;
    }
    if (steps === 4) this.accumulator = 0;
    this.sincePatch += dt * 1000;
    if (this.sincePatch >= PATCH_MS) {
      this.sincePatch %= PATCH_MS;
      this.sendPatch();
    }
  }

  private sendFullState(): void {
    const it = { offset: 0 };
    this.encoder.encodeAll(it);
    const bytes = this.encoder.encodeAllView(this.view, it.offset, it).slice();
    this.encoder.discardChanges();
    this.post({ type: 'state', bytes: bytes.buffer }, [bytes.buffer]);
  }

  private sendPatch(): void {
    if (!this.encoder.hasChanges) return;
    const it = { offset: 0 };
    let bytes = this.encoder.encode(it);
    if (this.encoder.context.hasFilters) {
      bytes = this.encoder.encodeView(this.view, it.offset, it);
    }
    const copy = bytes.slice();
    this.encoder.discardChanges();
    this.post({ type: 'state', bytes: copy.buffer }, [copy.buffer]);
  }
}
