import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LOBBY_ROOM, PROTOCOL_VERSION, RUN_ROOM } from '@dead-tracks/shared';
import { createApi } from './accounts/api.ts';
import { providersFromEnv } from './accounts/oauth.ts';
import { Accounts } from './accounts/service.ts';
import { Tokens } from './accounts/tokens.ts';
import { snapshot } from './metrics.ts';
import { LobbyRoom } from './rooms/LobbyRoom.ts';
import { RunRoom } from './rooms/RunRoom.ts';
import { services } from './services.ts';

export interface ServerOptions {
  /** SQLite file (':memory:' for tests). Default: $DATA_DIR/dead-tracks.db. */
  dbPath?: string;
  dataDir?: string;
  /** Development server: dev panel and dev sign-in allowed. */
  dev?: boolean;
  clientUrl?: string;
  publicUrl?: string;
  region?: string;
  tokens?: Tokens;
}

export function createGameServer(opts: ServerOptions = {}) {
  const production = process.env.NODE_ENV === 'production';
  const dev = opts.dev ?? (!production || process.env.ALLOW_DEV === '1');
  const dataDir = opts.dataDir ?? process.env.DATA_DIR ?? './data';
  const accounts = new Accounts(
    opts.dbPath ?? process.env.DB_PATH ?? `${dataDir}/dead-tracks.db`,
    opts.tokens ?? Tokens.fromEnv(dataDir),
  );
  services.accounts = accounts;
  services.allowDev = dev;
  services.region = opts.region ?? process.env.REGION ?? 'eu';
  const api = createApi({
    accounts,
    providers: providersFromEnv(),
    dev,
    clientUrl: opts.clientUrl ?? process.env.CLIENT_URL ?? 'http://localhost:5173',
    ...(opts.publicUrl ?? process.env.PUBLIC_URL ? { publicUrl: opts.publicUrl ?? process.env.PUBLIC_URL } : {}),
    region: services.region,
    // One region today: a live party code lives here (§9.2).
    party: async (code) => {
      const [room] = await matchMaker.query({ roomId: code });
      if (!room) return null;
      const runId = (room.metadata as { runId?: string } | undefined)?.runId;
      return { region: services.region, room: room.name, ...(runId ? { runId } : {}) };
    },
  });
  return defineServer({
    transport: new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 }),
    rooms: {
      [RUN_ROOM]: defineRoom(RunRoom),
      [LOBBY_ROOM]: defineRoom(LobbyRoom),
    },
    routes: createRouter(
      {
        health: createEndpoint('/health', { method: 'GET' }, async () => ({
          ok: true,
          protocol: PROTOCOL_VERSION,
          region: services.region,
          uptime: Math.round(process.uptime()),
        })),
        metrics: createEndpoint('/metrics', { method: 'GET' }, async () => snapshot()),
      },
      {
        openapi: { disabled: true },
        // Accounts and sign-in (§4.12) answer before the regular routes.
        onRequest: (req: Request) => api(req),
      },
    ),
  });
}
