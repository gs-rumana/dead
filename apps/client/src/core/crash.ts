/**
 * Crash reports (§10): Sentry's free tier, loaded only when a DSN is configured
 * (VITE_SENTRY_DSN at build time), so builds without one ship none of it.
 * Session tracking gives the crash-free rate for the M8 playtest.
 */
export function setupCrashReports(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import('@sentry/browser')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        release: (import.meta.env.VITE_RELEASE as string | undefined) ?? 'dev',
        environment: import.meta.env.PROD ? 'production' : 'development',
        tracesSampleRate: 0,
        // Strip the party code and any token from URLs.
        beforeSend(event) {
          if (event.request?.url) event.request.url = event.request.url.replace(/#.*$/, '').replace(/\/join\/[A-Z]+/, '/join/XXXX');
          return event;
        },
      });
    })
    .catch(() => {});
}
