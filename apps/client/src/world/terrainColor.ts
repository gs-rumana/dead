import * as THREE from 'three/webgpu';
import { biomeWeights, hashInts, noise2, smoothstep } from '@dead-tracks/shared';
import { PALETTE } from '../render/palette.ts';

const col = (k: keyof typeof PALETTE) => new THREE.Color(PALETTE[k]);
const PRAIRIE = [col('grass1'), col('grass2'), col('grass3'), col('grassDry'), col('grassDry2')];
const BADLANDS = [col('rockRed'), col('sand'), col('rockRedDark'), col('dirt')];
const FOREST = [
  new THREE.Color('#3f5130'),
  new THREE.Color('#4a5a33'),
  new THREE.Color('#5a5238'),
  col('pine1'),
];
const ROCK = col('rock');
const ROCK_RED = col('rockRedDark');
const BALLAST = col('ballast');
const DIRT = col('dirt');

const a = new THREE.Color();
const b = new THREE.Color();
const c = new THREE.Color();
const w: [number, number, number] = [1, 0, 0];

/**
 * Per-face terrain colour: biome palette chosen by low-frequency noise, rock on
 * steep faces, dirt and ballast along the track, a little per-face jitter.
 */
export function terrainColor(
  seed: number,
  x: number,
  z: number,
  y: number,
  normalY: number,
  s: number,
  bed: number,
  face: number,
  out: THREE.Color,
): THREE.Color {
  biomeWeights(s, w);
  const n1 = noise2(seed ^ 0x77, x / 70, z / 70) * 0.5 + 0.5;
  const n2 = noise2(seed ^ 0x99, x / 19, z / 19) * 0.5 + 0.5;
  out.setRGB(0, 0, 0);
  if (w[0] > 0) {
    const i = Math.min(PRAIRIE.length - 1, Math.floor((n1 * 0.7 + n2 * 0.3) * PRAIRIE.length));
    a.copy(PRAIRIE[i] as THREE.Color).lerp(
      PRAIRIE[Math.min(i + 1, PRAIRIE.length - 1)] as THREE.Color,
      n2 * 0.5,
    );
    out.add(a.multiplyScalar(w[0]));
  }
  if (w[1] > 0) {
    const band = Math.floor(y / 6 + n2 * 0.6);
    const i = ((band % BADLANDS.length) + BADLANDS.length) % BADLANDS.length;
    a.copy(BADLANDS[i] as THREE.Color).lerp(col('sand'), n1 * 0.3);
    out.add(a.multiplyScalar(w[1]));
  }
  if (w[2] > 0) {
    const i = Math.min(FOREST.length - 1, Math.floor(n1 * FOREST.length));
    a.copy(FOREST[i] as THREE.Color);
    out.add(a.multiplyScalar(w[2]));
  }
  // Steep faces show rock.
  const steep = smoothstep(0.86, 0.7, normalY);
  if (steep > 0) {
    b.copy(ROCK).lerp(ROCK_RED, w[1]);
    out.lerp(b, steep);
  }
  // Track bed: ballast in the middle, trodden dirt at the edges.
  if (bed > 0) {
    c.copy(DIRT).lerp(BALLAST, smoothstep(0.55, 0.95, bed));
    out.lerp(c, Math.min(1, bed * 1.1));
  }
  const jitter = 0.94 + ((hashInts(seed, face) & 1023) / 1023) * 0.1;
  return out.multiplyScalar(jitter);
}
