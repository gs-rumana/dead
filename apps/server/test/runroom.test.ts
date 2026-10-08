import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { PROTOCOL_VERSION, RUN_ROOM, RunState } from '@dead-tracks/shared';
import { createGameServer } from '../src/app.ts';

const PORT = 25670 + Math.floor(Math.random() * 100);
let server: ReturnType<typeof createGameServer>;

beforeAll(async () => {
  server = createGameServer();
  await server.listen(PORT);
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const until = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('RunRoom', () => {
  it('lets a second client join by party code and syncs state to both', async () => {
    const a = new Client(`http://localhost:${PORT}`);
    const b = new Client(`http://localhost:${PORT}`);
    const roomA = await a.create(RUN_ROOM, { protocol: PROTOCOL_VERSION, name: 'A' }, RunState);
    expect(roomA.roomId).toMatch(/^[A-Z]{4}$/);
    const roomB = await b.joinById(
      roomA.roomId,
      { protocol: PROTOCOL_VERSION, name: 'B' },
      RunState,
    );
    await until(() => roomA.state.players.size === 2 && roomB.state.players.size === 2);
    expect(roomB.state.players.get(roomA.sessionId)?.name).toBe('A');

    roomB.send('cmd', { t: 'nudge' });
    await until(() => roomA.state.test.nudges === 1);
    expect(roomA.state.test.color).toBe(roomB.state.test.color);

    await roomB.leave();
    await until(() => roomA.state.players.size === 1);
    await roomA.leave();
  });

  it('rejects clients with a different protocol version', async () => {
    const c = new Client(`http://localhost:${PORT}`);
    await expect(
      c.create(RUN_ROOM, { protocol: PROTOCOL_VERSION + 99 }, RunState),
    ).rejects.toThrow();
  });
});

describe('RunRoom reconnection', () => {
  it('holds a dropped player and restores them on reconnect', async () => {
    const a = new Client(`http://localhost:${PORT}`);
    const room = await a.create(RUN_ROOM, { protocol: PROTOCOL_VERSION, name: 'A' }, RunState);
    await until(() => room.state.players.size === 1);
    const token = room.reconnectionToken;
    const sid = room.sessionId;
    room.reconnection.enabled = false;
    // Simulate an abrupt network drop.
    (
      room.connection as unknown as { transport: { ws: { close: (c: number) => void } } }
    ).transport.ws.close(3000);
    const b = new Client(`http://localhost:${PORT}`);
    await new Promise((r) => setTimeout(r, 300));
    const back = await b.reconnect(token, RunState);
    expect(back.sessionId).toBe(sid);
    await until(
      () =>
        back.state.players.get(sid) !== undefined &&
        (back.state.players.get(sid)!.flags & 16) === 0,
    );
    expect(back.state.players.size).toBe(1);
    await back.leave();
  });
});
