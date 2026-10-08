import { WORLD } from '../data/world.ts';
import { smoothstep } from '../math/scalar.ts';

export const Biome = { Prairie: 0, Badlands: 1, Forest: 2 } as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];

/** Biome borders in HUD km (§4.5), blended over BLEND metres of track. */
export const BIOME_KM = [0, 27, 54] as const;
export const BIOME_BLEND = 500;

/** Weights [prairie, badlands, forest] at route distance s; they sum to 1. */
export function biomeWeights(s: number, out: [number, number, number]): [number, number, number] {
  const b1 = BIOME_KM[1] * WORLD.metersPerKm;
  const b2 = BIOME_KM[2] * WORLD.metersPerKm;
  const t1 = smoothstep(b1 - BIOME_BLEND / 2, b1 + BIOME_BLEND / 2, s);
  const t2 = smoothstep(b2 - BIOME_BLEND / 2, b2 + BIOME_BLEND / 2, s);
  out[0] = 1 - t1;
  out[1] = t1 - t2;
  out[2] = t2;
  return out;
}

export function dominantBiome(s: number): BiomeId {
  const w = biomeWeights(s, [0, 0, 0]);
  if (w[2] > 0.5) return Biome.Forest;
  if (w[1] > 0.5) return Biome.Badlands;
  return Biome.Prairie;
}
