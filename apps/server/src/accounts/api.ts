import { randomBytes } from 'node:crypto';
import type { LifetimeStats, RunAward } from '@dead-tracks/shared';
import { AccountError, type Accounts } from './service.ts';
import {
  type Fetch,
  type ProviderConfig,
  authorizeUrl,
  devAuthorizePage,
  exchange,
} from './oauth.ts';

export interface ApiOptions {
  accounts: Accounts;
  providers: ProviderConfig[];
  /** Offer the development sign-in provider (never in production). */
  dev: boolean;
  /** Where the game client lives (sign-in returns there). */
  clientUrl: string;
  /** This server's public base URL for OAuth redirects (default: from the request). */
  publicUrl?: string;
  region: string;
  /** Looks up a party code: its region, room kind and (for lobbies) the run (§9.2). */
  party?: (code: string) => Promise<{ region: string; room: string; runId?: string } | null>;
  fetch?: Fetch;
}

/**
 * The accounts HTTP API (§4.12): a plain fetch-style handler mounted in front of
 * the Colyseus router. Returns undefined for paths it doesn't own.
 */
export function createApi(o: ApiOptions) {
  const guestHits = new Map<string, { n: number; reset: number }>();

  const cors = (res: Response): Response => {
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };
  const json = (data: unknown, status = 200) => cors(Response.json(data, { status }));
  const fail = (status: number, error: string) => json({ error }, status);

  const bearer = (req: Request) => {
    const h = req.headers.get('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice(7) : '';
  };
  const userOf = async (req: Request) => {
    const row = await o.accounts.userFromToken(bearer(req));
    if (!row) throw new AccountError(401, 'Not signed in');
    return row;
  };
  const body = async (req: Request): Promise<Record<string, unknown>> => {
    try {
      const v = (await req.json()) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const base = (req: Request) => o.publicUrl ?? new URL(req.url).origin;
  const provider = (id: string): ProviderConfig | null => {
    if (id === 'dev' && o.dev)
      return {
        id: 'dev',
        name: 'Dev',
        authorizeUrl: '',
        tokenUrl: '',
        userUrl: '',
        scope: '',
        clientId: 'dev',
        clientSecret: 'dev',
        identity: (u) => ({ id: String(u.id), name: String(u.name) }),
      };
    return o.providers.find((p) => p.id === id) ?? null;
  };

  const statsHits = new Map<string, { n: number; reset: number }>();
  /** Stats: at most 240 posts per address per hour. */
  const statsAllowed = (req: Request): boolean => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const now = Date.now();
    const e = statsHits.get(ip);
    if (!e || e.reset < now) {
      statsHits.set(ip, { n: 1, reset: now + 3600_000 });
      if (statsHits.size > 10_000) statsHits.clear();
      return true;
    }
    return ++e.n <= 240;
  };

  /** Guests are cheap but not free: at most 30 new ones per address per hour. */
  const guestAllowed = (req: Request): boolean => {
    if (o.dev) return true;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const now = Date.now();
    const e = guestHits.get(ip);
    if (!e || e.reset < now) {
      guestHits.set(ip, { n: 1, reset: now + 3600_000 });
      if (guestHits.size > 10_000) guestHits.clear();
      return true;
    }
    e.n++;
    return e.n <= 30;
  };

  async function route(req: Request, url: URL): Promise<Response | undefined> {
    const path = url.pathname;
    const m = req.method;
    if (m === 'GET' && path === '/api/providers')
      return json({
        providers: [...o.providers.map((p) => ({ id: p.id, name: p.name })), ...(o.dev ? [{ id: 'dev', name: 'Dev' }] : [])],
        region: o.region,
      });
    if (m === 'POST' && path === '/api/guest') {
      if (!guestAllowed(req)) return fail(429, 'Too many new players from here; try later');
      return json(await o.accounts.createGuest());
    }
    if (m === 'GET' && path === '/api/me') return json(await o.accounts.profile(await userOf(req)));
    if (m === 'POST' && path === '/api/username') {
      const b = await body(req);
      return json(await o.accounts.setUsername(await userOf(req), String(b.name ?? '')));
    }
    if (m === 'POST' && path === '/api/unlock') {
      const b = await body(req);
      return json(await o.accounts.unlock(await userOf(req), b.cls));
    }
    if (m === 'POST' && path === '/api/run/start') {
      const b = await body(req);
      return json({ runId: await o.accounts.soloStart(await userOf(req), b.seed) });
    }
    if (m === 'POST' && path === '/api/run/finish') {
      const b = await body(req);
      return json(
        await o.accounts.soloFinish(await userOf(req), b.runId, {
          award: (b.award ?? {}) as RunAward,
          stats: (b.stats ?? {}) as Partial<LifetimeStats>,
          dev: b.dev !== false,
        }),
      );
    }
    if (m === 'POST' && path === '/api/stats') {
      if (!statsAllowed(req)) return fail(429, 'Slow down');
      const b = await body(req);
      const session = typeof b.session === 'string' ? b.session : '';
      if (!/^[A-Za-z0-9_-]{8,40}$/.test(session) || !Array.isArray(b.events)) return fail(400, 'Bad stats');
      return json({ stored: o.accounts.recordStats(session, b.events as Array<{ kind: string; data: unknown }>) });
    }
    if (m === 'POST' && path === '/api/dev/bonds' && o.dev) {
      const b = await body(req);
      return json(await o.accounts.devGrant(await userOf(req), Number(b.bonds) || 0));
    }
    const party = path.match(/^\/api\/party\/([A-Z]{4,6})$/);
    if (m === 'GET' && party) {
      const info = o.party ? await o.party(party[1]!) : null;
      return info ? json({ code: party[1], ...info }) : fail(404, 'No such party');
    }

    // Sign-in: the client asks for the provider URL with its guest token...
    const begin = path.match(/^\/api\/auth\/([a-z]+)$/);
    if (m === 'POST' && begin) {
      const p = provider(begin[1]!);
      if (!p) return fail(404, 'Sign-in provider not configured');
      const guest = await o.accounts.userFromToken(bearer(req));
      const state = o.accounts.tokens.sign(
        { k: 'oauth', p: p.id, g: guest?.id ?? '', n: randomBytes(8).toString('hex') },
        600,
      );
      const redirect = `${base(req)}/auth/${p.id}/callback`;
      const target =
        p.id === 'dev'
          ? `${base(req)}/auth/dev/authorize?${new URLSearchParams({ state, redirect_uri: redirect })}`
          : authorizeUrl(p, redirect, state);
      return json({ url: target });
    }
    if (m === 'GET' && path === '/auth/dev/authorize' && o.dev) {
      return cors(
        new Response(
          devAuthorizePage(url.searchParams.get('state') ?? '', url.searchParams.get('redirect_uri') ?? ''),
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
      );
    }
    // ...and the provider sends the browser back here.
    const cb = path.match(/^\/auth\/([a-z]+)\/callback$/);
    if (m === 'GET' && cb) {
      const back = (q: Record<string, string>) =>
        cors(new Response(null, { status: 302, headers: { Location: `${o.clientUrl}/#${new URLSearchParams(q)}` } }));
      const p = provider(cb[1]!);
      const state = o.accounts.tokens.verify<{ k: string; p: string; g: string }>(url.searchParams.get('state'));
      const code = url.searchParams.get('code');
      if (!p || !state || state.k !== 'oauth' || state.p !== p.id || !code)
        return back({ authError: 'Sign-in failed. Please try again.' });
      try {
        const ident =
          p.id === 'dev'
            ? { id: code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32), name: `Dev ${code}` }
            : await exchange(p, code, `${base(req)}/auth/${p.id}/callback`, o.fetch);
        if (!ident.id) return back({ authError: 'Sign-in failed. Please try again.' });
        const token = await o.accounts.signIn(p.id, ident.id, ident.name, state.g || null);
        return back({ auth: token });
      } catch (e) {
        console.warn(`[accounts] ${p.id} sign-in failed:`, (e as Error).message);
        return back({ authError: 'Sign-in failed. Please try again.' });
      }
    }
    return undefined;
  }

  return async function handle(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) return undefined;
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    try {
      return (await route(req, url)) ?? fail(404, 'Not found');
    } catch (e) {
      if (e instanceof AccountError) return fail(e.status, e.message);
      console.error('[accounts]', e);
      return fail(500, 'Server error');
    }
  };
}
