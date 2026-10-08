import type { Terrain } from './terrain.ts';

/** Terrain is streamed in square tiles on the world XZ grid. */
export const TILE_SIZE = 128;
/** Grid resolution (segments per side) for near tiles and for physics. */
export const TILE_RES = 32;

export function tileKey(tx: number, tz: number): string {
  return `${tx},${tz}`;
}

export function tileOf(x: number, z: number): { tx: number; tz: number } {
  return { tx: Math.floor(x / TILE_SIZE), tz: Math.floor(z / TILE_SIZE) };
}

/**
 * Heights for a tile on a (res+1)² grid, row-major with x varying fastest:
 * heights[iz * (res + 1) + ix] at (tx*TILE + ix*step, tz*TILE + iz*step).
 */
export function tileHeights(
  terrain: Terrain,
  tx: number,
  tz: number,
  res = TILE_RES,
): Float32Array {
  const n = res + 1;
  const step = TILE_SIZE / res;
  const out = new Float32Array(n * n);
  const x0 = tx * TILE_SIZE;
  const z0 = tz * TILE_SIZE;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      out[iz * n + ix] = terrain.height(x0 + ix * step, z0 + iz * step);
    }
  }
  return out;
}
