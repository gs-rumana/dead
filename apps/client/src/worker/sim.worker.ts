/// <reference lib="webworker" />
import type { FromWorker, ToWorker } from '../net/workerProtocol.ts';
import { LocalRoom } from './LocalRoom.ts';

declare const self: DedicatedWorkerGlobalScope;

let room: LocalRoom | null = null;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'join': {
        const seed = msg.seed ?? (Math.random() * 2 ** 32) >>> 0;
        room = new LocalRoom(post, seed);
        room.join(msg.opts);
        break;
      }
      case 'msg':
        room?.message(msg.t, msg.p);
        break;
      case 'close':
        room?.close();
        room = null;
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
