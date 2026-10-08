import type { ClassId, LifetimeStats, Profile, RunAward } from '@dead-tracks/shared';
import { config } from '../core/config.ts';

const TOKEN_KEY = 'dead-tracks:token';

type Listener = () => void;

/**
 * The player's account (§4.12): a guest token kept in the browser, optional
 * sign-in, bonds and unlocked classes. Everything degrades gracefully offline
 * (solo still plays; progress just isn't saved until the server is reachable).
 */
export class AccountClient {
  profile: Profile | null = null;
  providers: Array<{ id: string; name: string }> = [];
  offline = false;
  /** Shown once after a failed sign-in. */
  notice = '';
  private token: string | null = null;
  private readonly listeners = new Set<Listener>();
  private ready: Promise<void> | null = null;

  constructor(private readonly base: string) {
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
    } catch {
      this.token = null;
    }
  }

  get sessionToken(): string | undefined {
    return this.token ?? undefined;
  }

  get classes(): ClassId[] {
    return this.profile?.classes ?? ['drifter'];
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed(): void {
    for (const cb of this.listeners) cb();
  }

  /** Picks up a sign-in result from the URL, then makes sure we have an account. */
  init(): Promise<void> {
    this.ready ??= this.boot();
    return this.ready;
  }

  private async boot(): Promise<void> {
    const hash = new URLSearchParams(location.hash.slice(1));
    const fresh = hash.get('auth');
    if (fresh) this.store(fresh);
    if (hash.get('authError')) this.notice = hash.get('authError') ?? '';
    if (fresh || hash.has('authError')) history.replaceState(null, '', location.pathname + location.search);
    try {
      const [prov] = await Promise.all([
        this.call<{ providers: Array<{ id: string; name: string }> }>('GET', '/api/providers'),
        this.refresh(),
      ]);
      this.providers = prov.providers;
      this.offline = false;
    } catch {
      this.offline = true;
    }
    this.changed();
  }

  /** Fetches the profile, creating a guest the first time. */
  async refresh(): Promise<void> {
    if (this.token) {
      try {
        this.profile = await this.call<Profile>('GET', '/api/me');
        this.changed();
        return;
      } catch (e) {
        if ((e as { status?: number }).status !== 401) throw e;
        // Token unknown to this server (e.g. a wiped dev database): start fresh.
      }
    }
    const g = await this.call<{ token: string; profile: Profile }>('POST', '/api/guest');
    this.store(g.token);
    this.profile = g.profile;
    this.changed();
  }

  private store(token: string): void {
    this.token = token;
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Private mode: the account lasts for this tab only.
    }
  }

  async setUsername(name: string): Promise<void> {
    this.profile = await this.call<Profile>('POST', '/api/username', { name });
    this.changed();
  }

  async unlock(cls: ClassId): Promise<void> {
    this.profile = await this.call<Profile>('POST', '/api/unlock', { cls });
    this.changed();
  }

  /** Off to the provider; it sends the browser back with #auth=… */
  async signIn(provider: string): Promise<void> {
    const r = await this.call<{ url: string }>('POST', `/api/auth/${provider}`);
    location.href = r.url;
  }

  /** Forget this device's session (a new guest is made). */
  async signOut(): Promise<void> {
    this.token = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
    this.profile = null;
    await this.refresh();
  }

  async party(code: string): Promise<{ region: string; room: string; runId?: string } | null> {
    try {
      return await this.call('GET', `/api/party/${code}`);
    } catch {
      return null;
    }
  }

  async soloStart(seed: number): Promise<string | null> {
    try {
      return (await this.call<{ runId: string }>('POST', '/api/run/start', { seed })).runId;
    } catch {
      return null;
    }
  }

  async soloFinish(
    runId: string,
    award: RunAward,
    stats: Partial<LifetimeStats>,
    dev: boolean,
  ): Promise<number | null> {
    try {
      const r = await this.call<{ bonds: number; profile: Profile }>('POST', '/api/run/finish', {
        runId,
        award,
        stats,
        dev,
      });
      this.profile = r.profile;
      this.changed();
      return r.bonds;
    } catch {
      return null;
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
    return data;
  }
}

export const account = new AccountClient(config.serverUrl);
