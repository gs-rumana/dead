// Serves a built client like a CDN would (brotli/gzip, SPA fallback): node static.mjs <dir> <port>
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const [, , dir = 'apps/client/dist', port = '4180'] = process.argv;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const cache = new Map();
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = normalize(join(dir, decodeURIComponent(url.pathname)));
  if (!path.startsWith(normalize(dir)) || !existsSync(path) || statSync(path).isDirectory()) path = join(dir, 'index.html');
  const type = TYPES[extname(path)] ?? 'application/octet-stream';
  const enc = String(req.headers['accept-encoding'] ?? '');
  const compressible = /text|javascript|json|svg|wasm|manifest/.test(type);
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (compressible && (enc.includes('br') || enc.includes('gzip'))) {
    const kind = enc.includes('br') ? 'br' : 'gzip';
    const key = `${kind}:${path}`;
    let body = cache.get(key);
    if (!body) {
      const raw = readFileSync(path);
      body = kind === 'br' ? brotliCompressSync(raw) : gzipSync(raw, { level: 9 });
      cache.set(key, body);
    }
    res.setHeader('Content-Encoding', kind);
    res.setHeader('Content-Length', body.length);
    res.end(body);
    return;
  }
  createReadStream(path).pipe(res);
}).listen(Number(port), () => console.log(`static on :${port}`));
