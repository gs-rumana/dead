import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof openDb>['db'];

/**
 * SQLite through Node's built-in driver (no native build on the Arm VM, §9),
 * wrapped by Drizzle's proxy driver for typed queries.
 */
export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
  raw.exec(schema.DDL);
  const db = drizzle(
    async (sql, params, method) => {
      const stmt = raw.prepare(sql);
      if (method === 'run') {
        stmt.run(...(params as never[]));
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      if (method === 'get') {
        const row = stmt.get(...(params as never[]));
        return { rows: (row ?? undefined) as unknown as unknown[] };
      }
      return { rows: stmt.all(...(params as never[])) as unknown as unknown[] };
    },
    { schema },
  );
  return { db, raw };
}
