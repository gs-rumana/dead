import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  BONDS,
  CLASSES,
  type ClassId,
  EMPTY_STATS,
  type LifetimeStats,
  type Profile,
  type RunAward,
  WORLD,
  bondsFor,
  generateUsername,
  isClassId,
  usernameError,
} from '@dead-tracks/shared';
import type { AccountInfo, AwardReport } from '@dead-tracks/sim/host';
import { type Db, openDb } from './db.ts';
import { bondLog, identities, soloRuns, users } from './schema.ts';
import { Tokens } from './tokens.ts';

/** A year: guests keep their token in the browser (§4.12). */
const SESSION_TTL = 365 * 24 * 3600;

type UserRow = typeof users.$inferSelect;

export class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Accounts, progress and bonds (§4.12). Server-authoritative: bonds only come from
 * run results the server saw (multiplayer) or checked (solo claims).
 */
export class Accounts {
  readonly db: Db;
  private readonly raw: ReturnType<typeof openDb>['raw'];

  constructor(
    path: string,
    readonly tokens: Tokens,
  ) {
    const { db, raw } = openDb(path);
    this.db = db;
    this.raw = raw;
  }

  close(): void {
    this.raw.close();
  }

  // ---------------- sessions ----------------

  session(userId: string): string {
    return this.tokens.sign({ sub: userId, k: 'session' }, SESSION_TTL);
  }

  /** The account a session token belongs to (following guest merges). */
  async userFromToken(token: unknown): Promise<UserRow | null> {
    const t = this.tokens.verify<{ sub: string; k: string }>(token);
    if (!t || t.k !== 'session' || typeof t.sub !== 'string') return null;
    return this.resolve(t.sub);
  }

  private async resolve(id: string, depth = 0): Promise<UserRow | null> {
    const row = await this.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!row) return null;
    if (row.mergedInto && depth < 4) return this.resolve(row.mergedInto, depth + 1);
    return row;
  }

  async createGuest(): Promise<{ token: string; profile: Profile }> {
    const now = Date.now();
    const id = randomUUID();
    const username = await this.freeName();
    await this.db.insert(users).values({
      id,
      username,
      guest: true,
      bonds: 0,
      classes: JSON.stringify(['drifter']),
      stats: JSON.stringify(EMPTY_STATS),
      createdAt: now,
      seenAt: now,
    });
    const row = (await this.resolve(id))!;
    return { token: this.session(id), profile: await this.profile(row) };
  }

  private async freeName(): Promise<string> {
    for (let i = 0; i < 12; i++) {
      const name = generateUsername();
      if (!(await this.nameTaken(name))) return name;
    }
    return `Drifter${randomBytes(3).readUIntBE(0, 3) % 1_000_000}`;
  }

  private async nameTaken(name: string, exceptId = ''): Promise<boolean> {
    const row = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.username} = ${name} COLLATE NOCASE`)
      .get();
    return !!row && row.id !== exceptId;
  }

  async profile(row: UserRow): Promise<Profile> {
    const ids = await this.db
      .select({ provider: identities.provider })
      .from(identities)
      .where(eq(identities.userId, row.id))
      .all();
    await this.db.update(users).set({ seenAt: Date.now() }).where(eq(users.id, row.id));
    return {
      id: row.id,
      username: row.username,
      guest: row.guest,
      providers: ids.map((i) => i.provider),
      bonds: row.bonds,
      classes: parseClasses(row.classes),
      stats: { ...EMPTY_STATS, ...(JSON.parse(row.stats) as Partial<LifetimeStats>) },
    };
  }

  /** What a game room needs to know about a joining player. */
  async accountInfo(token: unknown): Promise<AccountInfo | null> {
    const row = await this.userFromToken(token);
    if (!row) return null;
    return { userId: row.id, name: row.username, classes: parseClasses(row.classes) };
  }

  // ---------------- profile changes ----------------

  async setUsername(row: UserRow, name: string): Promise<Profile> {
    const err = usernameError(name);
    if (err) throw new AccountError(400, err);
    if (await this.nameTaken(name, row.id)) throw new AccountError(409, 'That name is taken');
    await this.db.update(users).set({ username: name }).where(eq(users.id, row.id));
    return this.profile((await this.resolve(row.id))!);
  }

  async unlock(row: UserRow, cls: unknown): Promise<Profile> {
    if (!isClassId(cls)) throw new AccountError(400, 'Unknown class');
    const owned = parseClasses(row.classes);
    if (owned.includes(cls)) return this.profile(row);
    const cost = CLASSES[cls].cost;
    // Conditional update: two quick clicks can't spend the same bonds twice.
    const res = this.raw
      .prepare('UPDATE users SET bonds = bonds - ?, classes = ? WHERE id = ? AND bonds >= ? AND classes = ?')
      .run(cost, JSON.stringify([...owned, cls]), row.id, cost, row.classes);
    if (res.changes !== 1) throw new AccountError(402, 'Not enough bonds');
    await this.log(row.id, -cost, `unlock:${cls}`);
    return this.profile((await this.resolve(row.id))!);
  }

  // ---------------- bonds ----------------

  /** Pays out a multiplayer award (the room saw the run, so it is trusted). */
  async award(r: AwardReport): Promise<void> {
    const row = await this.resolve(r.userId);
    if (!row) return;
    await this.addProgress(row, r.bonds, r.stats, r.final ? 'run' : 'run-left');
  }

  private async addProgress(
    row: UserRow,
    bonds: number,
    add: Partial<LifetimeStats>,
    reason: string,
  ): Promise<void> {
    const stats = { ...EMPTY_STATS, ...(JSON.parse(row.stats) as Partial<LifetimeStats>) };
    stats.runs += add.runs ?? 0;
    stats.wins += add.wins ?? 0;
    stats.bestKm = Math.max(stats.bestKm, Math.round((add.bestKm ?? 0) * 10) / 10);
    stats.kills += add.kills ?? 0;
    stats.landmarks += add.landmarks ?? 0;
    stats.bounties += add.bounties ?? 0;
    stats.minutes = Math.round((stats.minutes + (add.minutes ?? 0)) * 10) / 10;
    this.raw
      .prepare('UPDATE users SET bonds = bonds + ?, stats = ? WHERE id = ?')
      .run(Math.max(0, bonds | 0), JSON.stringify(stats), row.id);
    if (bonds > 0) await this.log(row.id, bonds, reason);
  }

  /** Anonymous stats (§10): small JSON blobs, capped. */
  recordStats(session: string, events: Array<{ kind: string; data: unknown }>): number {
    const insert = this.raw.prepare('INSERT INTO stats (session, kind, data, at) VALUES (?, ?, ?, ?)');
    let n = 0;
    const now = Date.now();
    for (const ev of events.slice(0, 20)) {
      if (!ev || typeof ev.kind !== 'string' || !/^[a-z_]{2,24}$/.test(ev.kind)) continue;
      const data = JSON.stringify(ev.data ?? {});
      if (data.length > 4096) continue;
      insert.run(session.slice(0, 40), ev.kind, data, now);
      n++;
    }
    return n;
  }

  /** Development servers only: grant bonds for testing (§12). */
  async devGrant(row: UserRow, bonds: number): Promise<Profile> {
    await this.addProgress(row, Math.max(0, Math.min(500, bonds | 0)), {}, 'dev-grant');
    return this.profile((await this.resolve(row.id))!);
  }

  private async log(userId: string, delta: number, reason: string): Promise<void> {
    await this.db.insert(bondLog).values({ userId, delta, reason, at: Date.now() });
  }

  /** A solo run starts: the server notes when, so the claim can be checked. */
  async soloStart(row: UserRow, seed: unknown): Promise<string> {
    const id = randomUUID();
    await this.db.insert(soloRuns).values({
      id,
      userId: row.id,
      seed: Number(seed) >>> 0,
      startedAt: Date.now(),
    });
    return id;
  }

  /**
   * A solo run ends. Solo runs happen in the browser, so the claim is capped by
   * what was physically possible in the time since the run started (§6.11).
   */
  async soloFinish(
    row: UserRow,
    runId: unknown,
    claim: { award: RunAward; stats: Partial<LifetimeStats>; dev: boolean },
  ): Promise<{ bonds: number; profile: Profile }> {
    if (typeof runId !== 'string') throw new AccountError(400, 'No run');
    const run = await this.db.query.soloRuns.findFirst({
      where: and(eq(soloRuns.id, runId), eq(soloRuns.userId, row.id)),
    });
    if (!run) throw new AccountError(404, 'Unknown run');
    if (run.finishedAt) throw new AccountError(409, 'Run already claimed');
    const seconds = (Date.now() - run.startedAt) / 1000;
    const a = claim.award ?? ({} as RunAward);
    // The train tops out at 20 m/s: no claim can outrun the clock.
    const maxKm = ((seconds * 20) / WORLD.metersPerKm) * 1.1 + 0.5;
    const km = Math.max(0, Math.min(Number(a.km) || 0, maxKm, WORLD.routeKm));
    const award: RunAward = {
      km,
      won: !!a.won && km >= WORLD.routeKm - 0.5 && seconds >= 15 * 60,
      landmarks: Math.max(0, Math.min(3, Number(a.landmarks) | 0)),
      bondItems: Math.max(0, Math.min(5, Number(a.bondItems) | 0)),
    };
    const bonds = claim.dev ? 0 : Math.min(bondsFor(award), BONDS.maxPerRun);
    const res = this.raw
      .prepare('UPDATE solo_runs SET finished_at = ?, bonds = ? WHERE id = ? AND finished_at IS NULL')
      .run(Date.now(), bonds, runId);
    if (res.changes !== 1) throw new AccountError(409, 'Run already claimed');
    const s = claim.stats ?? {};
    await this.addProgress(
      row,
      bonds,
      {
        runs: 1,
        wins: award.won ? 1 : 0,
        bestKm: km,
        kills: Math.max(0, Math.min(5000, Number(s.kills) | 0)),
        landmarks: award.landmarks,
        bounties: Math.max(0, Math.min(100, Number(s.bounties) | 0)),
        minutes: Math.min(seconds / 60, Number(s.minutes) || 0),
      },
      'solo',
    );
    return { bonds, profile: await this.profile((await this.resolve(row.id))!) };
  }

  // ---------------- sign-in (§4.12) ----------------

  /**
   * A provider confirmed who this is. The first sign-in turns the current guest
   * into the account (progress and all); signing in on another device folds that
   * device's guest progress into the existing account.
   */
  async signIn(
    provider: string,
    providerId: string,
    displayName: string,
    guestId: string | null,
  ): Promise<string> {
    const now = Date.now();
    const link = await this.db.query.identities.findFirst({
      where: and(eq(identities.provider, provider), eq(identities.providerId, providerId)),
    });
    const guest = guestId ? await this.resolve(guestId) : null;
    if (!link) {
      // First sign-in with this identity: keep the guest's progress.
      let target = guest;
      if (!target) {
        const fresh = await this.createGuest();
        target = await this.userFromToken(fresh.token);
      }
      await this.db.insert(identities).values({
        provider,
        providerId,
        userId: target!.id,
        name: displayName.slice(0, 40),
        createdAt: now,
      });
      await this.db.update(users).set({ guest: false }).where(eq(users.id, target!.id));
      return this.session(target!.id);
    }
    const account = await this.resolve(link.userId);
    if (!account) throw new AccountError(500, 'Account missing');
    if (guest && guest.id !== account.id && guest.guest) {
      // Another device's guest progress joins the account.
      const merged = [...new Set([...parseClasses(account.classes), ...parseClasses(guest.classes)])];
      const a = { ...EMPTY_STATS, ...(JSON.parse(account.stats) as Partial<LifetimeStats>) };
      const g = { ...EMPTY_STATS, ...(JSON.parse(guest.stats) as Partial<LifetimeStats>) };
      const stats: LifetimeStats = {
        runs: a.runs + g.runs,
        wins: a.wins + g.wins,
        bestKm: Math.max(a.bestKm, g.bestKm),
        kills: a.kills + g.kills,
        landmarks: a.landmarks + g.landmarks,
        bounties: a.bounties + g.bounties,
        minutes: a.minutes + g.minutes,
      };
      this.raw
        .prepare('UPDATE users SET bonds = bonds + ?, classes = ?, stats = ? WHERE id = ?')
        .run(guest.bonds, JSON.stringify(merged), JSON.stringify(stats), account.id);
      this.raw
        .prepare('UPDATE users SET merged_into = ?, bonds = 0 WHERE id = ?')
        .run(account.id, guest.id);
      if (guest.bonds > 0) await this.log(account.id, guest.bonds, `merge:${guest.id}`);
    }
    return this.session(account.id);
  }
}

export function parseClasses(json: string): ClassId[] {
  try {
    const v = JSON.parse(json) as unknown;
    const list = Array.isArray(v) ? v.filter(isClassId) : [];
    return list.includes('drifter') ? list : ['drifter', ...list];
  } catch {
    return ['drifter'];
  }
}
