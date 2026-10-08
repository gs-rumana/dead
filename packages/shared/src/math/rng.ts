/**
 * Seeded randomness for world generation and the simulation.
 * `Math.random()` is never used where results must match across machines.
 */

/** sfc32: small fast counter PRNG. Returns floats in [0, 1). */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** 32-bit integer mix (murmur3 finalizer). Pure integer math, identical in every JS engine. */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash any number of integers into a uint32. Use for decisions ("is there a building here?"). */
export function hashInts(seed: number, ...values: number[]): number {
  let h = mix32(seed ^ 0x9e3779b9);
  for (const v of values) {
    h = mix32((h ^ Math.imul(v | 0, 0x27d4eb2d)) + 0x165667b1);
  }
  return h;
}

/** Hash integers into a float in [0, 1). */
export function hashFloat(seed: number, ...values: number[]): number {
  return hashInts(seed, ...values) / 4294967296;
}

/** Hash a string into a uint32 (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private readonly next01: () => number;

  constructor(seed: number) {
    const s = seed >>> 0;
    this.next01 = sfc32(mix32(s ^ 0xa5a5a5a5), mix32(s + 1), mix32(s + 2), mix32(s + 3));
    for (let i = 0; i < 12; i++) this.next01();
  }

  /** Float in [0, 1). */
  next(): number {
    return this.next01();
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next01();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next01() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next01() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next01() * items.length)];
    if (item === undefined) throw new Error('Rng.pick on empty array');
    return item;
  }

  /** Weighted pick: weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next01() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] ?? 0;
      if (r < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }
}
