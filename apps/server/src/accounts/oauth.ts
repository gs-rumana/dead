/**
 * OAuth sign-in (§4.12): Discord, Google and GitHub, configured from environment
 * variables (secrets stay on the server, §6.11). A provider with no client id is
 * simply not offered. The 'dev' provider exists only on development servers so the
 * whole flow can be tested headlessly.
 */
export interface ProviderConfig {
  id: string;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  /** Pulls (id, display name) from the provider's user endpoint. */
  identity: (u: Record<string, unknown>) => { id: string; name: string };
}

export interface OAuthIdentity {
  id: string;
  name: string;
}

/** fetch, injectable for tests. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  const add = (
    id: string,
    name: string,
    authorizeUrl: string,
    tokenUrl: string,
    userUrl: string,
    scope: string,
    identity: ProviderConfig['identity'],
  ) => {
    const key = id.toUpperCase();
    const clientId = env[`${key}_CLIENT_ID`];
    const clientSecret = env[`${key}_CLIENT_SECRET`];
    if (clientId && clientSecret)
      out.push({ id, name, authorizeUrl, tokenUrl, userUrl, scope, clientId, clientSecret, identity });
  };
  add(
    'discord',
    'Discord',
    'https://discord.com/oauth2/authorize',
    'https://discord.com/api/oauth2/token',
    'https://discord.com/api/users/@me',
    'identify',
    (u) => ({ id: String(u.id), name: String(u.global_name ?? u.username ?? 'Discord user') }),
  );
  add(
    'google',
    'Google',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token',
    'https://openidconnect.googleapis.com/v1/userinfo',
    'openid profile',
    (u) => ({ id: String(u.sub), name: String(u.name ?? 'Google user') }),
  );
  add(
    'github',
    'GitHub',
    'https://github.com/login/oauth/authorize',
    'https://github.com/login/oauth/access_token',
    'https://api.github.com/user',
    'read:user',
    (u) => ({ id: String(u.id), name: String(u.login ?? 'GitHub user') }),
  );
  return out;
}

export function authorizeUrl(p: ProviderConfig, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
  });
  if (p.id === 'discord') q.set('prompt', 'none');
  return `${p.authorizeUrl}?${q}`;
}

/** Exchanges the code for an access token and reads who signed in. */
export async function exchange(
  p: ProviderConfig,
  code: string,
  redirectUri: string,
  fetchFn: Fetch = fetch,
): Promise<OAuthIdentity> {
  const tokenRes = await fetchFn(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: p.clientId,
      client_secret: p.clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`${p.id} token exchange failed (${tokenRes.status})`);
  const tok = (await tokenRes.json()) as { access_token?: string };
  if (!tok.access_token) throw new Error(`${p.id} returned no access token`);
  const userRes = await fetchFn(p.userUrl, {
    headers: {
      Authorization: `Bearer ${tok.access_token}`,
      Accept: 'application/json',
      'User-Agent': 'dead-tracks',
    },
  });
  if (!userRes.ok) throw new Error(`${p.id} user lookup failed (${userRes.status})`);
  const ident = p.identity((await userRes.json()) as Record<string, unknown>);
  if (!ident.id || ident.id === 'undefined') throw new Error(`${p.id} returned no user id`);
  return ident;
}

/** The development provider's sign-in page: type any id, get that identity back. */
export function devAuthorizePage(state: string, redirectUri: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>Dev sign-in</title>
<style>body{font:16px system-ui;background:#16110d;color:#f1e6d2;display:grid;place-items:center;height:100vh;margin:0}
form{display:grid;gap:10px;width:280px}input,button{font:inherit;padding:8px}</style>
<form method="GET" action="${esc(redirectUri)}">
<b>Development sign-in</b><span>Not available on the public server.</span>
<input type="hidden" name="state" value="${esc(state)}">
<input name="code" data-testid="dev-id" placeholder="any user id" required pattern="[A-Za-z0-9_-]{1,32}">
<button data-testid="dev-sign-in">Sign in</button></form>`;
}
