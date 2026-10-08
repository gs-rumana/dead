import { randomBytes } from 'node:crypto';

/**
 * Server crash reports to Sentry (§10) with no SDK: one envelope POST per error.
 * Off unless SENTRY_DSN is set.
 */
let target: { url: string; key: string; dsn: string } | null = null;

export function setupErrorReports(dsn = process.env.SENTRY_DSN): void {
  if (!dsn) return;
  const m = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!m) {
    console.warn('[errors] SENTRY_DSN is not a valid DSN');
    return;
  }
  target = { url: `${m[1]}://${m[3]}/api/${m[4]}/envelope/`, key: m[2]!, dsn };
  process.on('unhandledRejection', (e) => {
    console.error('[errors] unhandled rejection', e);
    void report(e);
  });
  process.on('uncaughtException', (e) => {
    console.error('[errors] uncaught exception', e);
    // Report, then let Docker restart a clean process.
    void report(e).finally(() => process.exit(1));
  });
}

export async function report(error: unknown, tags: Record<string, string> = {}): Promise<void> {
  if (!target) return;
  const err = error instanceof Error ? error : new Error(String(error));
  const frames = (err.stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/))
    .filter((x): x is RegExpMatchArray => !!x)
    .map((x) => ({ function: x[1] ?? '?', filename: x[2], lineno: Number(x[3]), colno: Number(x[4]) }))
    .reverse();
  const id = randomBytes(16).toString('hex');
  const event = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    release: process.env.RELEASE ?? 'dev',
    environment: process.env.NODE_ENV ?? 'development',
    tags: { region: process.env.REGION ?? 'eu', ...tags },
    exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames } }] },
  };
  const body = `${JSON.stringify({ event_id: id, sent_at: new Date().toISOString(), dsn: target.dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
  try {
    await fetch(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=dead-tracks/1.0`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Reporting must never take the server down.
  }
}
