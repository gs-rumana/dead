import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import {
  CLASS_IDS,
  LOBBY_ROOM,
  LobbyState,
  PROTOCOL_VERSION,
  RunState,
  type Profile,
} from '@dead-tracks/shared';
import { createGameServer } from '../src/app.ts';
import { createApi } from '../src/accounts/api.ts';
import { providersFromEnv } from '../src/accounts/oauth.ts';
import { Accounts } from '../src/accounts/service.ts';
import { Tokens } from '../src/accounts/tokens.ts';

const tokens = new Tokens('s'.repeat(40));

function apiFor(accounts: Accounts, extra: Partial<Parameters<typeof createApi>[0]> = {}) {
  const api = createApi({
    accounts,
    providers: [],
    dev: true,
    clientUrl: 'http://client.test',
    publicUrl: 'http://server.test',
    region: 'eu',
    ...extra,
  });
  return async (method: string, path: string, token = '', body?: unknown) => {
    const res = (await api(
      new Request(`http://server.test${path}`, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    ))!;
    const text = await res.text();
    return { status: res.status, headers: res.headers, data: text.startsWith('{') ? JSON.parse(text) : text };
  };
}

/** Follows the dev sign-in from begin to callback; returns the session token. */
async function devSignIn(call: ReturnType<typeof apiFor>, guestToken: string, who: string) {
  const begin = await call('POST', '/api/auth/dev', guestToken);
  expect(begin.status).toBe(200);
  const auth = new URL(begin.data.url);
  expect(auth.pathname).toBe('/auth/dev/authorize');
  const page = await call('GET', auth.pathname + auth.search);
  expect(page.data).toContain('dev-sign-in');
  const cb = new URL(auth.searchParams.get('redirect_uri')!);
  cb.searchParams.set('state', auth.searchParams.get('state')!);
  cb.searchParams.set('code', who);
  const back = await call('GET', cb.pathname + cb.search);
  expect(back.status).toBe(302);
  const loc = new URL(back.headers.get('location')!);
  expect(loc.origin).toBe('http://client.test');
  const token = new URLSearchParams(loc.hash.slice(1)).get('auth');
  expect(token).toBeTruthy();
  return token!;
}

describe('accounts API', () => {
  const accounts = new Accounts(':memory:', tokens);
  const call = apiFor(accounts);

  it('creates guests with generated names; usernames are checked', async () => {
    const g = await call('POST', '/api/guest');
    expect(g.status).toBe(200);
    expect(g.data.profile.guest).toBe(true);
    expect(g.data.profile.classes).toEqual(['drifter']);
    expect(g.data.profile.username).toMatch(/^[A-Za-z]+\d+$/);
    const me = await call('GET', '/api/me', g.data.token);
    expect(me.data.id).toBe(g.data.profile.id);
    expect((await call('GET', '/api/me', 'bogus')).status).toBe(401);
    expect((await call('POST', '/api/username', g.data.token, { name: 'ab' })).status).toBe(400);
    expect((await call('POST', '/api/username', g.data.token, { name: 'Sh1t_Kicker' })).status).toBe(400);
    expect((await call('POST', '/api/username', g.data.token, { name: 'Coal_Shoveler' })).data.username).toBe('Coal_Shoveler');
    const other = await call('POST', '/api/guest');
    expect((await call('POST', '/api/username', other.data.token, { name: 'coal_shoveler' })).status).toBe(409);
  });

  it('unlocks classes only with enough bonds', async () => {
    const g = await call('POST', '/api/guest');
    expect((await call('POST', '/api/unlock', g.data.token, { cls: 'medic' })).status).toBe(402);
    await accounts.award({ userId: g.data.profile.id, bonds: 20, final: true, award: { km: 50, won: false, landmarks: 1, bondItems: 0 }, stats: { runs: 1, bestKm: 50 } });
    const u = await call('POST', '/api/unlock', g.data.token, { cls: 'medic' });
    expect(u.status).toBe(200);
    expect(u.data.classes).toEqual(['drifter', 'medic']);
    expect(u.data.bonds).toBe(5);
    expect(u.data.stats.runs).toBe(1);
    expect((await call('POST', '/api/unlock', g.data.token, { cls: 'preacher' })).status).toBe(402);
    expect((await call('POST', '/api/unlock', g.data.token, { cls: 'wizard' })).status).toBe(400);
  });

  it('caps solo claims by the time since the run started, once per run', async () => {
    const g = await call('POST', '/api/guest');
    const start = await call('POST', '/api/run/start', g.data.token, { seed: 7 });
    const runId = start.data.runId;
    const award = { km: 80, won: true, landmarks: 3, bondItems: 2 };
    // Claimed seconds after starting: the distance can't have been covered.
    const fin = await call('POST', '/api/run/finish', g.data.token, { runId, award, stats: { kills: 10 }, dev: false });
    expect(fin.status).toBe(200);
    expect(fin.data.bonds).toBe(3 * 3 + 2 * 3); // landmarks and bond items only
    expect((await call('POST', '/api/run/finish', g.data.token, { runId, award, dev: false })).status).toBe(409);
    // Dev-panel runs earn nothing.
    const s2 = await call('POST', '/api/run/start', g.data.token, { seed: 8 });
    const f2 = await call('POST', '/api/run/finish', g.data.token, { runId: s2.data.runId, award, dev: true });
    expect(f2.data.bonds).toBe(0);
  });

  it('first sign-in keeps guest progress; a second device merges into the account', async () => {
    // Device A: a guest earns bonds and unlocks a class, then signs in.
    const a = await call('POST', '/api/guest');
    await accounts.award({ userId: a.data.profile.id, bonds: 30, final: true, award: { km: 80, won: true, landmarks: 3, bondItems: 0 }, stats: { runs: 1, wins: 1 } });
    await call('POST', '/api/unlock', a.data.token, { cls: 'engineer' });
    const tokenA = await devSignIn(call, a.data.token, 'alice');
    const pa = (await call('GET', '/api/me', tokenA)).data as Profile;
    expect(pa.id).toBe(a.data.profile.id);
    expect(pa.guest).toBe(false);
    expect(pa.providers).toEqual(['dev']);
    expect(pa.bonds).toBe(10);
    expect(pa.classes).toContain('engineer');
    // Device B: a fresh guest with a little progress of its own signs in as alice.
    const b = await call('POST', '/api/guest');
    await accounts.award({ userId: b.data.profile.id, bonds: 4, final: true, award: { km: 40, won: false, landmarks: 0, bondItems: 0 }, stats: { runs: 1 } });
    const tokenB = await devSignIn(call, b.data.token, 'alice');
    const pb = (await call('GET', '/api/me', tokenB)).data as Profile;
    expect(pb.id).toBe(pa.id);
    expect(pb.bonds).toBe(14);
    expect(pb.classes).toContain('engineer');
    expect(pb.stats.runs).toBe(2);
    // B's old guest token now leads to the account too.
    expect((await call('GET', '/api/me', b.data.token)).data.id).toBe(pa.id);
  });

  it('stores anonymous stats and rejects junk', async () => {
    const ok = await call('POST', '/api/stats', '', {
      session: 'abcdef1234567890',
      events: [
        { kind: 'run_end', data: { km: 42.5, won: false } },
        { kind: 'death', data: { cause: 'werewolf' } },
        { kind: 'Bad Kind!', data: {} },
        { kind: 'big', data: { x: 'y'.repeat(5000) } },
      ],
    });
    expect(ok.data.stored).toBe(2);
    expect((await call('POST', '/api/stats', '', { session: 'x', events: [] })).status).toBe(400);
  });

  it('signs in through a real provider shape (GitHub, mocked)', async () => {
    const providers = providersFromEnv({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
    expect(providers.map((p) => p.id)).toEqual(['github']);
    const seen: string[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      seen.push(url);
      if (url.includes('access_token')) {
        expect(String(init?.body)).toContain('code=good-code');
        return Response.json({ access_token: 'gho_x' });
      }
      return Response.json({ id: 4242, login: 'octo' });
    };
    const call2 = apiFor(accounts, { providers, dev: false, fetch: fake as typeof fetch });
    const list = await call2('GET', '/api/providers');
    expect(list.data.providers).toEqual([{ id: 'github', name: 'GitHub' }]);
    expect((await call2('POST', '/api/auth/dev')).status).toBe(404);
    const g = await call2('POST', '/api/guest');
    const begin = await call2('POST', '/api/auth/github', g.data.token);
    const url = new URL(begin.data.url);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://server.test/auth/github/callback');
    const back = await call2('GET', `/auth/github/callback?code=good-code&state=${encodeURIComponent(url.searchParams.get('state')!)}`);
    const token = new URLSearchParams(new URL(back.headers.get('location')!).hash.slice(1)).get('auth')!;
    const me = (await call2('GET', '/api/me', token)).data as Profile;
    expect(me.providers).toEqual(['github']);
    expect(seen.length).toBe(2);
    // A forged state is refused.
    const bad = await call2('GET', '/auth/github/callback?code=good-code&state=forged');
    expect(new URL(bad.headers.get('location')!).hash).toContain('authError');
  });
});

describe('lobby and run rooms with accounts', () => {
  const PORT = 25790 + Math.floor(Math.random() * 100);
  let server: ReturnType<typeof createGameServer>;
  const url = `http://localhost:${PORT}`;
  beforeAll(async () => {
    server = createGameServer({ dbPath: ':memory:', tokens, dev: false, clientUrl: 'http://client.test' });
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });
  const until = async (cond: () => boolean, ms = 4000) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const post = async <T = { token: string; profile: Profile }>(path: string, token = '', body: unknown = {}) =>
    (await (await fetch(url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })).json()) as T;

  it('serves the API over HTTP with CORS', async () => {
    const res = await fetch(`${url}/api/guest`, { method: 'POST' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await res.json()) as { token: string }).token).toBeTruthy();
    expect((await fetch(`${url}/api/reference`)).status).toBe(404);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it('a party forms in the lobby, picks unlocked classes and starts a run together', async () => {
    const host = await post('/api/guest');
    const friend = await post('/api/guest');
    const accounts = (await import('../src/services.ts')).services.accounts!;
    await accounts.award({ userId: host.profile.id, bonds: 15, final: true, award: { km: 30, won: false, landmarks: 0, bondItems: 0 }, stats: {} });
    await post('/api/unlock', host.token, { cls: 'medic' });

    const a = new Client(url);
    const b = new Client(url);
    const la = await a.create(LOBBY_ROOM, { protocol: PROTOCOL_VERSION, token: host.token, cls: 'medic' }, LobbyState);
    expect(la.roomId).toMatch(/^[A-Z]{4}$/);
    const info = await (await fetch(`${url}/api/party/${la.roomId}`)).json();
    expect(info).toMatchObject({ region: 'eu', room: 'lobby' });
    const lb = await b.joinById(la.roomId, { protocol: PROTOCOL_VERSION, token: friend.token, cls: 'preacher' }, LobbyState);
    await until(() => la.state.members.size === 2);
    // The friend hasn't unlocked the Preacher: they're a Drifter.
    expect(la.state.members.get(lb.sessionId)?.cls).toBe('drifter');
    expect(la.state.members.get(la.sessionId)?.cls).toBe('medic');
    expect(la.state.members.get(la.sessionId)?.name).toBe(host.profile.username);
    // Only the leader can start.
    lb.send('start');
    await new Promise((r) => setTimeout(r, 200));
    expect(la.state.runId).toBe('');
    la.send('start');
    await until(() => !!la.state.runId && !!lb.state.runId);
    const after = (await (await fetch(`${url}/api/party/${la.roomId}`)).json()) as { runId: string };
    expect(after.runId).toBe(la.state.runId);
    const ra = await a.joinById(la.state.runId, { protocol: PROTOCOL_VERSION, token: host.token, cls: 'medic' }, RunState);
    const rb = await b.joinById(lb.state.runId, { protocol: PROTOCOL_VERSION, token: friend.token, cls: 'medic' }, RunState);
    await until(() => ra.state.players.size === 2);
    expect(CLASS_IDS[ra.state.players.get(ra.sessionId)!.cls]).toBe('medic');
    expect(CLASS_IDS[ra.state.players.get(rb.sessionId)!.cls]).toBe('drifter');
    // The run shows the party code, and dev commands are refused on this server.
    expect(ra.state.code).toBe(la.roomId);
    ra.send('cmd', { t: 'dev', action: 'skip', value: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(ra.state.train.s).toBeLessThan(1000);
    await Promise.all([ra.leave(), rb.leave(), la.leave(), lb.leave()]);
  });
});
