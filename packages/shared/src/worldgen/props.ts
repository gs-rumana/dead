import { hashInts } from '../math/rng.ts';
import { biomeWeights } from './biome.ts';
import type { Terrain } from './terrain.ts';
import { TILE_SIZE } from './tiles.ts';

/** Prop kinds placed by world generation. Visual meshes live in the client. */
export const PropKind = {
  Grass: 0,
  Bush: 1,
  Oak: 2,
  Pine: 3,
  RockSmall: 4,
  RockBig: 5,
  DeadTree: 6,
  Cactus: 7,
} as const;
export type PropKindId = (typeof PropKind)[keyof typeof PropKind];
export const PROP_KIND_COUNT = 8;

/** Collision shapes for props that block players (§6.10: colliders only near players). */
export const PROP_COLLIDERS: Partial<Record<PropKindId, { radius: number; height: number }>> = {
  [PropKind.Oak]: { radius: 0.35, height: 4 },
  [PropKind.Pine]: { radius: 0.3, height: 5 },
  [PropKind.RockBig]: { radius: 1.1, height: 1.6 },
  [PropKind.DeadTree]: { radius: 0.25, height: 3 },
  [PropKind.Cactus]: { radius: 0.25, height: 2.5 },
};

export interface Prop {
  kind: PropKindId;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
}

/** Per-biome density (chance per 16 m cell) for each prop kind. */
const DENSITY: Record<PropKindId, [number, number, number]> = {
  [PropKind.Grass]: [0.95, 0.35, 0.6],
  [PropKind.Bush]: [0.12, 0.1, 0.2],
  [PropKind.Oak]: [0.035, 0.0, 0.05],
  [PropKind.Pine]: [0.0, 0.01, 0.42],
  [PropKind.RockSmall]: [0.06, 0.2, 0.08],
  [PropKind.RockBig]: [0.01, 0.06, 0.03],
  [PropKind.DeadTree]: [0.008, 0.03, 0.02],
  [PropKind.Cactus]: [0.0, 0.07, 0.0],
};

/** Clearance from the track centreline for each kind (metres). */
const CLEARANCE: Record<PropKindId, number> = {
  [PropKind.Grass]: 4.5,
  [PropKind.Bush]: 7,
  [PropKind.Oak]: 11,
  [PropKind.Pine]: 10,
  [PropKind.RockSmall]: 6,
  [PropKind.RockBig]: 9,
  [PropKind.DeadTree]: 9,
  [PropKind.Cactus]: 8,
};

const CELL = 16;
const KINDS: PropKindId[] = [
  PropKind.Pine,
  PropKind.Oak,
  PropKind.RockBig,
  PropKind.DeadTree,
  PropKind.Cactus,
  PropKind.Bush,
  PropKind.RockSmall,
];

/**
 * Deterministic props for one terrain tile (§6.6). Every placement decision is an
 * integer hash of (seed, cell, slot), so the server and every client agree on which
 * props exist and where their colliders are.
 */
export function tileProps(terrain: Terrain, tx: number, tz: number, grassDensity = 1): Prop[] {
  const seed = terrain.seed ^ 0x9a0b;
  const out: Prop[] = [];
  const cells = TILE_SIZE / CELL;
  const w: [number, number, number] = [1, 0, 0];
  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      const gx = tx * cells + cx;
      const gz = tz * cells + cz;
      const cxw = gx * CELL + CELL / 2;
      const czw = gz * CELL + CELL / 2;
      const near = terrain.route.nearest(cxw, czw, 40);
      const s = near ? near.s : terrain.progressAt(cxw, czw);
      biomeWeights(s, w);
      // One "big" prop slot per cell, chosen by cumulative density.
      const roll = hashInts(seed, gx, gz, 1) / 4294967296;
      let acc = 0;
      for (const kind of KINDS) {
        const d = DENSITY[kind];
        acc += d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
        if (roll < acc) {
          const p = place(terrain, seed, gx, gz, kind, 2, near ? near.dist : 999);
          if (p) out.push(p);
          break;
        }
      }
      // Grass clumps: several small slots per cell.
      const gd = DENSITY[PropKind.Grass];
      const grassChance = (gd[0] * w[0] + gd[1] * w[1] + gd[2] * w[2]) * grassDensity;
      for (let k = 0; k < 4; k++) {
        if (hashInts(seed, gx, gz, 10 + k) / 4294967296 < grassChance) {
          const p = place(terrain, seed, gx, gz, PropKind.Grass, 20 + k, near ? near.dist : 999);
          if (p) out.push(p);
        }
      }
    }
  }
  return out;
}

function place(
  terrain: Terrain,
  seed: number,
  gx: number,
  gz: number,
  kind: PropKindId,
  slot: number,
  cellTrackDist: number,
): Prop | null {
  const h = hashInts(seed, gx, gz, slot);
  const fx = (h & 0xffff) / 65536;
  const fz = (h >>> 16) / 65536;
  const x = gx * CELL + fx * CELL;
  const z = gz * CELL + fz * CELL;
  if (cellTrackDist < CLEARANCE[kind] + CELL) {
    const n = terrain.route.nearest(x, z, CLEARANCE[kind] + 1);
    if (n) return null;
  }
  if (terrain.nearestSpur(x, z, CLEARANCE[kind] * 0.7 + 1)) return null;
  const h2 = hashInts(seed, gx, gz, slot + 100);
  return {
    kind,
    x,
    y: terrain.height(x, z),
    z,
    rot: ((h2 & 0xffff) / 65536) * Math.PI * 2,
    scale: 0.75 + ((h2 >>> 16) / 65536) * 0.6,
  };
}
