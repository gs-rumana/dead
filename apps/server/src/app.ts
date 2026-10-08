import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PROTOCOL_VERSION, RUN_ROOM } from '@dead-tracks/shared';
import { RunRoom } from './rooms/RunRoom.ts';

export function createGameServer() {
  return defineServer({
    transport: new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 }),
    rooms: {
      [RUN_ROOM]: defineRoom(RunRoom),
    },
    routes: createRouter({
      health: createEndpoint('/health', { method: 'GET' }, async () => ({
        ok: true,
        protocol: PROTOCOL_VERSION,
        uptime: Math.round(process.uptime()),
      })),
    }),
  });
}
