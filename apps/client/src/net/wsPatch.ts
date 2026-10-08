import type { NetMeter } from './Connection.ts';
import { DelayLine } from './NetSim.ts';

/*
 * Must be imported before @colyseus/sdk: the SDK captures globalThis.WebSocket when
 * its module loads. main.tsx imports this first.
 */
/**
 * Counts WebSocket bytes for the performance HUD by wrapping the global WebSocket once.
 * Only the most recent connection's meter receives counts.
 */
export const wsCounter: { target: NetMeter | null } = { target: null };
const counter = wsCounter;
{
  const Native = globalThis.WebSocket;
  class CountingWebSocket extends Native {
    private readonly inLine = new DelayLine();
    private readonly outLine = new DelayLine();
    private handler: ((e: MessageEvent) => void) | null = null;

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      super.onmessage = (e: MessageEvent) => {
        const d = e.data as ArrayBuffer | Blob | string;
        const n =
          typeof d === 'string' ? d.length : d instanceof ArrayBuffer ? d.byteLength : d.size;
        counter.target?.addIn(n);
        this.inLine.push(() => this.handler?.(e));
      };
    }

    // The SDK assigns onmessage; route it through the (optional) delay line.
    override get onmessage(): ((e: MessageEvent) => void) | null {
      return this.handler;
    }

    override set onmessage(fn: ((e: MessageEvent) => void) | null) {
      this.handler = fn;
    }

    override send(data: string | Blob | BufferSource): void {
      const n =
        typeof data === 'string' ? data.length : data instanceof Blob ? data.size : data.byteLength;
      counter.target?.addOut(n);
      this.outLine.push(() => {
        if (this.readyState === Native.OPEN) super.send(data);
      });
    }
  }
  globalThis.WebSocket = CountingWebSocket;
}
