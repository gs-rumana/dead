import { mix32 } from '../math/rng.ts';

/**
 * Deterministic gradient noise. Decisions use only integer hashing and IEEE
 * + - * / so results match across JS engines (§6.6).
 */

function hash3(seed: number, x: number, y: number): number {
  let h = mix32(seed ^ Math.imul(x | 0, 0x8da6b343));
  h = mix32(h ^ Math.imul(y | 0, 0xd8163841));
  return h;
}

// 8 unit-ish gradient directions; no trig needed.
const GX = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 2D gradient noise in roughly [-1, 1]. */
export function noise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const g00 = hash3(seed, xi, yi) & 7;
  const g10 = hash3(seed, xi + 1, yi) & 7;
  const g01 = hash3(seed, xi, yi + 1) & 7;
  const g11 = hash3(seed, xi + 1, yi + 1) & 7;
  const n00 = (GX[g00] as number) * fx + (GY[g00] as number) * fy;
  const n10 = (GX[g10] as number) * (fx - 1) + (GY[g10] as number) * fy;
  const n01 = (GX[g01] as number) * fx + (GY[g01] as number) * (fy - 1);
  const n11 = (GX[g11] as number) * (fx - 1) + (GY[g11] as number) * (fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 0.9;
}

/** Fractal sum of noise2. `scale` is the base wavelength in world units. */
export function fbm2(
  seed: number,
  x: number,
  y: number,
  scale: number,
  octaves: number,
  gain = 0.5,
  lacunarity = 2.03,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1 / scale;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(seed + i * 1013, x * f, y * f);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Smooth 1D value noise in [-1, 1] (cubic Hermite between hashed lattice values). */
export function noise1(seed: number, x: number): number {
  const xi = Math.floor(x);
  const t = x - xi;
  const v = (i: number) => (mix32(seed ^ Math.imul(i | 0, 0x9e3779b1)) / 4294967296) * 2 - 1;
  const p0 = v(xi - 1);
  const p1 = v(xi);
  const p2 = v(xi + 1);
  const p3 = v(xi + 2);
  // Catmull-Rom
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}
