import { config } from '../core/config.ts';

/**
 * Anonymous gameplay stats (§10): runs, deaths, towns, fuel and cash curves, and
 * frame rate per kind of device. A random id per visit, never the account.
 */
const session = (() => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
})();

const queue: Array<{ kind: string; data: unknown }> = [];
let timer = 0;

export function track(kind: string, data: Record<string, unknown>): void {
  queue.push({ kind, data });
  if (queue.length >= 15) flush();
  else if (!timer) timer = window.setTimeout(flush, 60_000);
}

export function flush(beacon = false): void {
  clearTimeout(timer);
  timer = 0;
  if (!queue.length) return;
  const body = JSON.stringify({ session, events: queue.splice(0, 20) });
  const url = `${config.serverUrl}/api/stats`;
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
    return;
  }
  void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(
    () => {},
  );
}

addEventListener('pagehide', () => flush(true));

/** A coarse device class (no fingerprinting detail). */
export function deviceClass(): { os: string; browser: string; touch: boolean } {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'ios'
    : /Android/.test(ua)
      ? 'android'
      : /Mac/.test(ua)
        ? 'mac'
        : /Win/.test(ua)
          ? 'windows'
          : /Linux|CrOS/.test(ua)
            ? 'linux'
            : 'other';
  const browser = /Edg\//.test(ua)
    ? 'edge'
    : /Firefox\//.test(ua)
      ? 'firefox'
      : /SamsungBrowser/.test(ua)
        ? 'samsung'
        : /Chrome\//.test(ua)
          ? 'chrome'
          : /Safari\//.test(ua)
            ? 'safari'
            : 'other';
  return { os, browser, touch: matchMedia('(pointer: coarse)').matches };
}
