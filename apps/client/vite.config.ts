import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Plugin, defineConfig } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Writes dist/sw.js after a build (§8 offline): precaches every shipped file so
 * solo play works offline after the first visit. The cache name changes with the
 * file list, so a new deploy replaces the old cache.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'dead-tracks-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (!f.endsWith('.map') && f !== 'sw.js') files.push(`/${relative(outDir, p)}`);
        }
      };
      walk(outDir);
      files.sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const precache = ['/', ...files];
      writeFileSync(
        join(outDir, 'sw.js'),
        `// Generated at build time (vite.config.ts).
const VERSION = 'dt-${version}';
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Pages and the region list: fresh when online, cached when not.
  if (req.mode === 'navigate' || url.pathname === '/regions.json') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok && req.mode !== 'navigate') caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req.mode === 'navigate' ? '/index.html' : req).then((r) => r || caches.match('/'))),
    );
    return;
  }
  // Hashed assets never change: cache first.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`,
      );
    },
  };
}

export default defineConfig({
  plugins: [preact(), serviceWorker()],
  server: {
    // Reachable from phones on the same Wi-Fi (§6.1).
    host: true,
    port: 5173,
  },
  preview: { host: true, port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
  },
});
