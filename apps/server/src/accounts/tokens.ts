import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Minimal HS256 JWTs (§6.11): signed session and OAuth-state tokens. */
export class Tokens {
  constructor(private readonly secret: string) {}

  /** JWT_SECRET from the environment, or a random one kept next to the database. */
  static fromEnv(dataDir: string): Tokens {
    const env = process.env.JWT_SECRET;
    if (env && env.length >= 32) return new Tokens(env);
    const file = `${dataDir}/jwt.secret`;
    if (existsSync(file)) return new Tokens(readFileSync(file, 'utf8').trim());
    const secret = randomBytes(48).toString('base64url');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, secret, { mode: 0o600 });
    return new Tokens(secret);
  }

  sign(payload: Record<string, unknown>, ttlSeconds: number): string {
    const now = Math.floor(Date.now() / 1000);
    const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
    return `${head}.${body}.${this.mac(`${head}.${body}`)}`;
  }

  verify<T extends Record<string, unknown>>(token: unknown): (T & { exp: number }) | null {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts as [string, string, string];
    const want = Buffer.from(this.mac(`${head}.${body}`));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & {
        exp: number;
      };
      if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private mac(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
