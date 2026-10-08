import type { JoinOptions } from '@dead-tracks/shared';

/** Main thread → solo worker. */
export type ToWorker =
  | { type: 'join'; opts: JoinOptions; seed?: number }
  | { type: 'msg'; t: string; p: unknown }
  | { type: 'close' };

/** Solo worker → main thread. */
export type FromWorker =
  | { type: 'state'; bytes: ArrayBuffer }
  | { type: 'msg'; t: string; p: unknown }
  | { type: 'error'; message: string };
