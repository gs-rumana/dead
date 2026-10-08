import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Accounts and progress (§4.12). Guests are users with no linked identity. */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  guest: integer('guest', { mode: 'boolean' }).notNull().default(true),
  bonds: integer('bonds').notNull().default(0),
  /** JSON array of unlocked class ids. */
  classes: text('classes').notNull().default('["drifter"]'),
  /** JSON LifetimeStats. */
  stats: text('stats').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  seenAt: integer('seen_at').notNull(),
  /** Set when a guest was merged into a signed-in account on another device. */
  mergedInto: text('merged_into'),
});

/** Linked sign-in providers: only the provider's id and a display name (§10). */
export const identities = sqliteTable(
  'identities',
  {
    provider: text('provider').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerId] })],
);

/** Solo runs (played in the browser) are claimed against a server-issued start time. */
export const soloRuns = sqliteTable('solo_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  seed: integer('seed').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  bonds: integer('bonds'),
});

/** Every bond change, for support and balancing. */
export const bondLog = sqliteTable('bond_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  at: integer('at').notNull(),
});

/** Anonymous gameplay stats (§10): no account ids, a random per-visit session id. */
export const stats = sqliteTable('stats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  session: text('session').notNull(),
  kind: text('kind').notNull(),
  data: text('data').notNull(),
  at: integer('at').notNull(),
});

/** Kept in step with the tables above (created on startup; no migration tool needed yet). */
export const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  guest INTEGER NOT NULL DEFAULT 1,
  bonds INTEGER NOT NULL DEFAULT 0,
  classes TEXT NOT NULL DEFAULT '["drifter"]',
  stats TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  merged_into TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (username COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX IF NOT EXISTS identities_user ON identities (user_id);
CREATE TABLE IF NOT EXISTS solo_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  bonds INTEGER
);
CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stats_kind ON stats (kind, at);
CREATE TABLE IF NOT EXISTS bond_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);
`;
