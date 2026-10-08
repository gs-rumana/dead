import { clamp, smoothstep } from '../math/scalar.ts';
import { biomeWeights } from './biome.ts';
import { fbm2, noise2 } from './noise.ts';
import { type NearestResult, Route } from './route.ts';

/** Half-width of the flat track bed (metres from the centreline). */
export const BED_HALF_WIDTH = 3.2;
/** Distance over which terrain blends from the track bed to natural land. */
export const BED_BLEND = 42;

/**
 * Ground height everywhere (§6.6). Deterministic: the server's physics,
 * the client's physics and the rendered mesh all sample this same function.
 */
/** A circle of flattened ground under a structure (§6.6). */
export interface TerrainPad {
  x: number;
  z: number;
  y: number;
  r: number;
}

const PAD_CELL = 256;
const PAD_BLEND = 14;

/** Spur beds are narrower than the main line's. */
const SPUR_HALF_WIDTH = 2.4;
const SPUR_BLEND = 22;

export class Terrain {
  readonly seed: number;
  private readonly pads = new Map<number, TerrainPad[]>();
  private spurs: Array<{
    route: Route;
    b: { minX: number; maxX: number; minZ: number; maxZ: number };
  }> = [];
  private readonly spurNear: NearestResult = { s: 0, lateral: 0, dist: 0 };
  private readonly near: NearestResult = { s: 0, lateral: 0, dist: 0 };
  private readonly w: [number, number, number] = [1, 0, 0];

  constructor(readonly route: Route) {
    this.seed = route.seed;
  }

  /** Approximate route distance for any point (used for biome lookups). */
  progressAt(x: number, z: number): number {
    return this.route.progressAt(x, z);
  }

  /** Natural land height, ignoring the track. */
  natural(x: number, z: number, s: number): number {
    const seed = this.seed;
    const w = biomeWeights(s, this.w);
    let h = Route.landHeight(seed, x, z);
    if (w[0] > 0) {
      // Prairie: long gentle swells.
      const prairie =
        fbm2(seed ^ 0x1111, x, z, 220, 3, 0.45) * 5.5 +
        noise2(seed ^ 0x2222, x / 23, z / 23) * 0.35;
      h += w[0] * prairie;
    }
    if (w[1] > 0) {
      // Badlands: terraced mesas.
      let mesa = fbm2(seed ^ 0x3333, x, z, 300, 3, 0.5);
      mesa = Math.max(0, mesa - 0.05) * 60;
      const step = 6;
      const terraced =
        Math.floor(mesa / step) * step + smoothstep(0.7, 1, (mesa % step) / step) * step;
      h += w[1] * (terraced + fbm2(seed ^ 0x4444, x, z, 90, 2) * 3);
    }
    if (w[2] > 0) {
      // Forest: rougher hills.
      h += w[2] * fbm2(seed ^ 0x5555, x, z, 160, 4, 0.5) * 11;
    }
    return h;
  }

  /** Registers spur lines so their beds are flattened too (§4.4). */
  setSpurs(spurs: Route[]): void {
    const m = SPUR_HALF_WIDTH + SPUR_BLEND + 2;
    this.spurs = spurs.map((route) => {
      const b = route.bounds();
      return {
        route,
        b: { minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m },
      };
    });
  }

  /** Nearest spur within `max` metres, if any. */
  nearestSpur(x: number, z: number, max: number): { route: Route; near: NearestResult } | null {
    let best: { route: Route; near: NearestResult } | null = null;
    for (const sp of this.spurs) {
      if (x < sp.b.minX || x > sp.b.maxX || z < sp.b.minZ || z > sp.b.maxZ) continue;
      const n = sp.route.nearest(x, z, max, this.spurNear);
      if (n && (!best || n.dist < best.near.dist)) best = { route: sp.route, near: { ...n } };
    }
    return best;
  }

  /** Registers flat ground under structures; call once before sampling heights. */
  setPads(pads: TerrainPad[]): void {
    this.pads.clear();
    for (const p of pads) {
      const r = p.r + PAD_BLEND;
      const x0 = Math.floor((p.x - r) / PAD_CELL);
      const x1 = Math.floor((p.x + r) / PAD_CELL);
      const z0 = Math.floor((p.z - r) / PAD_CELL);
      const z1 = Math.floor((p.z + r) / PAD_CELL);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = cx * 100003 + cz;
          let list = this.pads.get(key);
          if (!list) this.pads.set(key, (list = []));
          list.push(p);
        }
      }
    }
  }

  height(x: number, z: number): number {
    let h: number;
    const n = this.route.nearest(x, z, BED_BLEND + BED_HALF_WIDTH, this.near);
    if (!n) h = this.natural(x, z, this.progressAt(x, z));
    else {
      const bed = this.route.heightAt(n.s);
      const nat = this.natural(x, z, n.s);
      const t = smoothstep(BED_HALF_WIDTH, BED_HALF_WIDTH + BED_BLEND, n.dist);
      h = bed + (nat - bed) * t;
    }
    if (this.spurs.length) {
      const sp = this.nearestSpur(x, z, SPUR_HALF_WIDTH + SPUR_BLEND);
      if (sp) {
        const bed = sp.route.heightAt(sp.near.s);
        h =
          bed + (h - bed) * smoothstep(SPUR_HALF_WIDTH, SPUR_HALF_WIDTH + SPUR_BLEND, sp.near.dist);
      }
    }
    if (this.pads.size === 0) return h;
    const list = this.pads.get(Math.floor(x / PAD_CELL) * 100003 + Math.floor(z / PAD_CELL));
    if (!list) return h;
    for (const p of list) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + PAD_BLEND) h = p.y + (h - p.y) * smoothstep(p.r, p.r + PAD_BLEND, d);
    }
    return h;
  }

  /** Surface "wetness/dirt" helpers for colouring: 1 on the track bed, 0 away from it. */
  bedFactor(x: number, z: number): number {
    const n = this.route.nearest(x, z, BED_HALF_WIDTH + 6, this.near);
    if (!n) return 0;
    return 1 - clamp((n.dist - BED_HALF_WIDTH + 1) / 6, 0, 1);
  }
}
